/**
 * Run the labelled message corpus through the real nightly pipeline
 * (processGroupMessages) and report what it actually did with each message.
 *
 * Every message gets a fresh in-memory database seeded with the corpus's
 * fictional customers, so outcomes are independent and no real data is
 * touched. Read-only with respect to the repo's data/ folder.
 *
 *   npx ts-node scripts/evidence/probe-corpus.ts [corpus.json] [out.md]
 */
import * as fs from 'fs';
import * as path from 'path';
import { openDb, BusinessDb } from '../../src/business/db';
import { insertGroupMessage, processGroupMessages } from '../../src/business/groupUpdates';
import { cycleDates, nextWeekdayAfter, addDays, weekdayIndex } from '../../src/business/dates';

export interface CorpusCustomer {
  id: string; name: string; phones: string; package: string; pack: number;
  day: string; frequency: string; day2: string;
}
export interface CorpusMessage {
  id: string; text: string; type: string; replyTo?: string;
  expected: { action: string; [key: string]: unknown };
  mustNotMutate: boolean; verified: boolean;
}
export interface Corpus { today: string; customers: CorpusCustomer[]; messages: CorpusMessage[] }

export interface ProbeResult {
  id: string;
  type: string;
  classification: string;
  escalated: boolean;
  reason: string;
  actionTaken: string;
  changes: string[];
  verdict: 'SAFE_REVIEW' | 'UNSAFE_MUTATION' | 'NEEDS_CHECK' | 'NOT_ACTED' | 'NO_LOG';
}

export function seedCorpusCustomers(db: BusinessDb, customers: CorpusCustomer[], today: string): void {
  for (const c of customers) {
    db.prepare(`INSERT INTO customers (id, name, phones, address, zone) VALUES (?, ?, ?, ?, 'Zone A')`)
      .run(c.id, c.name, c.phones, `House ${c.id}, Sample Society`);
    const sub = db.prepare(`
      INSERT INTO subscriptions (customer_id, package_name, pack_amount, frequency, day, day2, status)
      VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')
    `).run(c.id, c.package, c.pack, c.frequency, c.day, c.day2);
    const cycle = db.prepare(`
      INSERT INTO cycles (subscription_id, renewal_date, deliveries_planned, pack_amount, per_delivery_revenue, payment_status, collect)
      VALUES (?, ?, 4, ?, ?, 'PENDING', ?)
    `).run(sub.lastInsertRowid, today, c.pack, c.pack / 4, c.pack);
    const first = nextWeekdayAfter(addDays(today, -1), weekdayIndex(c.day));
    cycleDates(first, c.frequency, c.day2).forEach((date, i) => {
      db.prepare(`INSERT INTO deliveries (cycle_id, seq, planned_date, status) VALUES (?, ?, ?, 'PLANNED')`)
        .run(cycle.lastInsertRowid, i + 1, date);
    });
  }
}

/** Everything a group message could plausibly change, as comparable lines. */
function snapshot(db: BusinessDb): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of db.prepare(`SELECT id, name, address, remarks, extra_instruction FROM customers`).all() as Array<Record<string, string>>) {
    out.set(`customer ${r.id} (${r.name})`, `address="${r.address}" remarks="${r.remarks}" extra="${r.extra_instruction}"`);
  }
  for (const r of db.prepare(`SELECT customer_id, status, day, day2, time_slot FROM subscriptions`).all() as Array<Record<string, string>>) {
    out.set(`subscription of ${r.customer_id}`, `status=${r.status} day=${r.day} day2=${r.day2} slot="${r.time_slot}"`);
  }
  for (const r of db.prepare(`
    SELECT s.customer_id, cy.id, cy.payment_status, cy.payment_mode, cy.amount_received, cy.collect
    FROM cycles cy JOIN subscriptions s ON cy.subscription_id = s.id
  `).all() as Array<Record<string, string | number | null>>) {
    out.set(`cycle ${r.id} of ${r.customer_id}`, `payment=${r.payment_status} mode="${r.payment_mode}" received=${r.amount_received} collect=${r.collect}`);
  }
  for (const r of db.prepare(`
    SELECT s.customer_id, d.planned_date, d.changed_date, d.status
    FROM deliveries d JOIN cycles cy ON d.cycle_id = cy.id JOIN subscriptions s ON cy.subscription_id = s.id
  `).all() as Array<Record<string, string>>) {
    out.set(`delivery ${r.customer_id} ${r.planned_date}`, `status=${r.status}${r.changed_date ? ` moved→${r.changed_date}` : ''}`);
  }
  for (const r of db.prepare(`SELECT * FROM one_time_orders`).all() as Array<Record<string, string | number>>) {
    out.set(`one-off ${r.id}`, `name="${r.customer_name}" phone=${r.phone} date=${r.delivery_date} amount=${r.amount} payment=${r.payment_status} address="${r.address}"`);
  }
  return out;
}

