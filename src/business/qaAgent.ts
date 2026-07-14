import { BusinessDb } from './db';
import { ChatMessage, LLMProvider } from '../llm/provider';
import { executeQaTool, qaToolDefinitions, QaToolContext } from './qaTools';
import logger from '../utils/logger';

/**
 * Owner Q&A over the business datastore using a cloud LLM with read-only
 * tools. Two steps, per the owner's requirement that every prompt is refined
 * before acting:
 *
 *   1. REFINE — rewrite the short WhatsApp-style question into an explicit,
 *      detailed query (which figures? which date? which ranking?).
 *   2. ANSWER — a tool-calling loop where the model runs read-only queries
 *      (deliveries, collections, customers, renewals…) and composes a reply.
 *
 * Failures throw; the caller (GroupAssistant) falls back to the local
 * Ollama snapshot and then the deterministic answers.
 */

const MAX_TOOL_ROUNDS = 6;

const REFINE_SYSTEM = `You rewrite short, informal questions from a flower-subscription
business owner (Gurgaon, India) into one explicit, detailed analytical question.
Spell out exactly what to compute or look up: the metric, the date ("today" or
"tomorrow" is fine), any ranking or limit, and the entities involved. Keep the
owner's intent — never add requests they did not make. Reply with ONLY the
rewritten question, nothing else.`;

const ANSWER_SYSTEM = `You are the ops assistant for Bring My Flowers, a flower-subscription
business in Gurgaon. Answer the owner's question by calling the read-only data
tools — never guess or invent numbers, names, or dates. Call as many tools as
needed, then reply in WhatsApp-style plain text: brief (under 120 words),
concrete figures with ₹ for money, dates as "15 Jul". If the data genuinely
cannot answer, say what is missing. Today's date is provided in the question
context. You cannot change any data; if asked to modify something, explain the
change must go through the Updates group or the review dashboard.`;

export interface QaAgentDeps {
  provider: LLMProvider;
  db: BusinessDb;
  today: string;
}

/** Step 1 — refine the raw question. Falls back to the original on any failure. */
export async function refineQuestion(provider: LLMProvider, question: string, today: string): Promise<string> {
  try {
    const result = await provider.chat(REFINE_SYSTEM, [
      { role: 'user', content: `Today is ${today}. Owner's question: "${question}"` }
    ], []);
    const refined = result.text.trim();
    // A refusal, apology, or runaway rewrite is worse than the original.
    if (refined.length >= 10 && refined.length <= 600) return refined;
  } catch (error) {
    logger.warn({ error }, 'Question refinement failed — using the original question');
  }
  return question;
}

/** Step 2 — the tool-calling answer loop. Throws when the provider fails. */
export async function answerQuestion(deps: QaAgentDeps, question: string): Promise<string> {
  const { provider, db, today } = deps;
  const refined = await refineQuestion(provider, question, today);
  const tools = qaToolDefinitions();

  const messages: ChatMessage[] = [{
    role: 'user',
    content: `Today is ${today}.\nOriginal question: "${question}"\nRefined question: "${refined}"`
  }];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const result = await provider.chat(ANSWER_SYSTEM, messages, tools);

    if (result.toolCalls.length === 0) {
      if (result.text.trim()) return result.text.trim();
      throw new Error('Provider returned an empty answer');
    }

    messages.push({ role: 'assistant', content: result.text, toolCalls: result.toolCalls });
    for (const call of result.toolCalls) {
      const output = executeQaTool({ db, today }, call.name, call.input);
      logger.info({ tool: call.name, input: call.input }, 'Q&A tool call');
      messages.push({ role: 'tool', toolCallId: call.id, content: output });
    }
  }

  // Out of rounds — force a final text answer with no more tools on offer.
  const final = await provider.chat(ANSWER_SYSTEM, [
    ...messages,
    { role: 'user', content: 'Answer now with the information gathered so far.' }
  ], []);
  if (final.text.trim()) return final.text.trim();
  throw new Error('Provider did not produce a final answer');
}

const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

/**
 * Deterministic answers using the same read-only tools as the cloud agent.
 * No API key required — covers the questions owners ask most often.
 */
