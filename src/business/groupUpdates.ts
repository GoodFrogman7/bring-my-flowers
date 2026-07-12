import { BusinessDb } from './db';
import { Instruction, parseTargetDate } from './instructions';
import { applyInstruction, appendRemark, CustomerRecord } from './actions';
import { addDays } from './dates';
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
}

const LLM_PROMPT = `Staff post short-hand updates in a flower-delivery ops WhatsApp group,
about EXISTING customers referenced by name only (no phone number). Extract the
customer's name and the intended action, if any.
Reply ONLY with JSON: {"name": "full name or null", "action": "HOLD"|"SKIP"|"RESUME"|"NOTE"|null}`;

/** Stage a group message the instant it arrives. No parsing here — just durability. */
export function insertGroupMessage(db: BusinessDb, participant: string, text: string, receivedAt: string): number {
  const result = db.prepare(`
    INSERT INTO group_messages (participant, message_text, received_at) VALUES (?, ?, ?)
  `).run(participant, text, receivedAt);
  return result.lastInsertRowid as number;
}

/** Last-10-digit phone found anywhere in the message text, or null. */
function extractPhone(text: string): string | null {
  const match = text.match(/(\+?\d[\d\s-]{8,14}\d)/);
  if (!match) return null;
  const digits = match[1].replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : null;
}

/** Best-effort name for a new order: "... to Chandrima +91..." → "Chandrima". */
function extractOrderName(text: string): string {
  const match = text.match(/\bto\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2})\b/);
  return match ? match[1].trim() : '';
}

function extractTimeSlot(text: string): string {
  const match = text.match(/\bby\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i);
  return match ? match[1].trim() : '';
}

