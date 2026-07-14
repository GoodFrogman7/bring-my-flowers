import { BusinessDb } from './db';
import { MessageSender } from '../bot/messageSender';
import { OllamaClient } from '../llm/ollama';
import {
  insertGroupMessage,
  GroupMessageMetadata,
  processGroupMessages,
  formatGroupSummary,
  extractPhone,
  matchVerbFirst,
  findCustomersByName
} from './groupUpdates';
import { dueRows, writeDelSheetDetailed } from './delSheet';
import { buildProcurement, loadFlowers } from './assignment';
import { renewalsDue } from './paymentRun';
import { todayIST, addDays } from './dates';
import { LLMProvider } from '../llm/provider';
import { answerQuestion, answerWithLocalTools } from './qaAgent';
import logger from '../utils/logger';

/**
 * Live layer over the "Updates" group, on top of the nightly ingestion:
 *
 *   "Bot, <question>"  → answered immediately from the datastore
 *   "Bot, send sheet"  → pending updates applied, sheet sent to the group
 *   operational update → staged for the nightly run
 *   ordinary message   → staged silently, so the bot keeps up without replying
 *
 * Routing is deterministic and biased toward staging: a message is only
 * intercepted when staff explicitly invokes the bot.
 * Staff shorthand ("Hold Neeraj?", anything with a phone number) always wins,
 * because a missed update is worse than an unanswered question — staged
 * messages still get the nightly escalation safety net.
 */

export type GroupRoute =
  | { kind: 'UPDATE' }
  | { kind: 'QUESTION' }
  | { kind: 'SHEET_REQUEST'; date: string };

const SHEET_ASK = /\b(?:send|share|give|show|get|need|want|make|bana|bhej\w*|chahiye)\b[\s\S]{0,40}?\b(?:del(?:ivery)?\s*)?sheet\b|\bsheet\b\s*(?:please|pls|plz|now|today|tomorrow|aaj|kal)\b|^\s*(?:del(?:ivery)?\s*)?sheet\b[\s\S]{0,30}$/i;

const BOT_CALL = /^(?:@?bot|flower\s*bot|bmf(?:\s*bot)?)\b[\s,:-]*/i;

function sheetDate(text: string, today: string): string {
  const explicit = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (explicit) return explicit[1];
  if (/\b(?:today|aaj|todays|today's)\b/i.test(text)) return today;
  // The del sheet is prepared for the next morning's run — default tomorrow.
  return addDays(today, 1);
}

/**
 * Deterministic router. Only an explicit Bot/Flower Bot/BMF prefix can trigger
 * a response. Clear operational instructions remain updates without a prefix.
 */
export function routeGroupMessage(text: string, today: string): GroupRoute {
  const original = text.trim();
  const invoked = BOT_CALL.test(original);
  const trimmed = invoked ? original.replace(BOT_CALL, '').trim() : original;
  // Staff shorthand always outranks Q&A: a phone number means a new order,
  // a leading hold/skip/resume/restrict verb means a schedule instruction —
  // even when phrased with a question mark ("Hold Neeraj?").
  if (extractPhone(trimmed)) return { kind: 'UPDATE' };
  if (matchVerbFirst(trimmed)) return { kind: 'UPDATE' };

  if (invoked && SHEET_ASK.test(trimmed)) return { kind: 'SHEET_REQUEST', date: sheetDate(trimmed, today) };
  if (invoked) return { kind: 'QUESTION' };
  return { kind: 'UPDATE' };
}

// ---- Question answering --------------------------------------------------------

const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'you', 'today', 'tomorrow', 'delivery', 'deliveries',
  'sheet', 'flower', 'flowers', 'stock', 'pending', 'payment', 'payments', 'going',
  'out', 'what', 'how', 'many', 'much', 'when', 'who', 'which', 'where', 'status',
  'order', 'orders', 'customer', 'customers', 'database', 'about', 'any', 'have',
  'has', 'does', 'kitne', 'kitna', 'kya', 'kab', 'aaj', 'kal', 'hai', 'bot'
]);

interface NamedCustomerContext {
  header: string;
  lines: string[];
}

