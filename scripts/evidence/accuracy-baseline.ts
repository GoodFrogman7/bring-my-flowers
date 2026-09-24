/**
 * Phase 1 accuracy baseline: attribute every difference between Amit's
 * sheets and the bot's sheets to one cause, and write the ranked report.
 *
 *   1. copy data\business.db somewhere else (never analyse the live file)
 *   2. npx ts-node scripts/compare-del-sheets.ts <db-copy> <compare-out> [amit-dir ...]
 *   3. npx ts-node scripts/evidence/accuracy-baseline.ts <db-copy> <compare-out>/details.json reports/accuracy-baseline.md [--process-time 21:30]
 *
 * For each date the bot's generated file (data/del-sheet-<date>.xlsx) is
 * scored when it exists — that is what actually went out. Otherwise the
 * sheet regenerated from today's DB is used, and the report says so.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  ATTRIBUTIONS,
  Attribution,
  AttributedDiff,
  attribute,
  CustomerRef,
  EvidenceMessage,
  isMoneyError,
  istTimestamp,
  maskPhones,
  relatedMessages,
  SheetDiff,
  sheetCutoff
} from './attribution';
import { addDays } from '../../src/business/dates';
import { loadCustomers, loadEvidenceMessages, openEvidenceCopy } from './evidenceDb';

/** The subset of compare-del-sheets.ts details.json this report reads. */
interface CompareCause { code: string; detail: string }
interface CompareComparison {
  amitRows: number; botRows: number; common: number;
  amitOnly: Array<{ id: string; name: string; cause: CompareCause }>;
  botOnly: Array<{ id: string; name: string; cause: CompareCause }>;
  mismatches: Array<{ id: string; name: string; field: string; amit: string; bot: string }>;
}
export interface CompareDetails {
  results: Array<{ date: string; amitSource: string; regen: CompareComparison; file: CompareComparison | null }>;
}

export interface DayScore {
  date: string;
  basis: 'bot file' | 'regenerated';
  amitRows: number;
  botRows: number;
  identical: number;
  union: number;
  diffs: AttributedDiff[];
  moneyErrors: number;
}

export interface Baseline {
  days: DayScore[];
  unscoredDates: string[];
  processTime: string;
}

/** Field differences that are not evidence of a wrong sheet. */
function materialMismatch(m: { field: string; amit: string; bot: string }): boolean {
  if (m.field === 'collect') return Number(m.amit) !== 0; // Amit fills Payment after the run
  return true;
}

export function buildBaseline(
  details: CompareDetails,
  messages: EvidenceMessage[],
  customers: Map<string, CustomerRef>,
  processTime = '21:30'
): Baseline {
  const customerFor = (id: string, name: string): CustomerRef =>
    customers.get(id.toUpperCase()) ?? { id, name, phones: [] };

  const days: DayScore[] = details.results.map(result => {
    const cmp = result.file ?? result.regen;
    const cutoff = sheetCutoff(result.date, processTime);
    const raw: SheetDiff[] = [
      ...cmp.amitOnly.map(r => ({ date: result.date, kind: 'amitOnly' as const, customer: customerFor(r.id, r.name), scheduleCause: r.cause.code })),
      ...cmp.botOnly.map(r => ({ date: result.date, kind: 'botOnly' as const, customer: customerFor(r.id, r.name), scheduleCause: r.cause.code })),
      ...cmp.mismatches.filter(materialMismatch).map(m => ({
        date: result.date, kind: 'field' as const, customer: customerFor(m.id, m.name),
        scheduleCause: `field:${m.field}`, field: m.field, amitValue: m.amit, botValue: m.bot
      }))
    ];
    const diffs = raw.map(d => attribute(d, relatedMessages(messages, d.customer, d.date), cutoff));
    const mismatchedIds = new Set(cmp.mismatches.filter(materialMismatch).map(m => m.id));
    const identical = cmp.common - mismatchedIds.size;
    return {
      date: result.date,
      basis: result.file ? 'bot file' : 'regenerated',
      amitRows: cmp.amitRows,
      botRows: cmp.botRows,
      identical,
      union: cmp.amitRows + cmp.botOnly.length,
      diffs,
      moneyErrors: raw.filter(isMoneyError).length
    };
  });

  const scored = new Set(days.map(d => d.date));
  const unscoredDates: string[] = [];
  if (days.length) {
    const sorted = [...scored].sort();
    for (let d = sorted[0]; d <= sorted[sorted.length - 1]; d = addDays(d, 1)) if (!scored.has(d)) unscoredDates.push(d);
  }
  return { days, unscoredDates, processTime };
}

const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : '—');
const cell = (s: string) => maskPhones(s).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ⏎ ');