function diff(before: Map<string, string>, after: Map<string, string>): string[] {
  const changes: string[] = [];
  for (const [key, value] of after) {
    const old = before.get(key);
    if (old === undefined) changes.push(`+ ${key}: ${value}`);
    else if (old !== value) changes.push(`~ ${key}: ${old} → ${value}`);
  }
  for (const key of before.keys()) if (!after.has(key)) changes.push(`- ${key}`);
  return changes;
}

export async function probeMessage(corpus: Corpus, message: CorpusMessage): Promise<ProbeResult> {
  const db = openDb(':memory:');
  try {
    seedCorpusCustomers(db, corpus.customers, corpus.today);
    const before = snapshot(db);
    insertGroupMessage(db, '910000000000', message.text, `${corpus.today}T10:00:00.000Z`);
    await processGroupMessages(db, corpus.today);
    const changes = diff(before, snapshot(db));
    const logs = db.prepare(`
      SELECT classification, action_taken, escalated, escalation_reason FROM group_update_log ORDER BY id
    `).all() as Array<{ classification: string; action_taken: string; escalated: number; escalation_reason: string }>;

    const escalated = logs.some(l => l.escalated === 1);
    let verdict: ProbeResult['verdict'];
    if (logs.length === 0) verdict = 'NO_LOG';
    else if (message.mustNotMutate && changes.length > 0) verdict = 'UNSAFE_MUTATION';
    else if (changes.length === 0 && escalated) verdict = 'SAFE_REVIEW';
    else if (changes.length === 0) verdict = 'NOT_ACTED';
    else verdict = 'NEEDS_CHECK';

    return {
      id: message.id,
      type: message.type,
      classification: logs.map(l => l.classification).join('+'),
      escalated,
      reason: logs.map(l => l.escalation_reason).filter(Boolean).join('; '),
      actionTaken: logs.map(l => l.action_taken).filter(Boolean).join('; '),
      changes,
      verdict
    };
  } finally {
    db.close();
  }
}

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ⏎ ');

export function renderProbeReport(corpus: Corpus, results: ProbeResult[]): string {
  const L: string[] = [];
  const counts = results.reduce((m, r) => m.set(r.verdict, (m.get(r.verdict) ?? 0) + 1), new Map<string, number>());
  L.push('# Message corpus probe', '');
  L.push(`Each message ran alone through \`processGroupMessages\` on a fresh in-memory DB (today = ${corpus.today}, Ollama off). ` +
    'Verdicts: SAFE_REVIEW = sent to Review with no change; UNSAFE_MUTATION = changed data although the message needs a human; ' +
    'NEEDS_CHECK = changed data — compare the changes with the expected action; NOT_ACTED = logged but nothing changed and nothing escalated.', '');
  L.push(`Totals: ${[...counts.entries()].map(([k, n]) => `${k} ${n}`).join(' · ')}`, '');
  L.push('| id | type | pipeline classification | escalated | what happened | expected |', '|---|---|---|---|---|---|');
  results.forEach((r, i) => {
    const m = corpus.messages[i];
    const happened = r.changes.length
      ? `${r.verdict}: ${r.changes.join('<br>')}`
      : `${r.verdict}${r.reason ? `: ${r.reason}` : ''}`;
    L.push(`| ${r.id} | ${r.type} | ${r.classification || '—'} | ${r.escalated ? 'yes' : 'no'} | ${cell(happened)} | ${cell(m.expected.action)} |`);
  });
  L.push('');
  return L.join('\n');
}

async function main(): Promise<void> {
  const corpusPath = process.argv[2] ?? path.resolve('tests/fixtures/group-message-corpus.json');
  const outPath = process.argv[3];
  const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8')) as Corpus;
  const results: ProbeResult[] = [];
  for (const message of corpus.messages) results.push(await probeMessage(corpus, message));
  const report = renderProbeReport(corpus, results);
  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, report);
    console.log(`Probe report: ${outPath}`);
  } else {
    console.log(report);
  }
}

if (require.main === module) {
  main().catch(error => { console.error(error); process.exit(1); });
}