/** Profile blocks for any customer whose name appears in the question. */
function namedCustomerContext(db: BusinessDb, question: string, today: string): NamedCustomerContext[] {
  const words = [...new Set(
    (question.match(/[A-Za-z]{3,}/g) ?? []).filter(word => !STOPWORDS.has(word.toLowerCase()))
  )];
  const seen = new Set<string>();
  const blocks: NamedCustomerContext[] = [];

  for (const word of words) {
    const candidates = findCustomersByName(db, word);
    // A word matching more than 3 customers is a common token, not a name.
    if (candidates.length === 0 || candidates.length > 3) continue;
    for (const customer of candidates) {
      if (seen.has(customer.id) || blocks.length >= 3) continue;
      seen.add(customer.id);
      const subscription = db.prepare(`
        SELECT package_name, pack_amount, frequency, day, time_slot, status
        FROM subscriptions WHERE customer_id = ? ORDER BY id DESC LIMIT 1
      `).get(customer.id) as { package_name: string; pack_amount: number; frequency: string; day: string; time_slot: string; status: string } | undefined;
      const nextDelivery = db.prepare(`
        SELECT COALESCE(NULLIF(d.changed_date,''), d.planned_date) AS date FROM deliveries d
        JOIN cycles cy ON d.cycle_id = cy.id JOIN subscriptions s ON cy.subscription_id = s.id
        WHERE s.customer_id = ? AND d.status = 'PLANNED' AND date >= ? ORDER BY date LIMIT 1
      `).get(customer.id, today) as { date: string } | undefined;
      const owed = db.prepare(`
        SELECT COALESCE(SUM(cy.collect), 0) AS owed FROM cycles cy
        JOIN subscriptions s ON cy.subscription_id = s.id
        WHERE s.customer_id = ? AND cy.payment_status = 'PENDING' AND cy.collect > 0
      `).get(customer.id) as { owed: number };
      const lines = [
        `address: ${customer.address} (${customer.zone})`,
        subscription
          ? `subscription: ${subscription.package_name} ₹${subscription.pack_amount} ${subscription.frequency} ${subscription.day} ${subscription.time_slot} — ${subscription.status}`
          : 'subscription: none',
        `next delivery: ${nextDelivery?.date ?? 'none planned'}`,
        owed.owed > 0 ? `amount owed: ₹${owed.owed}` : 'amount owed: ₹0'
      ];
      blocks.push({ header: `#${customer.id} ${customer.name}`, lines });
    }
  }
  return blocks;
}