export function answerWithLocalTools(context: QaToolContext, question: string): string | null {
  const q = question.toLowerCase().trim();

  if (/\b(most|highest|top|biggest|maximum|max)\b/.test(q) &&
      /\b(owe|owes|owing|debt|pending|collect|due)\b/.test(q)) {
    const data = JSON.parse(executeQaTool(context, 'get_pending_collections', { limit: 1 }));
    const top = data.topDebtors?.[0] as { name: string; owed: number } | undefined;
    if (!top) return 'No pending collections right now.';
    return `${top.name} owes the most — ${rupees(top.owed)} (${rupees(data.totalPending)} pending in total).`;
  }

  const owePatterns = [
    /how much does (.+?) owe/,
    /how much (.+?) owe/,
    /does (.+?) owe/,
    /(.+?)(?:'s)? (?:balance|outstanding|pending|debt)\b/,
    /how much does (.+?) owes/,
    /does (.+?) owes/
  ];
  for (const pattern of owePatterns) {
    const match = q.match(pattern);
    if (!match) continue;
    const name = match[1].replace(/\b(us|we|the customer|customer)\b/g, '').trim();
    if (name.length < 3) continue;
    const customers = JSON.parse(executeQaTool(context, 'find_customer', { name })) as Array<{
      name: string; amountOwed: number; nextDelivery: string | null;
    }>;
    if (customers.length === 1) {
      const customer = customers[0];
      const next = customer.nextDelivery ? ` Next delivery: ${customer.nextDelivery}.` : '';
      return customer.amountOwed > 0
        ? `${customer.name} owes ${rupees(customer.amountOwed)}.${next}`
        : `${customer.name} has nothing pending to collect.${next}`;
    }
    if (customers.length > 1) {
      return `${customers.length} customers match "${name}" — please be more specific.`;
    }
    return `No customer found matching "${name}".`;
  }

  if (/\b(total|amount|revenue|money|collect|sales)\b/.test(q) &&
      /\b(today|tomorrow|order|delivery|deliveries)\b/.test(q)) {
    const date = /\btomorrow\b/.test(q) ? 'tomorrow' : 'today';
    const data = JSON.parse(executeQaTool(context, 'get_deliveries', { date }));
    return `${data.count} deliveries on ${data.date}: revenue ${rupees(data.totalRevenue)}, to collect ${rupees(data.totalToCollect)}.`;
  }

  if (/\bwho owes\b|\bdebtors?\b|\bpending collection/.test(q)) {
    const data = JSON.parse(executeQaTool(context, 'get_pending_collections', { limit: 5 }));
    if (!data.topDebtors?.length) return 'No pending collections.';
    const lines = (data.topDebtors as Array<{ name: string; owed: number }>)
      .map((row, index) => `${index + 1}. ${row.name} — ${rupees(row.owed)}`);
    return `${rupees(data.totalPending)} pending in total:\n${lines.join('\n')}`;
  }

  if (/\b(review|manual|unclear|escalat|needs attention)\b/.test(q)) {
    const data = JSON.parse(executeQaTool(context, 'get_review_queue', {}));
    const count = data.unresolvedReviewItems?.length ?? 0;
    if (count === 0) return 'Review queue is clear — nothing waiting for manual handling.';
    const preview = (data.unresolvedReviewItems as Array<{ message_text: string }>)
      .slice(0, 3)
      .map((item, index) => `${index + 1}. ${item.message_text.slice(0, 80)}…`);
    return `${count} item(s) need review (${data.unprocessedStagedMessages} staged, unprocessed):\n${preview.join('\n')}`;
  }

  if (/\b(summary|overview|status)\b/.test(q) && q.length < 80) {
    const data = JSON.parse(executeQaTool(context, 'get_business_overview', {}));
    return [
      `Today: ${data.today.count} deliveries (${rupees(data.today.revenue)} revenue).`,
      `Tomorrow: ${data.tomorrow.count} deliveries.`,
      `Pending collections: ${rupees(data.pendingCollectionsTotal)}.`,
      `Renewals due: ${data.renewalsDue}.`,
      `Staged group updates: ${data.stagedGroupUpdates}.`
    ].join('\n');
  }

  return null;
}
