import { BusinessDb } from './db';
import { Instruction, isNewOrder, parseTargetDate } from './instructions';
import { applyInstruction, appendRemark, CustomerRecord } from './actions';
import { generateOneOffOrderId } from '../utils/ids';
import { OllamaClient } from '../llm/ollama';
import logger from '../utils/logger';

/**
 * Ingestion for the staff-only "Updates" WhatsApp group. Messages there are
 * THIRD-PERSON staff shorthand ("Hold Neeraj Rathore is payment not
 * received"), not the first-person customer phrasing instructions.ts parses
 * — so this is a separate, purpose-built parser. It reuses the same
 * `Instruction`/`applyInstruction` pipeline for anything that resolves to a
 * known customer, and never invents a payment/cancellation action from
 * shorthand — those always land as a plain note, same philosophy as actions.ts.
 *
 * Every message is staged in `group_messages` the instant it arrives
 * (insertGroupMessage, called from the Baileys group handler) and only
 * classified/applied by the nightly job (processGroupMessages) — a same-day
 * summary, not a live system.
 */

export type GroupClassification = 'NEW_ORDER' | 'CUSTOMER_UPDATE' | 'NOTE' | 'UNCLEAR';

export interface EscalatedItem {
  text: string;
  reason: string;
}

export interface GroupProcessResult {
  processed: number;
  oneOffOrders: number;
  customerUpdates: number;
  notes: number;
  escalated: EscalatedItem[];
}

interface GroupMessageRow {
  id: number;
  participant: string;
  message_text: string;
  external_message_id: string;
  reply_to_external_id: string;
}

const LLM_PROMPT = `Staff post short-hand updates in a flower-delivery ops WhatsApp group.
Extract only the existing customer's name when it is clearly present. Do not
infer or recommend any action. Reply ONLY with JSON:
{"name":"full name or null"}`;

export interface GroupMessageMetadata {
  externalMessageId?: string;
  replyToExternalId?: string;
}