/** Everything the LLM is allowed to answer from, as plain text. */
export function buildBusinessSnapshot(db: BusinessDb, question: string, today: string): string {
  const tomorrow = addDays(today, 1);
  const sections: string[] = [`today: ${today} · tomorrow: ${tomorrow}`];

  for (const [label, date] of [['TODAY', today], ['TOMORROW', tomorrow]] as const) {
    const rows = dueRows(db, date);
    const byZone = new Map<string, number>();
    for (const row of rows) byZone.set(row.zone || '?', (byZone.get(row.zone || '?') ?? 0) + 1);
    const zoneLine = [...byZone.entries()].map(([zone, count]) => `${zone}: ${count}`).join(', ') || 'none';
    const list = rows.slice(0, 30).map(row =>
      `#${row.id} ${row.name} (${row.zone}${row.timeSlot ? ', ' + row.timeSlot : ''}) ${row.packageName}${row.collect !== '' ? ` — collect ₹${row.collect}` : ''}`
    ).join('\n');
    sections.push(
      `DELIVERIES ${label} (${date}): ${rows.length} total — zones: ${zoneLine}` +
      (list ? `\n${list}` : '') +
      (rows.length > 30 ? `\n…and ${rows.length - 30} more` : '')
    );
  }

  const procurement = buildProcurement(dueRows(db, tomorrow).map(row => row.assigned), loadFlowers(db));
  if (procurement.length > 0) {
    sections.push(
      `TO BUY for tomorrow (auto-assigned rows only):\n` +
      procurement.map(line => `${line.flower}: ${line.sticksNeeded} sticks → ${line.bunchesToBuy} bunches, ~₹${line.estimatedCost}`).join('\n') +
      `\nTotal est. ₹${procurement.reduce((sum, line) => sum + line.estimatedCost, 0)}`
    );
  }

  const pending = db.prepare(`
    SELECT c.id, c.name, cy.collect FROM cycles cy
    JOIN subscriptions s ON cy.subscription_id = s.id
    JOIN customers c ON s.customer_id = c.id
    WHERE cy.payment_status = 'PENDING' AND cy.collect > 0 AND s.status = 'ACTIVE'
    ORDER BY cy.collect DESC LIMIT 10
  `).all() as Array<{ id: string; name: string; collect: number }>;
  const pendingTotal = (db.prepare(`
    SELECT COALESCE(SUM(cy.collect), 0) AS total FROM cycles cy
    JOIN subscriptions s ON cy.subscription_id = s.id
    WHERE cy.payment_status = 'PENDING' AND cy.collect > 0 AND s.status = 'ACTIVE'
  `).get() as { total: number }).total;
  sections.push(
    `PENDING COLLECTIONS: ₹${pendingTotal} total` +
    (pending.length ? `, top: ${pending.map(row => `#${row.id} ${row.name} ₹${row.collect}`).join(', ')}` : '')
  );

  const renewals = renewalsDue(db, today);
  sections.push(`RENEWALS DUE: ${renewals.length}` +
    (renewals.length ? ` — ${renewals.slice(0, 10).map(renewal => `#${renewal.customerId} ${renewal.name}`).join(', ')}` : ''));

  const staged = (db.prepare(`SELECT COUNT(*) AS n FROM group_messages WHERE processed_at IS NULL`).get() as { n: number }).n;
  sections.push(`UNPROCESSED GROUP UPDATES (apply at the nightly run or on "send sheet"): ${staged}`);

  for (const block of namedCustomerContext(db, question, today)) {
    sections.push(`CUSTOMER ${block.header}\n${block.lines.join('\n')}`);
  }

  return sections.join('\n\n');
}

const ANSWER_PROMPT = `You are the ops assistant for Bring My Flowers, a flower-subscription
business in Gurgaon. Staff ask questions in the ops WhatsApp group. Answer
ONLY from the DATA section — never invent numbers, names, or dates. Be brief
(under 100 words), WhatsApp-style plain text, ₹ for money. If the data cannot
answer the question, say so and suggest "send sheet" for the full delivery
sheet or checking with the owner. Do not repeat the whole data dump back.`;

/** Deterministic answers for the common asks when Ollama is unavailable. */
export function fallbackAnswer(db: BusinessDb, question: string, today: string): string {
  const q = question.toLowerCase();
  const date = /\b(tomorrow|kal)\b/.test(q) ? addDays(today, 1) : today;

  // A question naming a specific customer beats every generic pattern —
  // "when is Sarika's next delivery?" must not get the whole day's counts.
  const named = namedCustomerContext(db, question, today);
  if (named.length >= 1 && named.length <= 2) {
    return named.map(block => `👤 ${block.header}\n${block.lines.join('\n')}`).join('\n\n');
  }

  if (/deliver|going out|orders?\b|route|kitn/.test(q)) {
    const rows = dueRows(db, date);
    if (rows.length === 0) return `No deliveries due ${date}.`;
    const byZone = new Map<string, number>();
    for (const row of rows) byZone.set(row.zone || '?', (byZone.get(row.zone || '?') ?? 0) + 1);
    const zoneLine = [...byZone.entries()].map(([zone, count]) => `${zone}: ${count}`).join(', ');
    return `📋 ${rows.length} deliveries due ${date} — ${zoneLine}. Say "send sheet" for the full sheet.`;
  }
  if (/stock|to buy|procure|bunch|flower/.test(q)) {
    const tomorrow = addDays(today, 1);
    const procurement = buildProcurement(dueRows(db, tomorrow).map(row => row.assigned), loadFlowers(db));
    if (procurement.length === 0) return `Nothing auto-assigned to buy for ${tomorrow} yet — say "send sheet" and check the Procurement tab.`;
    return `🛒 To buy for ${tomorrow}:\n` +
      procurement.map(line => `${line.flower}: ${line.bunchesToBuy} bunches (~₹${line.estimatedCost})`).join('\n');
  }
  if (/pending|collect|payment|due amount|paisa|money/.test(q)) {
    const total = (db.prepare(`
      SELECT COALESCE(SUM(cy.collect), 0) AS total FROM cycles cy
      JOIN subscriptions s ON cy.subscription_id = s.id
      WHERE cy.payment_status = 'PENDING' AND cy.collect > 0 AND s.status = 'ACTIVE'
    `).get() as { total: number }).total;
    return `💰 ₹${total} pending collection across active subscriptions.`;
  }
  if (/renew/.test(q)) {
    return `🔁 ${renewalsDue(db, today).length} renewals due.`;
  }
  return `🤖 I couldn't work that one out. Try asking about deliveries, stock, pending payments or renewals — or say "send sheet" for the delivery sheet.`;
}

// ---- The assistant -------------------------------------------------------------

export interface GroupAssistantOptions {
  db: BusinessDb;
  sender: MessageSender;
  groupJid: string;
  ollama?: OllamaClient;
  /** Cloud LLM (Anthropic/OpenAI). When set, questions get refined and answered with read-only tools. */
  provider?: LLMProvider;
  delSheetDir?: string;
  today?: () => string;
}

export class GroupAssistant {
  private busy = false;
  private today: () => string;

  constructor(private options: GroupAssistantOptions) {
    this.today = options.today ?? todayIST;
  }

  async handle(
    participant: string,
    text: string,
    metadata: GroupMessageMetadata & { receivedAt?: string } = {}
  ): Promise<void> {
    const { db, sender, groupJid } = this.options;
    const today = this.today();
    const route = routeGroupMessage(text, today);

    if (route.kind === 'UPDATE') {
      // If staff prefixed an operational instruction with "Bot", persist the
      // instruction itself so the nightly classifier still recognizes it.
      insertGroupMessage(
        db,
        participant,
        text.trim().replace(BOT_CALL, '').trim(),
        metadata.receivedAt ?? new Date().toISOString(),
        metadata
      );
      return;
    }

    try {
      if (route.kind === 'SHEET_REQUEST') {
        await this.sendSheet(route.date, today);
        return;
      }
      await sender.sendMessage(groupJid, await this.answer(text, today));
    } catch (error) {
      logger.error({ error, participant, text }, 'Group assistant failed');
      await sender.sendMessage(groupJid, '⚠️ Something went wrong handling that — please try again.');
    }
  }

  async answer(question: string, today: string): Promise<string> {
    const result = await this.answerDetailed(question, today);
    return result.answer;
  }

  /** Same degradation chain, but exposes which layer produced the reply. */
  async answerDetailed(question: string, today: string): Promise<{ answer: string; mode: string }> {
    const { db, ollama, provider } = this.options;

    if (provider) {
      try {
        return { answer: await answerQuestion({ provider, db, today }, question), mode: `cloud (${provider.name})` };
      } catch (error) {
        logger.warn({ error, provider: provider.name, question }, 'Cloud Q&A failed — falling back to local answering');
      }
    }

    const local = answerWithLocalTools({ db, today }, question);
    if (local) return { answer: local, mode: 'local-tools' };

    const snapshot = buildBusinessSnapshot(db, question, today);
    if (ollama) {
      try {
        const reply = await ollama.generate(
          `DATA:\n${snapshot}\n\nSTAFF QUESTION: "${question}"\n\nAnswer:`,
          ANSWER_PROMPT
        );
        if (reply) return { answer: reply, mode: 'ollama' };
      } catch (error) {
        logger.warn({ error, question }, 'Group Q&A LLM failed — using fallback');
      }
    }
    return { answer: fallbackAnswer(db, question, today), mode: 'fallback' };
  }

  /**
   * Apply everything staged so far, then generate and send the sheet — so an
   * afternoon "send sheet" reflects the morning's group chatter, same as the
   * nightly run would. Escalations surface immediately (the nightly summary
   * will not re-report messages processed here).
   */
  private async sendSheet(date: string, today: string): Promise<void> {
    const { db, sender, groupJid, ollama, delSheetDir } = this.options;
    if (this.busy) {
      await sender.sendMessage(groupJid, '⏳ Already preparing a sheet — one moment.');
      return;
    }
    this.busy = true;
    try {
      const result = await processGroupMessages(db, today, ollama);
      const outPath = `${delSheetDir ?? './data'}/del-sheet-${date}.xlsx`;
      const sheet = writeDelSheetDetailed(db, date, outPath);

      if (result.processed > 0) {
        await sender.sendMessage(groupJid, formatGroupSummary(result, today));
      }

      const caption = `📋 Delivery sheet for ${date} — ${sheet.rows} rows, ${sheet.autoAssigned} auto-assigned` +
        (sheet.manual.length > 0 ? `, ${sheet.manual.length} manual (see Procurement tab)` : '');
      if (sender.sendDocument) {
        const sent = await sender.sendDocument(groupJid, outPath, caption);
        if (!sent) await sender.sendMessage(groupJid, `${caption}\n(⚠️ file send failed — it is saved at ${outPath})`);
      } else {
        await sender.sendMessage(groupJid, `${caption}\n→ ${outPath}`);
      }
    } finally {
      this.busy = false;
    }
  }
}