/** Explicit date phrase, else tomorrow (least-destructive default; flagged in the caller). */
function extractOrderDate(text: string, today: string): { date: string; defaulted: boolean } {
  const target = parseTargetDate(text.toLowerCase(), today);
  return target ? { date: target, defaulted: false } : { date: addDays(today, 1), defaulted: true };
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
function matchVerbFirst(text: string): { verb: string; name: string; rest: string } | null {
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

function findCustomersByName(db: BusinessDb, name: string): CustomerRecord[] {
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

function applyCustomerUpdate(
  db: BusinessDb,
  customer: CustomerRecord,
  verb: string | null,
  rest: string,
  today: string
): { actionTaken: string; classification: GroupClassification } {
  const instruction = verb ? VERB_ACTIONS[verb] : undefined;
  if (instruction) {
    const result = applyInstruction(db, customer, instruction, today);
    return { actionTaken: `${instruction.type} applied — ${result.reply}`, classification: 'CUSTOMER_UPDATE' };
  }
  const note = rest || 'Group update (no further detail)';
  appendRemark(db, customer.id, `Group note: ${note.slice(0, 150)}`, today);
  return { actionTaken: `Note appended: ${note.slice(0, 150)}`, classification: 'NOTE' };
}

async function classifyAndApply(
  db: BusinessDb,
  text: string,
  today: string,
  ollama?: OllamaClient
): Promise<ClassifyOutcome> {
  const phone = extractPhone(text);
  if (phone) {
    const name = extractOrderName(text);
    const timeSlot = extractTimeSlot(text);
    const { date, defaulted } = extractOrderDate(text, today);
    const id = generateOneOffOrderId();
    db.prepare(`
      INSERT INTO one_time_orders (id, customer_name, phone, address, zone, date, time_slot, amount, description, payment_status, remarks)
      VALUES (?, ?, ?, '', '', ?, ?, 0, ?, 'PENDING', ?)
    `).run(id, name, phone, date, timeSlot, text.slice(0, 300), defaulted ? 'Date not stated — defaulted to next day' : '');
    return {
      classification: 'NEW_ORDER',
      matchedCustomerId: null,
      matchedOrderId: id,
      actionTaken: `One-off order ${id} created for ${date}${defaulted ? ' (date defaulted)' : ''}`,
      escalated: defaulted,
      escalationReason: defaulted ? 'New order had no explicit date — defaulted to next day, verify' : undefined
    };
  }

  const verbMatch = matchVerbFirst(text);
  const nameMatch = verbMatch ? null : matchNameFirst(text);
  let name = verbMatch?.name || nameMatch?.name || '';
  let verb: string | null = verbMatch?.verb ?? null;
  let rest = verbMatch?.rest ?? nameMatch?.rest ?? '';

  if (!name && ollama) {
    try {
      const response = await ollama.generate(`Message: "${text}"\n\nExtract and return JSON only:`, LLM_PROMPT, { json: true });
      const parsed = JSON.parse(response.match(/\{[\s\S]*\}/)?.[0] ?? '{}') as { name?: string; action?: string };
      if (parsed.name) {
        name = parsed.name;
        verb = (parsed.action || '').toLowerCase() in VERB_ACTIONS ? (parsed.action || '').toLowerCase() : null;
        rest = text;
      }
    } catch (error) {
      logger.warn({ error, text }, 'Group-update LLM classification failed');
    }
  }

  if (!name) {
    return {
      classification: 'UNCLEAR',
      matchedCustomerId: null,
      matchedOrderId: null,
      actionTaken: '',
      escalated: true,
      escalationReason: 'No name, phone, or recognizable action found'
    };
  }

  const candidates = findCustomersByName(db, name);
  if (candidates.length !== 1) {
    return {
      classification: 'UNCLEAR',
      matchedCustomerId: null,
      matchedOrderId: null,
      actionTaken: '',
      escalated: true,
      escalationReason: candidates.length === 0 ? `No customer matching "${name}"` : `${candidates.length} customers matching "${name}" — ambiguous`
    };
  }

  const { actionTaken, classification } = applyCustomerUpdate(db, candidates[0], verb, rest, today);
  return {
    classification,
    matchedCustomerId: candidates[0].id,
    matchedOrderId: null,
    actionTaken,
    escalated: false
  };
}

/** Process every unprocessed group message: classify, apply, audit, mark done. */
export async function processGroupMessages(db: BusinessDb, today: string, ollama?: OllamaClient): Promise<GroupProcessResult> {
  const pending = db.prepare(`
    SELECT id, participant, message_text FROM group_messages WHERE processed_at IS NULL ORDER BY id
  `).all() as GroupMessageRow[];

  const result: GroupProcessResult = { processed: 0, oneOffOrders: 0, customerUpdates: 0, notes: 0, escalated: [] };

  for (const row of pending) {
    let outcome: ClassifyOutcome;
    try {
      outcome = await classifyAndApply(db, row.message_text, today, ollama);
    } catch (error) {
      logger.error({ error, messageId: row.id }, 'Group-update processing failed');
      outcome = {
        classification: 'UNCLEAR',
        matchedCustomerId: null,
        matchedOrderId: null,
        actionTaken: '',
        escalated: true,
        escalationReason: 'Processing error — see logs'
      };
    }

    const commit = db.transaction(() => {
      db.prepare(`
        INSERT INTO group_update_log (message_id, classification, matched_customer_id, matched_order_id, action_taken, escalated, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(row.id, outcome.classification, outcome.matchedCustomerId, outcome.matchedOrderId, outcome.actionTaken, outcome.escalated ? 1 : 0, today);
      db.prepare(`UPDATE group_messages SET processed_at = ? WHERE id = ?`).run(today, row.id);
    });
    commit();

    result.processed++;
    if (outcome.classification === 'NEW_ORDER') result.oneOffOrders++;
    if (outcome.classification === 'CUSTOMER_UPDATE') result.customerUpdates++;
    if (outcome.classification === 'NOTE') result.notes++;
    if (outcome.escalated) result.escalated.push({ text: row.message_text.slice(0, 200), reason: outcome.escalationReason || 'Unclear' });
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