/** Stage a group message the instant it arrives. No parsing here — just durability. */
export function insertGroupMessage(
  db: BusinessDb,
  participant: string,
  text: string,
  receivedAt: string,
  metadata: GroupMessageMetadata = {}
): number {
  const result = db.prepare(`
    INSERT INTO group_messages
      (participant, message_text, received_at, external_message_id, reply_to_external_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    participant,
    text,
    receivedAt,
    metadata.externalMessageId ?? '',
    metadata.replyToExternalId ?? ''
  );
  return result.lastInsertRowid as number;
}

/** Recipient mobile found in message text. WhatsApp mention IDs are excluded. */
export function extractPhone(text: string): string | null {
  const withoutMentions = text.replace(/@\d{10,}/g, '');
  const lines = withoutMentions.split(/\r?\n/);
  const labelled = /(?:ph(?:one)?|mob(?:ile)?|number|contact)\.?\s*(?:no\.?)?\s*[-:]?\s*(?:\+?91[\t -]*)?([6-9](?:[\t -]*\d){9})\b/i;
  for (const line of lines) {
    const match = line.match(labelled);
    if (match) return match[1].replace(/\D/g, '');
  }
  const mobile = /(?:\+?91[\t -]*)?([6-9](?:[\t -]*\d){9})\b/g;
  for (const line of lines) {
    const match = mobile.exec(line);
    mobile.lastIndex = 0;
    if (match) return match[1].replace(/\D/g, '');
  }
  return null;
}

/** Best-effort recipient name from the formats staff use in Updates. */
function extractOrderName(text: string): string {
  const patterns = [
    /recipient'?s\s+name\s*[:\-]?\s*([^\n,]+)/i,
    /need\s+to\s+send\s+to\s*(?:\r?\n\s*)?([^\n,+]+)/i,
    /\bto\b\s*(?:\r?\n\s*)?([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+){0,2})(?=\s*(?:,|\+|\r?\n|$))/i,
    /\bto\b\s+([A-Z][a-zA-Z.'-]+)\s+(?:heritage|office)\b/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1].trim();
  }
  return '';
}

function extractTimeSlot(text: string): string {
  if (/\b(immediately|asap|right away)\b/i.test(text)) return 'Immediately';
  const range = text.match(/\bbetween\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s+(?:to|and|-)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i);
  if (range) return `${range[1].trim()} - ${range[2].trim()}`;
  const match = text.match(/\b(before|after|by|at)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i);
  if (match) return `${match[1][0].toUpperCase()}${match[1].slice(1).toLowerCase()} ${match[2].trim()}`;
  if (/\btomorrow\s+morning\b/i.test(text)) return 'Morning';
  return '';
}

function extractAmount(text: string): number {
  const patterns = [
    /\bamount\s*[:\-]?\s*(?:rs\.?|₹)?\s*(\d{2,6})\b/i,
    /\b(?:paytm|gpay|google\s*pay|phonepe|upi)\s+(?:done|paid|sent)?\s*(?:rs\.?|₹)?\s*(\d{2,6})\b/i,
    /\b(?:bouquet|basket|arrangement)\s*(?:of|for)?\s*(?:rs\.?|₹)?\s*(\d{2,6})\s*\/?-\b/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return Number(match[1]);
  }
  return 0;
}

type OneOffPaymentStatus = 'COMPLETED' | 'PENDING' | 'COMPLIMENTARY';

function extractPaymentStatus(text: string): OneOffPaymentStatus {
  if (/\b(?:do not ask for payment|complimentary|no payment)\b/i.test(text)) return 'COMPLIMENTARY';
  if (/\b(?:paytm|gpay|google\s*pay|phonepe|upi)\b[\s\S]{0,25}\b(?:done|paid|sent|transferred)\b/i.test(text) ||
      /\b(?:done|paid|sent|transferred)\b[\s\S]{0,25}\b(?:paytm|gpay|google\s*pay|phonepe|upi)\b/i.test(text)) {
    return 'COMPLETED';
  }
  return 'PENDING';
}

function extractAddress(text: string): string {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const labelledIndex = lines.findIndex(line => /^address\s*[:\-]/i.test(line));
  if (labelledIndex >= 0) {
    const first = lines[labelledIndex].replace(/^address\s*[:\-]\s*/i, '');
    const parts = [first, ...lines.slice(labelledIndex + 1)]
      .filter(Boolean)
      .filter(line => !/^(?:message|today delivery|bouquet|amount|contact|ph(?:one)?|mob)/i.test(line));
    return parts.slice(0, 3).join(', ');
  }

  const addressLike = /\b(?:sector|sec[- ]?\d|road|estate|enclave|heights|tower|floor|office|gurugram|gurgaon|phase|palm|wellington|emaar|dlf|near)\b|(?:^|\s)[A-Z]?\d+[/-]\d+/i;
  const candidates = lines.filter(line =>
    addressLike.test(line) &&
    !/\b(?:flower|lil(?:y|ies)|rose|carnation|daisy|bouquet|basket|amount|paytm|gpay)\b/i.test(line)
  );
  return candidates.slice(0, 3).join(', ');
}

function hasProductDetails(text: string): boolean {
  return /\b(?:bouquet|basket|arrangement|mala|flower|flowers|rose|roses|lil(?:y|ies)|carnation|daisy|rajni|rajnigandha|gypso|limonium|bop|lotus|oriental)\b/i.test(text) &&
    (/\b\d{1,3}\b/.test(text) || /\b(?:bouquet|basket|arrangement|mala)\b/i.test(text));
}

function looksLikeSubscriptionStart(text: string): boolean {
  return /\b(?:start|begin)\b[\s\S]{0,35}\b(?:subscription|plan|package|delight|bliss|joy|felicity|corporate)\b/i.test(text);
}

function looksLikeOneOffOrder(text: string): boolean {
  const lower = text.toLowerCase();
  return isNewOrder(lower) ||
    (/\b(?:send|deliver)\b/i.test(text) && hasProductDetails(text)) ||
    (/\bfrom\b[\s\S]{0,80}\bto\b/i.test(text) && hasProductDetails(text));
}

export interface ParsedOneOffOrder {
  customerName: string;
  phone: string;
  address: string;
  zone: string;
  date: string;
  timeSlot: string;
  amount: number;
  description: string;
  paymentStatus: OneOffPaymentStatus;
  missing: string[];
}

/** Parse and validate a one-off order without mutating the database. */
export function parseOneOffOrder(text: string, today: string): ParsedOneOffOrder {
  const customerName = extractOrderName(text);
  const phone = extractPhone(text) ?? '';
  const address = extractAddress(text);
  const date = parseTargetDate(text.toLowerCase(), today) ?? '';
  const timeSlot = extractTimeSlot(text);
  const amount = extractAmount(text);
  const missing: string[] = [];
  if (!customerName) missing.push('recipient name');
  if (!phone) missing.push('recipient phone');
  if (!address || address.length < 12 || !/\d/.test(address)) missing.push('delivery address');
  if (!date) missing.push('delivery date');
  if (!hasProductDetails(text)) missing.push('product details');
  return {
    customerName,
    phone,
    address,
    zone: '',
    date,
    timeSlot,
    amount,
    description: text.trim(),
    paymentStatus: extractPaymentStatus(text),
    missing
  };
}

const VERB_ACTIONS: Record<string, Instruction> = {
  hold: { type: 'HOLD_INDEFINITE' },
  skip: { type: 'SKIP', weeks: 1 },
  resume: { type: 'RESUME' }
};

/**
 * "Hold Neeraj Rathore is payment not received" → verb 'hold', name 'Neeraj
 * Rathore', rest. The verb is matched case-insensitively, but the name must
 * stay case-SENSITIVE — an `i` flag across the whole pattern would make
 * `[A-Z]` match lowercase words too, swallowing the rest of the sentence.
 */
export function matchVerbFirst(text: string): { verb: string; name: string; rest: string } | null {
  const verbMatch = text.match(/^(hold|skip|resume|restrict)\b\s+(.*)$/i);
  if (!verbMatch) return null;
  const nameMatch = verbMatch[2].match(/^((?:[A-Z][\w.]*\s*){1,4})(.*)$/);
  if (!nameMatch) return null;
  return { verb: verbMatch[1].toLowerCase(), name: nameMatch[1].trim(), rest: nameMatch[2].trim() };
}

/** "Hardik Shah- pls ensure collection..." → name 'Hardik Shah', rest 'pls ensure collection...'. */
function matchNameFirst(text: string): { name: string; rest: string } | null {
  const match = text.match(/^((?:[A-Z][\w.]+\s+){0,3}[A-Z][\w.]+)\s*[-–,]\s*(.+)$/s);
  if (!match) return null;
  return { name: match[1].trim(), rest: match[2].trim() };
}

export function findCustomersByName(db: BusinessDb, name: string): CustomerRecord[] {
  return db.prepare(`
    SELECT id, name, phones, address, zone FROM customers WHERE name LIKE ? LIMIT 5
  `).all(`%${name}%`) as CustomerRecord[];
}

interface ClassifyOutcome {
  classification: GroupClassification;
  matchedCustomerId: string | null;
  matchedOrderId: string | null;
  actionTaken: string;
  escalated: boolean;
  escalationReason?: string;
}

type ProposedMutation =
  | { kind: 'NONE' }
  | { kind: 'CREATE_ORDER'; id: string; order: ParsedOneOffOrder }
  | { kind: 'APPLY_INSTRUCTION'; customer: CustomerRecord; instruction: Instruction }
  | { kind: 'APPEND_NOTE'; customerId: string; note: string };

interface ClassifyProposal extends Omit<ClassifyOutcome, 'actionTaken'> {
  mutation: ProposedMutation;
  actionTaken?: string;
}

function proposeCustomerUpdate(
  db: BusinessDb,
  customer: CustomerRecord,
  verb: string | null,
  rest: string
): ClassifyProposal {
  const instruction = verb ? VERB_ACTIONS[verb] : undefined;
  if (instruction) {
    return {
      classification: 'CUSTOMER_UPDATE',
      matchedCustomerId: customer.id,
      matchedOrderId: null,
      escalated: false,
      mutation: { kind: 'APPLY_INSTRUCTION', customer, instruction }
    };
  }
  const note = rest || 'Group update (no further detail)';
  return {
    classification: 'NOTE',
    matchedCustomerId: customer.id,
    matchedOrderId: null,
    escalated: false,
    mutation: { kind: 'APPEND_NOTE', customerId: customer.id, note: note.slice(0, 150) }
  };
}

function unclear(reason: string): ClassifyProposal {
  return {
    classification: 'UNCLEAR',
    matchedCustomerId: null,
    matchedOrderId: null,
    escalated: true,
    escalationReason: reason,
    mutation: { kind: 'NONE' }
  };
}

function uniqueCustomerProposal(
  db: BusinessDb,
  name: string,
  build: (customer: CustomerRecord) => ClassifyProposal
): ClassifyProposal {
  const candidates = findCustomersByName(db, name);
  if (candidates.length !== 1) {
    return unclear(candidates.length === 0
      ? `No customer matching "${name}"`
      : `${candidates.length} customers matching "${name}" — ambiguous`);
  }
  return build(candidates[0]);
}

async function classifyMessage(
  db: BusinessDb,
  text: string,
  today: string,
  ollama?: OllamaClient
): Promise<ClassifyProposal> {
  if (looksLikeSubscriptionStart(text)) {
    return unclear('Subscription start/change requires manual confirmation');
  }

  if (looksLikeOneOffOrder(text)) {
    const order = parseOneOffOrder(text, today);
    if (order.missing.length > 0) {
      return unclear(`Incomplete order — missing ${order.missing.join(', ')}`);
    }
    const id = generateOneOffOrderId();
    return {
      classification: 'NEW_ORDER',
      matchedCustomerId: null,
      matchedOrderId: id,
      escalated: false,
      mutation: { kind: 'CREATE_ORDER', id, order }
    };
  }

  const actionTokens = [
    /\b(?:hold|skip|resume)\b/i.test(text),
    /\brenew\b/i.test(text),
    /\b(?:restrict|no\s+\w+)\b/i.test(text)
  ].filter(Boolean).length;
  if (actionTokens > 1) {
    return unclear('Combined instructions require manual confirmation');
  }

  const renewMatch = text.match(/^renew\s+((?:[A-Z][\w.]*\s*){1,4})$/i);
  if (renewMatch) {
    const name = renewMatch[1].trim();
    return uniqueCustomerProposal(db, name, customer => ({
      classification: 'CUSTOMER_UPDATE',
      matchedCustomerId: customer.id,
      matchedOrderId: null,
      escalated: false,
      mutation: { kind: 'APPLY_INSTRUCTION', customer, instruction: { type: 'RENEW' } }
    }));
  }

  const verbMatch = matchVerbFirst(text);
  const nameMatch = verbMatch ? null : matchNameFirst(text);
  let name = verbMatch?.name || nameMatch?.name || '';
  let verb: string | null = verbMatch?.verb ?? null;
  let rest = verbMatch?.rest ?? nameMatch?.rest ?? '';

  if (!name && ollama) {
    try {
      const response = await ollama.generate(`Message: "${text}"\n\nExtract and return JSON only:`, LLM_PROMPT, { json: true });
      const parsed = JSON.parse(response.match(/\{[\s\S]*\}/)?.[0] ?? '{}') as { name?: string };
      if (parsed.name) {
        const candidates = findCustomersByName(db, parsed.name);
        const suffix = candidates.length === 1 ? ` (possible customer #${candidates[0].id})` : '';
        return unclear(`LLM-suggested name requires manual review${suffix}`);
      }
    } catch (error) {
      logger.warn({ error, text }, 'Group-update LLM classification failed');
    }
  }

  if (!name) {
    return unclear('No deterministic customer, complete order, or recognizable action found');
  }

  return uniqueCustomerProposal(db, name, customer => proposeCustomerUpdate(db, customer, verb, rest));
}