export function renderBaseline(baseline: Baseline, messages: EvidenceMessage[]): string {
  const { days } = baseline;
  const byId = new Map(messages.map(m => [m.id, m]));
  const all = days.flatMap(d => d.diffs);
  const identical = days.reduce((s, d) => s + d.identical, 0);
  const union = days.reduce((s, d) => s + d.union, 0);
  const money = days.reduce((s, d) => s + d.moneyErrors, 0);
  const causeCount = new Map<Attribution, number>(ATTRIBUTIONS.map(c => [c, 0]));
  for (const d of all) causeCount.set(d.cause, (causeCount.get(d.cause) ?? 0) + 1);

  const L: string[] = [];
  L.push('# Accuracy baseline — bot sheet vs Amit\'s sheet', '');
  L.push(`Generated ${new Date().toISOString()}. Sheet cutoff assumed at ${baseline.processTime} IST the evening before each date (UPDATES_PROCESS_TIME).`, '');
  L.push('## Headline', '');
  L.push(`- **Row-level match: ${pct(identical, union)}** (${identical} rows identical on both sheets, out of ${union} rows on either sheet) across ${days.length} days scored against Amit's sheet.`);
  L.push(`- **Money errors: ${money}** (collect amount differs where Amit's sheet has a non-zero amount).`);
  L.push(`- Differences attributed: ${all.length}.`, '');
  L.push('Row match counts a row as matching only when both sheets list the customer and every material field agrees. A blank/0 Payment on Amit\'s sheet is ignored because it is filled in after the run.', '');

  L.push('## Differences by cause', '');
  L.push('| cause | differences | share | meaning |', '|---|---|---|---|');
  const meaning: Record<Attribution, string> = {
    LATE: 'the related message arrived after the sheet was built',
    MISPARSED: 'a message was acted on, but wrongly',
    UNPARSED: 'a message arrived in time but was not understood',
    STUCK_IN_REVIEW: 'escalated to Review and not resolved before the sheet',
    NO_MESSAGE: 'no related message — renewal/cycle/rotation/biweekly logic is wrong',
    DATA: 'no related message — the customer/subscription/order record is wrong'
  };
  for (const c of [...ATTRIBUTIONS].sort((a, b) => (causeCount.get(b) ?? 0) - (causeCount.get(a) ?? 0))) {
    L.push(`| ${c} | ${causeCount.get(c) ?? 0} | ${pct(causeCount.get(c) ?? 0, all.length)} | ${meaning[c]} |`);
  }
  L.push('');

  const patterns = new Map<string, AttributedDiff[]>();
  for (const d of all) {
    const key = `${d.cause} · ${d.kind === 'field' ? `${d.field} differs` : d.kind === 'amitOnly' ? 'bot missed a delivery' : 'bot listed a delivery Amit did not make'} · ${d.scheduleCause}`;
    patterns.set(key, [...(patterns.get(key) ?? []), d]);
  }
  L.push('## Top 10 recurring mistake patterns', '');
  [...patterns.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 10).forEach(([key, list], i) => {
    L.push(`${i + 1}. **${key}** — ${list.length} differences on ${new Set(list.map(d => d.date)).size} days`);
    for (const d of list.slice(0, 3)) {
      const msgs = d.messageIds.slice(0, 2).map(id => byId.get(id)).filter(Boolean) as EvidenceMessage[];
      const evidence = msgs.map(m => `msg #${m.id} ${istTimestamp(m.receivedAt)}: "${cell(m.text).slice(0, 120)}"`).join('; ');
      const values = d.kind === 'field' ? ` Amit "${d.amitValue}" vs bot "${d.botValue}".` : '';
      L.push(`   - ${d.date} #${d.customer.id} ${d.customer.name}: ${cell(d.detail)}.${values}${evidence ? ` ${evidence}` : ''}`);
    }
  });
  L.push('');

  L.push('## Per day (scored against Amit\'s sheet)', '');
  L.push('| date | scored | Amit rows | bot rows | identical | row match | money errors | ' + ATTRIBUTIONS.join(' | ') + ' |');
  L.push('|---|---|---|---|---|---|---|' + ATTRIBUTIONS.map(() => '---').join('|') + '|');
  for (const d of days) {
    const counts = ATTRIBUTIONS.map(c => d.diffs.filter(x => x.cause === c).length);
    L.push(`| ${d.date} | ${d.basis} | ${d.amitRows} | ${d.botRows} | ${d.identical} | ${pct(d.identical, d.union)} | ${d.moneyErrors} | ${counts.join(' | ')} |`);
  }
  L.push('');
  L.push('"bot file" rows score the sheet that actually went out; "regenerated" rows score what today\'s database would produce for that date, which is weaker evidence.', '');

  L.push('## Reconstructed days', '');
  L.push(baseline.unscoredDates.length
    ? `Not scored yet — no Amit sheet: ${baseline.unscoredDates.join(', ')}. Reconstruction from next-day group evidence is not implemented; these days are excluded from every number above rather than guessed.`
    : 'None in range — every day between the first and last Amit sheet was scored.');
  L.push('');
  return L.join('\n');
}

function main(): void {
  const args = process.argv.slice(2);
  const ptIndex = args.indexOf('--process-time');
  const processTime = ptIndex >= 0 ? args.splice(ptIndex, 2)[1] : '21:30';
  const [dbPath, detailsPath, outPath] = args;
  if (!dbPath || !detailsPath || !outPath) {
    console.error('Usage: npx ts-node scripts/evidence/accuracy-baseline.ts <db-copy> <details.json> <out.md> [--process-time 21:30]');
    process.exit(1);
  }
  const db = openEvidenceCopy(dbPath);
  const messages = loadEvidenceMessages(db);
  const customers = loadCustomers(db);
  db.close();
  const details = JSON.parse(fs.readFileSync(detailsPath, 'utf8')) as CompareDetails;
  const baseline = buildBaseline(details, messages, customers, processTime);
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(outPath, renderBaseline(baseline, messages));
  console.log(`Scored ${baseline.days.length} days; report: ${outPath}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