function applyProposal(db: BusinessDb, proposal: ClassifyProposal, today: string): ClassifyOutcome {
  let actionTaken = proposal.actionTaken ?? '';
  switch (proposal.mutation.kind) {
    case 'CREATE_ORDER': {
      const { id, order } = proposal.mutation;
      db.prepare(`
        INSERT INTO one_time_orders
          (id, customer_name, phone, address, zone, date, time_slot, amount, description, payment_status, remarks)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '')
      `).run(
        id, order.customerName, order.phone, order.address, order.zone, order.date,
        order.timeSlot, order.amount, order.description, order.paymentStatus
      );
      actionTaken = `One-off order ${id} created for ${order.date}`;
      break;
    }
    case 'APPLY_INSTRUCTION': {
      const { customer, instruction } = proposal.mutation;
      const result = applyInstruction(db, customer, instruction, today);
      actionTaken = `${instruction.type} applied — ${result.reply}`;
      break;
    }
    case 'APPEND_NOTE': {
      const { customerId, note } = proposal.mutation;
      appendRemark(db, customerId, `Group note: ${note}`, today);
      actionTaken = `Note appended: ${note}`;
      break;
    }
    case 'NONE':
      break;
  }
  return { ...proposal, actionTaken };
}

/** Process every unprocessed group message: classify, apply, audit, mark done. */
export async function processGroupMessages(db: BusinessDb, today: string, ollama?: OllamaClient): Promise<GroupProcessResult> {
  const pending = db.prepare(`
    SELECT id, participant, message_text, external_message_id, reply_to_external_id
    FROM group_messages WHERE processed_at IS NULL ORDER BY id
  `).all() as GroupMessageRow[];

  const result: GroupProcessResult = { processed: 0, oneOffOrders: 0, customerUpdates: 0, notes: 0, escalated: [] };

  const byExternalId = new Map(
    pending.filter(row => row.external_message_id).map(row => [row.external_message_id, row])
  );
  const children = new Map<string, GroupMessageRow[]>();
  for (const row of pending) {
    if (!row.reply_to_external_id || !byExternalId.has(row.reply_to_external_id)) continue;
    const list = children.get(row.reply_to_external_id) ?? [];
    list.push(row);
    children.set(row.reply_to_external_id, list);
  }

  interface WorkItem {
    rows: GroupMessageRow[];
    text: string;
    forceReviewReason?: string;
  }
  const work: WorkItem[] = [];
  const visited = new Set<number>();
  const collectThread = (row: GroupMessageRow, collected: GroupMessageRow[]): void => {
    if (visited.has(row.id)) return;
    visited.add(row.id);
    collected.push(row);
    for (const child of children.get(row.external_message_id) ?? []) collectThread(child, collected);
  };
  for (const row of pending) {
    if (visited.has(row.id)) continue;
    if (row.reply_to_external_id && byExternalId.has(row.reply_to_external_id)) continue;
    const rows: GroupMessageRow[] = [];
    collectThread(row, rows);
    rows.sort((a, b) => a.id - b.id);
    const referencesProcessedMessage = Boolean(
      row.reply_to_external_id && !byExternalId.has(row.reply_to_external_id)
    );
    work.push({
      rows,
      text: rows.map(part => part.message_text).join('\n'),
      forceReviewReason: referencesProcessedMessage
        ? 'Reply references an already-processed message — manual confirmation required'
        : undefined
    });
  }
  // Defensive fallback for a malformed reply cycle.
  for (const row of pending) {
    if (!visited.has(row.id)) work.push({ rows: [row], text: row.message_text });
  }

  for (const item of work) {
    const primary = item.rows[item.rows.length - 1];
    let proposal: ClassifyProposal;
    try {
      proposal = item.forceReviewReason
        ? unclear(item.forceReviewReason)
        : await classifyMessage(db, item.text, today, ollama);
    } catch (error) {
      logger.error({ error, messageId: primary.id }, 'Group-update classification failed');
      proposal = unclear('Classification error — see logs');
    }

    let outcome: ClassifyOutcome;
    try {
      const commit = db.transaction(() => {
        const applied = applyProposal(db, proposal, today);
        const insertLog = db.prepare(`
          INSERT INTO group_update_log
            (message_id, classification, matched_customer_id, matched_order_id, action_taken, escalated, escalation_reason, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const markProcessed = db.prepare(`UPDATE group_messages SET processed_at = ? WHERE id = ?`);
        for (const row of item.rows) {
          const action = row.id === primary.id
            ? applied.actionTaken
            : `Merged into quoted thread ending at message ${primary.id}`;
          insertLog.run(
            row.id, applied.classification, applied.matchedCustomerId, applied.matchedOrderId,
            action, applied.escalated ? 1 : 0, applied.escalationReason ?? '', today
          );
          markProcessed.run(today, row.id);
        }
        return applied;
      });
      outcome = commit();
    } catch (error) {
      logger.error({ error, messageId: primary.id }, 'Group-update transaction failed');
      outcome = {
        classification: 'UNCLEAR',
        matchedCustomerId: null,
        matchedOrderId: null,
        actionTaken: '',
        escalated: true,
        escalationReason: 'Transaction failed — no changes applied'
      };
      const recordFailure = db.transaction(() => {
        const insertFailure = db.prepare(`
          INSERT INTO group_update_log
            (message_id, classification, matched_customer_id, matched_order_id, action_taken, escalated, escalation_reason, created_at)
          VALUES (?, 'UNCLEAR', NULL, NULL, '', 1, ?, ?)
        `);
        const markProcessed = db.prepare(`UPDATE group_messages SET processed_at = ? WHERE id = ?`);
        for (const row of item.rows) {
          insertFailure.run(row.id, 'Transaction failed — no changes applied', today);
          markProcessed.run(today, row.id);
        }
      });
      recordFailure();
    }

    result.processed += item.rows.length;
    if (outcome.classification === 'NEW_ORDER') result.oneOffOrders++;
    if (outcome.classification === 'CUSTOMER_UPDATE') result.customerUpdates++;
    if (outcome.classification === 'NOTE') result.notes++;
    if (outcome.escalated) {
      result.escalated.push({ text: item.text.slice(0, 200), reason: outcome.escalationReason || 'Unclear' });
    }
  }

  return result;
}

/** Plain-text summary posted back to the group so staff can cross-verify against the Master sheet. */
export function formatGroupSummary(result: GroupProcessResult, date: string): string {
  if (result.processed === 0) return `🌸 Updates check for ${date}: no new messages to process.`;
  const lines = [
    `🌸 Updates processed for ${date}: ${result.processed} message(s)`,
    `🆕 ${result.oneOffOrders} new order(s), 🔁 ${result.customerUpdates} subscription update(s), 📝 ${result.notes} note(s)`
  ];
  if (result.escalated.length > 0) {
    lines.push(`⚠️ ${result.escalated.length} need manual review:`);
    for (const item of result.escalated.slice(0, 15)) {
      lines.push(`• "${item.text}" — ${item.reason}`);
    }
    if (result.escalated.length > 15) lines.push(`…and ${result.escalated.length - 15} more`);
  }
  return lines.join('\n');
}
