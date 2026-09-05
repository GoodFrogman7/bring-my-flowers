/**
 * Compare Amit's emailed "<date> Del Sheet" workbooks against what the bot
 * produced (files in data/) and what it would produce today from the DB
 * (dueRows). Read-only analysis — point it at a COPY of business.db.
 *
 *   npx ts-node scripts/compare-del-sheets.ts <db-copy-path> <out-dir> [amit-dir ...]
 *
 * Amit dirs default to %USERPROFILE%\Downloads and data/amit-sheets.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as XLSX from 'xlsx';
import { openDb, BusinessDb } from '../src/business/db';
import { dueRows } from '../src/business/delSheet';
import { addDays, weekdayOf } from '../src/business/dates';

const [dbPath, outDir, ...amitDirsArg] = process.argv.slice(2);
if (!dbPath || !outDir) {
  console.error('Usage: npx ts-node scripts/compare-del-sheets.ts <db-copy-path> <out-dir> [amit-dir ...]');
  process.exit(1);
}
const amitDirs = amitDirsArg.length
  ? amitDirsArg
  : [path.join(os.homedir(), 'Downloads'), path.resolve('data/amit-sheets')];

interface Row {
  id: string; name: string; zone: string; day: string; timeSlot: string;
  pack: number; revenue: number; pkg: string; statusString: string; collect: number;
  remarks: string;
}
interface Sheet { date: string; source: string; rows: Row[]; dailyRevenue: number | null }

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
};
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function dateFromAmitName(file: string): string | null {
  const iso = file.match(/^(\d{4}-\d{2}-\d{2})\.xlsx$/i);
  if (iso) return iso[1];
  const m = file.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s*-?\s*(\d{2,4})/i);
  if (!m) return null;
  const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
  if (!month) return null;
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return `${year}-${String(month).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`;
}

const norm = (v: unknown) => String(v ?? '').trim().replace(/\s+/g, ' ');
const lower = (v: unknown) => norm(v).toLowerCase();
const num = (v: unknown) => { const n = Number(String(v ?? '').replace(/[₹,]/g, '')); return Number.isFinite(n) ? n : 0; };
const normId = (v: unknown) => {
  const s = norm(v);
  if (/^\d+(\.0+)?$/.test(s)) return String(Number(s));
  return s.toUpperCase();
};
const normSlot = (v: unknown) => lower(v).replace(/\s+/g, '').replace(/to|-/g, '-').replace(/\./g, '');

function findCol(headers: string[], name: string): number {
  const t = name.toLowerCase();
  return headers.findIndex(h => h.trim().toLowerCase() === t);
}

function readSheet(file: string, date: string): Sheet {
  const wb = XLSX.readFile(file);
  const tabName = wb.SheetNames.find(n => {
    const first = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n], { header: 1, range: 0 })[0] as unknown[] | undefined;
    return first?.some(c => lower(c) === 'id');
  }) ?? wb.SheetNames[0];
  const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[tabName], { header: 1, defval: '' });
  const headers = ((grid[0] ?? []) as unknown[]).map(h => String(h ?? ""));
  const col = {
    id: findCol(headers, 'ID'), name: findCol(headers, 'Name'), zone: findCol(headers, 'Zone'),
    day: findCol(headers, 'Day'), slot: findCol(headers, 'Time Slot'), pack: findCol(headers, 'Pack'),
    revenue: findCol(headers, 'Revenue'), type: findCol(headers, 'Type'), remarks: findCol(headers, 'Remarks'),
    status: findCol(headers, 'Final Number of Delivery'), payment: headers.map(h => h.trim().toLowerCase()).lastIndexOf('payment')
  };
  const rows: Row[] = [];
  for (const raw of grid.slice(1)) {
    const cells = raw as unknown[];
    const id = normId(cells[col.id]);
    if (!id) continue;
    rows.push({
      id,
      name: norm(cells[col.name]),
      zone: norm(cells[col.zone]),
      day: norm(cells[col.day]),
      timeSlot: norm(cells[col.slot]),
      pack: num(cells[col.pack]),
      revenue: num(cells[col.revenue]),
      pkg: norm(cells[col.type]),
      statusString: norm(cells[col.status]),
      collect: col.payment >= 0 ? num(cells[col.payment]) : 0,
      remarks: col.remarks >= 0 ? norm(cells[col.remarks]) : ''
    });
  }
  let dailyRevenue: number | null = null;
  for (const n of wb.SheetNames) {
    if (n === tabName) continue;
    const g = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n], { header: 1, defval: '' });
    if (!g.length) continue;
    const hdr = (g[0] as unknown[]).map(h => lower(h));
    const c = hdr.indexOf('revenue for the day');
    if (c < 0) continue;
    for (const r of g.slice(1)) {
      const v = num((r as unknown[])[c]);
      if (v > 0) { dailyRevenue = v; break; }
    }
    if (dailyRevenue === null) {
      // Fallback: the "total revenue" column's largest value
      const c2 = hdr.indexOf('total revenue');
      if (c2 >= 0) dailyRevenue = Math.max(0, ...g.slice(1).map(r => num((r as unknown[])[c2]))) || null;
    }
  }
  return { date, source: path.basename(file), rows, dailyRevenue };
}

function loadAmitSheets(): Map<string, Sheet> {
  const out = new Map<string, Sheet>();
  for (const dir of amitDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!/\.xlsx$/i.test(f)) continue;
      const isIso = /^\d{4}-\d{2}-\d{2}\.xlsx$/i.test(f);
      if (!isIso && (!/del\s*sheet/i.test(f) || /^del-sheet-/i.test(f))) continue;
      const date = dateFromAmitName(f);
      if (!date) { console.warn(`skip (no date): ${f}`); continue; }
      if (out.has(date)) continue;
      out.set(date, readSheet(path.join(dir, f), date));
    }
  }
  return out;
}

function botFileSheet(date: string): Sheet | null {
  const p = path.resolve(`data/del-sheet-${date}.xlsx`);
  return fs.existsSync(p) ? readSheet(p, date) : null;
}

function regenSheet(db: BusinessDb, date: string): Sheet {
  const rows: Row[] = dueRows(db, date).map(r => ({
    id: normId(r.id), name: r.name, zone: r.zone, day: r.day, timeSlot: r.timeSlot,
    pack: r.pack, revenue: r.revenue, pkg: r.packageName, statusString: r.statusString,
    collect: r.collect === '' ? 0 : r.collect, remarks: r.remarks
  }));
  return { date, source: 'dueRows()', rows, dailyRevenue: null };
}

// ---------- causes ----------
interface Cause { code: string; detail: string }

function makeClassifier(db: BusinessDb) {
  const cust = db.prepare(`SELECT id, name, remarks FROM customers WHERE id = ?`);
  const custCi = db.prepare(`SELECT id, name, remarks FROM customers WHERE upper(id) = ?`);
  const sub = db.prepare(`SELECT id, status, frequency, day, day2 FROM subscriptions WHERE customer_id = ? ORDER BY id DESC LIMIT 1`);
  const near = db.prepare(`
    SELECT COALESCE(NULLIF(d.changed_date,''), d.planned_date) AS dt, d.status, cy.remarks AS cyRemarks
    FROM deliveries d JOIN cycles cy ON d.cycle_id = cy.id JOIN subscriptions s ON cy.subscription_id = s.id
    WHERE s.customer_id = ? AND dt BETWEEN ? AND ? ORDER BY dt`);
  const oneTime = db.prepare(`SELECT id, date FROM one_time_orders WHERE upper(id) = ? ORDER BY date`);
  const logOn = db.prepare(`SELECT 1 FROM delivery_log WHERE upper(customer_id) = ? AND date = ?`);

  function resolveCustomer(id: string) {
    return (cust.get(id) ?? custCi.get(id)) as { id: string; name: string; remarks: string } | undefined;
  }

  return {
    amitOnly(id: string, amitRow: Row, date: string): Cause {
      const c = resolveCustomer(id);
      const ot = oneTime.all(id) as Array<{ id: string; date: string }>;
      if (!c) {
        if (ot.length) return { code: 'F_ONE_TIME_OTHER_DATE', detail: `one_time_orders has ${id} on ${ot.map(o => o.date).join(',')}` };
        const bouquetLike = amitRow.pack > 0 && Math.abs(amitRow.pack - amitRow.revenue) < 0.01 || /bouq|^B-/i.test(amitRow.pkg + ' ' + id);
        return { code: bouquetLike ? 'F_BOUQUET_NOT_IN_DB' : 'A_NOT_IN_DB', detail: bouquetLike ? `bouquet ₹${amitRow.pack} (${amitRow.pkg})` : `unknown customer "${amitRow.name}"` };
      }
      const s = sub.get(c.id) as { id: number; status: string; frequency: string; day: string; day2: string } | undefined;
      if (!s) return { code: 'B_NO_SUBSCRIPTION', detail: 'customer has no subscription row' };
      const win = near.all(c.id, addDays(date, -7), addDays(date, 7)) as Array<{ dt: string; status: string; cyRemarks: string }>;
      const onDate = win.filter(w => w.dt === date);
      if (s.status !== 'ACTIVE') {
        return { code: `B_SUB_${s.status}`, detail: `subscription ${s.status}${onDate.length ? ` (delivery row exists on date: ${onDate[0].status})` : ''}` };
      }
      if (onDate.length) {
        return { code: `E_ON_DATE_${onDate[0].status}`, detail: `delivery row on date has status ${onDate[0].status}` };
      }
      const within3 = win.filter(w => Math.abs(dayDiff(w.dt, date)) <= 3);
      if (within3.length) {
        const bw = s.frequency === 'BIWEEKLY';
        return {
          code: bw ? 'D_DAY_SHIFT_BIWEEKLY' : 'D_DAY_SHIFT',
          detail: `nearest bot delivery ${within3.map(w => `${w.dt}(${w.status})`).join(',')}; sub day=${s.day} day2=${s.day2 || '-'} amitDay=${amitRow.day}`
        };
      }
      if (win.length) return { code: 'D7_NEAR_WEEK', detail: `bot deliveries within ±7d: ${win.map(w => w.dt).join(',')}` };
      return { code: 'C_NO_CYCLE_COVERAGE', detail: `ACTIVE ${s.frequency} on ${s.day}, no delivery within ±7d` };
    },
    botOnly(id: string, botRow: Row, date: string, amitByDate: Map<string, Sheet>): Cause {
      const c = resolveCustomer(id);
      const logged = !!logOn.get(id, date);
      const nearbyAmit: string[] = [];
      for (let k = -3; k <= 3; k++) {
        if (k === 0) continue;
        const d = addDays(date, k);
        const sh = amitByDate.get(d);
        if (sh?.rows.some(r => r.id === id)) nearbyAmit.push(d);
      }
      const s = c ? (sub.get(c.id) as { status: string; frequency: string } | undefined) : undefined;
      const remarks = (c?.remarks ?? '') + ' ' + botRow.remarks;
      const stamp = `(${date.slice(8, 10)}/${date.slice(5, 7)})`;
      const holdRecent = /hold|skip|return|no flower|dont send|don't send/i.test(remarks) && remarks.includes(stamp);
      if (logged) return { code: 'LOG_CONFIRMS_DELIVERY', detail: 'delivery_log has this customer on the date (Amit sheet parse/omission?)' };
      if (nearbyAmit.length) return { code: 'AMIT_NEARBY_DATE', detail: `Amit lists it on ${nearbyAmit.join(',')}` };
      if (holdRecent) return { code: 'HOLD_SKIP_IN_REMARKS', detail: `remark stamped ${stamp} mentions hold/skip` };
      if (!c) return { code: 'BOT_ONE_TIME', detail: `one-time order ${id}` };
      return { code: `BOT_EXTRA_${s?.status ?? 'NOSUB'}_${s?.frequency ?? ''}`, detail: `sub ${s?.status ?? '-'} ${s?.frequency ?? ''}; no Amit row ±3d; not in delivery_log` };
    }
  };
}

function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);
}

// ---------- comparison ----------
interface FieldMismatch { id: string; name: string; field: string; amit: string; bot: string }
interface Comparison {
  amitRows: number; botRows: number; common: number;
  amitOnly: Array<{ id: string; name: string; pack: number; pkg: number | string; cause: Cause }>;
  botOnly: Array<{ id: string; name: string; cause: Cause }>;
  mismatches: FieldMismatch[];
  revenueAmit: number; revenueBot: number;
}

function compare(amit: Sheet, bot: Sheet, date: string, cls: ReturnType<typeof makeClassifier>, amitByDate: Map<string, Sheet>): Comparison {
  const a = new Map(amit.rows.map(r => [r.id, r]));
  const b = new Map(bot.rows.map(r => [r.id, r]));
  const out: Comparison = {
    amitRows: amit.rows.length, botRows: bot.rows.length, common: 0, amitOnly: [], botOnly: [], mismatches: [],
    revenueAmit: amit.rows.reduce((s, r) => s + r.revenue, 0), revenueBot: bot.rows.reduce((s, r) => s + r.revenue, 0)
  };
  for (const [id, ar] of a) {
    const br = b.get(id);
    if (!br) { out.amitOnly.push({ id, name: ar.name, pack: ar.pack, pkg: ar.pkg, cause: cls.amitOnly(id, ar, date) }); continue; }
    out.common++;
    const checks: Array<[string, string, string, boolean]> = [
      ['pack', String(ar.pack), String(br.pack), Math.abs(ar.pack - br.pack) > 0.01],
      ['revenue', String(ar.revenue), String(br.revenue), Math.abs(ar.revenue - br.revenue) > 0.01],
      ['zone', ar.zone, br.zone, lower(ar.zone) !== lower(br.zone)],
      ['day', ar.day, br.day, lower(ar.day) !== lower(br.day)],
      ['timeSlot', ar.timeSlot, br.timeSlot, normSlot(ar.timeSlot) !== normSlot(br.timeSlot)],
      ['package', ar.pkg, br.pkg, lower(ar.pkg) !== lower(br.pkg)],
      ['collect', String(ar.collect), String(br.collect), Math.abs(ar.collect - br.collect) > 0.01]
    ];
    for (const [field, av, bv, bad] of checks) if (bad) out.mismatches.push({ id, name: ar.name, field, amit: av, bot: bv });
  }
  for (const [id, br] of b) if (!a.has(id)) out.botOnly.push({ id, name: br.name, cause: cls.botOnly(id, br, date, amitByDate) });
  return out;
}

// ---------- main ----------
const db = openDb(dbPath);
const cls = makeClassifier(db);
const amitByDate = loadAmitSheets();
const dates = [...amitByDate.keys()].sort();
if (!dates.length) { console.error('No Amit sheets found in', amitDirs.join(', ')); process.exit(1); }

const autoCycleOnDate = db.prepare(`
  SELECT COUNT(*) AS n FROM deliveries d JOIN cycles cy ON d.cycle_id = cy.id JOIN subscriptions s ON cy.subscription_id = s.id
  WHERE s.status='ACTIVE' AND d.status IN ('PLANNED','DELIVERED') AND COALESCE(NULLIF(d.changed_date,''),d.planned_date) = ?
    AND cy.remarks = 'Auto-created on renewal'`);

interface DateResult {
  date: string; weekday: string; amitSource: string; amitDailyRevenue: number | null;
  regen: Comparison; regenAutoCycleRows: number; file: Comparison | null;
}
const results: DateResult[] = [];
for (const date of dates) {
  const amit = amitByDate.get(date)!;
  const regen = compare(amit, regenSheet(db, date), date, cls, amitByDate);
  const f = botFileSheet(date);
  results.push({
    date, weekday: WEEKDAYS[weekdayOf(date)], amitSource: amit.source, amitDailyRevenue: amit.dailyRevenue,
    regen, regenAutoCycleRows: (autoCycleOnDate.get(date) as { n: number }).n,
    file: f ? compare(amit, f, date, cls, amitByDate) : null
  });
}

// ---------- aggregate ----------
const INDEPENDENT_FROM = '2026-08-11';
function agg(rs: DateResult[]) {
  const t = rs.reduce((s, r) => ({ a: s.a + r.regen.amitRows, b: s.b + r.regen.botRows, c: s.c + r.regen.common }), { a: 0, b: 0, c: 0 });
  return { dates: rs.length, amitRows: t.a, botRows: t.b, common: t.c, recall: t.a ? t.c / t.a : 0, precision: t.b ? t.c / t.b : 0 };
}
const julyAgg = agg(results.filter(r => r.date < INDEPENDENT_FROM));
const indepAgg = agg(results.filter(r => r.date >= INDEPENDENT_FROM));

const causeCount = new Map<string, number>();
const missByCust = new Map<string, { name: string; dates: string[]; causes: Map<string, number>; pack: number; pkg: string }>();
for (const r of results) for (const m of r.regen.amitOnly) {
  causeCount.set(m.cause.code, (causeCount.get(m.cause.code) ?? 0) + 1);
  const e = missByCust.get(m.id) ?? { name: m.name, dates: [] as string[], causes: new Map<string, number>(), pack: m.pack, pkg: String(m.pkg) };
  e.dates.push(r.date); e.causes.set(m.cause.code, (e.causes.get(m.cause.code) ?? 0) + 1);
  missByCust.set(m.id, e);
}
const botCauseCount = new Map<string, number>();
const extraByCust = new Map<string, { name: string; dates: string[]; causes: Map<string, number> }>();
for (const r of results) for (const m of r.regen.botOnly) {
  botCauseCount.set(m.cause.code, (botCauseCount.get(m.cause.code) ?? 0) + 1);
  const e = extraByCust.get(m.id) ?? { name: m.name, dates: [] as string[], causes: new Map<string, number>() };
  e.dates.push(r.date); e.causes.set(m.cause.code, (e.causes.get(m.cause.code) ?? 0) + 1);
  extraByCust.set(m.id, e);
}
const fieldCount = new Map<string, { n: number; examples: FieldMismatch[] }>();
for (const r of results) for (const m of r.regen.mismatches) {
  const e = fieldCount.get(m.field) ?? { n: 0, examples: [] };
  e.n++; if (e.examples.length < 3) e.examples.push({ ...m, id: `${m.id}@${r.date}` });
  fieldCount.set(m.field, e);
}
const dominant = (m: Map<string, number>) => [...m.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? '';
const topMissed = [...missByCust.entries()].sort((x, y) => y[1].dates.length - x[1].dates.length).slice(0, 25);
const topExtra = [...extraByCust.entries()].sort((x, y) => y[1].dates.length - x[1].dates.length).slice(0, 15);
const dayShift = results.flatMap(r => r.regen.amitOnly.filter(m => m.cause.code.startsWith('D_DAY_SHIFT')).map(m => ({ date: r.date, ...m })));
const dayShiftBiweekly = dayShift.filter(m => m.cause.code === 'D_DAY_SHIFT_BIWEEKLY');
const wednesdays = results.filter(r => r.weekday === 'Wednesday');

// ---------- report ----------
const fmt = (n: number) => Math.round(n).toLocaleString('en-IN');
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const L: string[] = [];
L.push('# Amit delivery sheets vs bot — comparison report', '');
L.push(`Generated ${new Date().toISOString()}. DB copy: \`${dbPath}\`. Amit sheets: ${dates.length} dates (${dates[0]} → ${dates[dates.length - 1]}) from ${amitDirs.filter(d => fs.existsSync(d)).join(', ')}.`, '');
L.push('## Provenance caveat', '');
L.push('`deliveries` rows are created two ways: (1) `importMaster.ts` copies the 8 explicit delivery-date cells of every cycle row from the owner\'s Master workbook and marks dates before `asOf` as DELIVERED; (2) `renewal.ts createNextCycle` (manual "renew" + nightly auto-renew) generates PLANNED dates by rule (fixed day, +3d for biweekly). Amit\'s sheets are operational output of the same Master, so the **regen comparison for July is partly circular** — it measures how faithfully the Master\'s dates were carried into the DB, not independent scheduling. Rows on/after 2026-08-11 are PLANNED and increasingly come from `createNextCycle` (auto-created-cycle share is shown per date); that is the cleaner test of the bot\'s own scheduling. Weight conclusions accordingly.', '');
L.push('## 1. Per-date table (regen = dueRows() on the DB copy; file = data/del-sheet-<date>.xlsx where it exists)', '');
L.push('| date | wd | Amit rows | bot file rows | regen rows | auto-cycle rows | Amit-only | bot-only | field mismatches | ₹ Amit / ₹ regen | ₹ Amit Sheet2 |');
L.push('|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of results) {
  L.push(`| ${r.date} | ${r.weekday.slice(0, 3)} | ${r.regen.amitRows} | ${r.file ? r.file.botRows : '—'} | ${r.regen.botRows} | ${r.regenAutoCycleRows} | ${r.regen.amitOnly.length} | ${r.regen.botOnly.length} | ${r.regen.mismatches.length} | ${fmt(r.regen.revenueAmit)} / ${fmt(r.regen.revenueBot)} | ${r.amitDailyRevenue === null ? '—' : fmt(r.amitDailyRevenue)} |`);
}
L.push('');
const files = results.filter(r => r.file);
if (files.length) {
  L.push('### Bot files actually generated at the time vs Amit', '');
  L.push('| date | Amit rows | bot file rows | common | Amit-only | bot-only | mismatches |', '|---|---|---|---|---|---|---|');
  for (const r of files) L.push(`| ${r.date} | ${r.file!.amitRows} | ${r.file!.botRows} | ${r.file!.common} | ${r.file!.amitOnly.length} | ${r.file!.botOnly.length} | ${r.file!.mismatches.length} |`);
  L.push('');
}
L.push('## 2. Recall / precision (regen)', '');
L.push('| window | dates | Amit rows | bot rows | common | recall (Amit rows the bot had) | precision (bot rows Amit had) |', '|---|---|---|---|---|---|---|');
L.push(`| July–Aug 10 (Master-derived, partly circular) | ${julyAgg.dates} | ${julyAgg.amitRows} | ${julyAgg.botRows} | ${julyAgg.common} | ${pct(julyAgg.recall)} | ${pct(julyAgg.precision)} |`);
L.push(`| Aug 11+ (independent) | ${indepAgg.dates} | ${indepAgg.amitRows} | ${indepAgg.botRows} | ${indepAgg.common} | ${pct(indepAgg.recall)} | ${pct(indepAgg.precision)} |`);
L.push('');
L.push('## Cause codes — rows Amit delivered that the bot did not schedule (regen, all dates)', '');
L.push('| cause | rows |', '|---|---|');
for (const [c, n] of [...causeCount.entries()].sort((x, y) => y[1] - x[1])) L.push(`| ${c} | ${n} |`);
L.push('', 'Codes: A_NOT_IN_DB = ID unknown; F_BOUQUET_NOT_IN_DB = one-off bouquet never entered in one_time_orders; F_ONE_TIME_OTHER_DATE = one-off exists on a different date; B_SUB_<status> = subscription not ACTIVE; C_NO_CYCLE_COVERAGE = ACTIVE but no cycle covers the week (renewal gap); D_DAY_SHIFT[_BIWEEKLY] = bot has it within ±3 days but on the wrong weekday; D7_NEAR_WEEK = within ±7d only; E_ON_DATE_<status> = bot row exists on the date but is HELD/SKIPPED/RETURNED.', '');
L.push('## Cause codes — rows the bot scheduled that Amit did not deliver (regen)', '');
L.push('| cause | rows |', '|---|---|');
for (const [c, n] of [...botCauseCount.entries()].sort((x, y) => y[1] - x[1])) L.push(`| ${c} | ${n} |`);
L.push('');
L.push('## 3. Top 25 customers Amit delivered to that the bot keeps missing', '');
L.push('| ID | name | pack | type | dates missed | dominant cause |', '|---|---|---|---|---|---|');
for (const [id, e] of topMissed) L.push(`| ${id} | ${e.name} | ${e.pack} | ${e.pkg} | ${e.dates.length} (${e.dates[0]}…${e.dates[e.dates.length - 1]}) | ${dominant(e.causes)} |`);
L.push('');
L.push('## 4. Top 15 customers the bot schedules that Amit does not deliver', '');
L.push('| ID | name | dates | dominant cause |', '|---|---|---|---|');
for (const [id, e] of topExtra) L.push(`| ${id} | ${e.name} | ${e.dates.length} (${e.dates[0]}…${e.dates[e.dates.length - 1]}) | ${dominant(e.causes)} |`);
L.push('');
L.push('## 5. Field mismatches on rows both sides have (regen)', '');
L.push('| field | count | examples (id@date: Amit → bot) |', '|---|---|---|');
for (const [f, e] of [...fieldCount.entries()].sort((x, y) => y[1].n - x[1].n)) {
  L.push(`| ${f} | ${e.n} | ${e.examples.map(x => `${x.id} ${x.name.slice(0, 18)}: "${x.amit}" → "${x.bot}"`).join('; ')} |`);
}
L.push('');
L.push('## 6. Wednesdays and biweekly second-day check', '');
L.push('Wednesdays (Amit rows / regen rows): ' + (wednesdays.map(r => `${r.date} ${r.regen.amitRows}/${r.regen.botRows}`).join(', ') || 'none in range'), '');
L.push(`Day-shift misses (bot has the customer within ±3 days but not on Amit's date): ${dayShift.length}, of which BIWEEKLY subscriptions: ${dayShiftBiweekly.length}.`);
if (dayShiftBiweekly.length) {
  L.push('', 'Biweekly examples:');
  for (const m of dayShiftBiweekly.slice(0, 10)) L.push(`- ${m.date} #${m.id} ${m.name}: ${m.cause.detail}`);
}
const bwSecondDay = db.prepare(`SELECT COUNT(*) AS n FROM subscriptions WHERE frequency='BIWEEKLY' AND status='ACTIVE'`).get() as { n: number };
const bwDay2Set = db.prepare(`SELECT COUNT(*) AS n FROM subscriptions WHERE frequency='BIWEEKLY' AND status='ACTIVE' AND day2 <> ''`).get() as { n: number };
L.push('', `Active BIWEEKLY subscriptions: ${bwSecondDay.n}; with day2 populated: ${bwDay2Set.n} (renewal.ts ignores day2 and uses fixed day + 3).`, '');

// ---------- deeper checks ----------
const dayOff = (a: string, b: string) => dayDiff(a, b);
const hist = (m: Map<number, number>) => [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([k, n]) => `${k > 0 ? '+' : ''}${k}d: ${n}`).join(', ');
// One-time orders: DB date vs Amit's actual delivery date
const otOffsets = new Map<number, number>();
for (const r of results) for (const m of r.regen.amitOnly) if (m.cause.code === 'F_ONE_TIME_OTHER_DATE') {
  const ds = m.cause.detail.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
  const best = ds.map(x => dayOff(x, r.date)).sort((a, b) => Math.abs(a) - Math.abs(b))[0];
  if (best !== undefined) otOffsets.set(best, (otOffsets.get(best) ?? 0) + 1);
}
const otLog = db.prepare(`
  SELECT o.date, (SELECT MIN(l.date) FROM delivery_log l WHERE upper(l.customer_id) = upper(o.id)) AS logdate
  FROM one_time_orders o WHERE o.date BETWEEN ? AND ?`).all(dates[0], dates[dates.length - 1]) as Array<{ date: string; logdate: string | null }>;
const otLogOffsets = new Map<number, number>();
for (const o of otLog) if (o.logdate) { const k = dayOff(o.logdate, o.date); otLogOffsets.set(k, (otLogOffsets.get(k) ?? 0) + 1); }
const botOneTime = botCauseCount.get('BOT_ONE_TIME') ?? 0;
const oneTimeMisdated = (causeCount.get('F_ONE_TIME_OTHER_DATE') ?? 0) + botOneTime;
// Package label: whose label agrees with the pack amount?
const PACK_TYPE: Record<number, string> = { 999: 'delight', 1450: 'bliss', 1950: 'joy', 2300: 'felicity', 2750: 'elation', 3950: 'grace' };
const subPack = db.prepare(`SELECT pack_amount FROM subscriptions WHERE customer_id = ? ORDER BY id DESC LIMIT 1`);
let pkgAmitOk = 0, pkgBotOk = 0, pkgOther = 0;
for (const r of results) for (const m of r.regen.mismatches) if (m.field === 'package') {
  const s = subPack.get(m.id) as { pack_amount: number } | undefined;
  const exp = s ? PACK_TYPE[s.pack_amount] : undefined;
  if (!exp) pkgOther++; else if (m.amit.toLowerCase() === exp) pkgAmitOk++; else if (m.bot.toLowerCase() === exp) pkgBotOk++; else pkgOther++;
}
const collectAmitZero = results.flatMap(r => r.regen.mismatches).filter(m => m.field === 'collect' && Number(m.amit) === 0).length;
const holdCust = new Map<string, string[]>();
for (const r of results) for (const m of r.regen.amitOnly) if (m.cause.code === 'B_SUB_HOLD') (holdCust.get(m.id) ?? holdCust.set(m.id, []).get(m.id)!).push(r.date);
const holdStillAug = [...holdCust.values()].filter(ds => ds.some(x => x >= '2026-08-01')).length;
const nearbyAmit = botCauseCount.get('AMIT_NEARBY_DATE') ?? 0;
L.push('## 8. Deeper checks', '');
L.push(`- **One-time (bouquet) dates are systematically off by one.** For Amit-only bouquet rows the DB's one_time_orders date minus Amit's delivery date: ${hist(otOffsets)}. Cross-check against delivery_log (Amit's actual sheets) for every one_time_order in range: log date minus DB date = ${hist(otLogOffsets)} (n=${otLog.filter(o => o.logdate).length}/${otLog.length}). The Master's bouquet "Date" column is the ORDER date; delivery is the next day. Both sides of the diff (Amit-only F_ONE_TIME_OTHER_DATE=${causeCount.get('F_ONE_TIME_OTHER_DATE') ?? 0} + bot-only BOT_ONE_TIME=${botOneTime}) are the same ${oneTimeMisdated} rows.`);
L.push(`- **Package label mismatches (${fieldCount.get('package')?.n ?? 0}) are mostly Amit's sheet, not the bot:** judged against the pack amount (999 Delight, 1450 Bliss, 1950 Joy, 2300 Felicity, 2750 Elation, 3950 Grace) the bot's label matches in ${pkgBotOk}, Amit's in ${pkgAmitOk}, neither/unknown ${pkgOther}.`);
L.push(`- **Collect mismatches (${fieldCount.get('collect')?.n ?? 0}) are semantic, not a gap:** Amit's "Payment" column is blank/0 in ${collectAmitZero} of them (filled after the run); the bot prints ₹ still to collect. Ignore.`);
L.push(`- **HOLD is a stale snapshot:** ${holdCust.size} distinct customers are HOLD in the DB yet on Amit's sheets; only ${holdStillAug} of them still appear in August, i.e. the Master's Active flag at import (2026-07-08) lagged reality and the bot has no resume path from the group.`);
L.push(`- **Weekday drift is two-sided:** Amit-only D_DAY_SHIFT* = ${cnt0('D_DAY')} plus bot-only AMIT_NEARBY_DATE = ${nearbyAmit} (bot lists the customer on a date within ±3 days of when Amit actually delivered) → ${cnt0('D_DAY') + nearbyAmit} rows.`, '');

// bridge list
function cnt0(prefix: string) { return [...causeCount.entries()].filter(([c]) => c.startsWith(prefix)).reduce((s, [, n]) => s + n, 0); }
const cnt = cnt0;
const perDay = (n: number) => (n / Math.max(1, results.length)).toFixed(1);
const bridge: Array<{ gap: string; evidence: number; fix: string }> = [
  { gap: 'One-off bouquets land on the wrong day (DB stores the ORDER date; delivery is the next day) — bot lists them a day early and misses them on the real day', evidence: oneTimeMisdated, fix: 'importMaster.ts insertOneTime: store delivery date = Master date + 1 (or add an order_date column and make dueRows() use delivery date); one-shot SQL to shift existing one_time_orders where delivery_log shows +1; keep bouquet intake from the group writing the DELIVERY date.' },
  { gap: 'Wrong weekday: bot has the delivery within ±3 days of Amit\'s actual day (biweekly 2nd day guessed as +3 with day2 never populated; weekly reschedules not applied)', evidence: cnt('D_DAY') + nearbyAmit, fix: 'renewal.ts createNextCycle: use subscriptions.day2 for BIWEEKLY instead of addDays(weekStart, 3); importMaster.ts: fill day2 from the Master\'s second delivery-date column weekday (pairs are already read) instead of leaving \'\'; actions.ts: reschedule messages must set deliveries.changed_date.' },
  { gap: 'Subscription HOLD in DB while Amit still delivers (stale Master Active flag; no resume path)', evidence: cnt('B_SUB_'), fix: 'actions.ts: add "resume <id>" / "start again" handling; nightly sweep: any HOLD customer that appears in delivery_log/Amit sheet → auto-ACTIVE + Review note; re-import Master status column with the next import.' },
  { gap: 'Cycle timing off by about a week (bot has the customer within ±7d but not ±3d) or no cycle at all — renewal started a week late/early', evidence: cnt('C_') + cnt('D7_'), fix: 'renewal.ts createNextCycle: start the new cycle on the first fixed day AFTER the last delivery of the previous cycle (not nextWeekdayAfter(today)); autoRenewDueSubscriptions should run as soon as the last delivery date passes, and treat >21d dormant as renew+Review rather than skip.' },
  { gap: 'Bouquets never entered (no one_time_orders row at all) — group intake for one-offs stopped 2026-08-05', evidence: cnt('F_BOUQUET'), fix: 'groupUpdates/actions.ts: parse bouquet posts ("Bouquet ₹X, <name>, <address>, <date>") into one_time_orders; dashboard manual-update panel already stages text — make the parser create B- rows; backfill from Amit sheets (rows with revenue == pack).' },
  { gap: 'Bot schedules ACTIVE weekly customers Amit did not deliver (holds/skips known only to staff)', evidence: (botCauseCount.get('BOT_EXTRA_ACTIVE_WEEKLY') ?? 0) + (botCauseCount.get('BOT_EXTRA_ACTIVE_BIWEEKLY') ?? 0) + (botCauseCount.get('HOLD_SKIP_IN_REMARKS') ?? 0), fix: 'actions.ts hold/skip: mark the specific deliveries row HELD/SKIPPED (dueRows already excludes those); Review queue: flag customers with 2+ consecutive non-deliveries in delivery_log vs plan.' },
  { gap: 'Customer ID unknown to the DB (new gift G-000xx, M-prefixed and corporate IDs since the 2026-07-08 Master import)', evidence: cnt('A_'), fix: 'importMaster.ts normalizeCustomerId: accept M-/CP- prefixes; re-import the current Master; add a "new customer" intake path from the Updates group.' }
].sort((x, y) => y.evidence - x.evidence);
L.push('## 7. How to bridge the gap (ranked by evidence rows across all Amit dates)', '');
bridge.forEach((b, i) => L.push(`${i + 1}. **${b.gap}** — evidence: ${b.evidence} rows (~${perDay(b.evidence)} rows/day).  \n   Fix: ${b.fix}`));
L.push('');
const filesMissing = results.filter(r => r.file && r.file.botRows < r.file.amitRows * 0.5);
if (filesMissing.length) {
  L.push('### Note on the files the bot actually emitted', '');
  L.push(`${filesMissing.length} of ${files.length} generated sheets had fewer than half of Amit's rows at generation time (e.g. ${filesMissing.slice(0, 3).map(r => `${r.date}: ${r.file!.botRows} vs ${r.file!.amitRows}`).join('; ')}). The regen numbers above are with today's DB (post auto-renew fix 2026-08-11); the historical files show the pre-fix state where cycles were not being continued.`, '');
}

// ---------- 9. independent window detail + coverage ----------
const indep = results.filter(r => r.date >= INDEPENDENT_FROM);
const causeIn = (rs: DateResult[], side: "amitOnly" | "botOnly") => { const m = new Map<string, number>(); for (const r of rs) for (const x of r.regen[side]) m.set(x.cause.code, (m.get(x.cause.code) ?? 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => c + "=" + n).join(", "); };
L.push("## 9. Independent window (Aug 11+) detail", "");
L.push("Amit-only causes: " + (causeIn(indep, "amitOnly") || "none"), "", "Bot-only causes: " + (causeIn(indep, "botOnly") || "none"), "");
for (const r of indep.filter(r => r.file)) {
  const f = r.file!;
  L.push("- **" + r.date + " bot FILE vs Amit:** Amit " + f.amitRows + " rows, bot file " + f.botRows + ", common " + f.common + ", Amit-only " + f.amitOnly.length + " (" + [...f.amitOnly.reduce((m, x) => m.set(x.cause.code, (m.get(x.cause.code) ?? 0) + 1), new Map<string, number>()).entries()].map(([c, n]) => c + "=" + n).join(", ") + "), bot-only " + f.botOnly.length + " (" + [...f.botOnly.reduce((m, x) => m.set(x.cause.code, (m.get(x.cause.code) ?? 0) + 1), new Map<string, number>()).entries()].map(([c, n]) => c + "=" + n).join(", ") + ").");
}
const expected: string[] = []; for (let d = dates[0]; d <= dates[dates.length - 1]; d = addDays(d, 1)) if (!amitByDate.has(d)) expected.push(d);
L.push("", "Amit dates missing in the range (re-run picks them up automatically once the .xlsx is in Downloads or data/amit-sheets/): " + (expected.join(", ") || "none"), "");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'report.md'), L.join('\n'));
fs.writeFileSync(path.join(outDir, 'details.json'), JSON.stringify({
  generated: new Date().toISOString(), dbPath, amitDirs, results,
  aggregates: { july: julyAgg, independent: indepAgg }, causeCount: [...causeCount], botCauseCount: [...botCauseCount],
  topMissed: topMissed.map(([id, e]) => ({ id, ...e, causes: [...e.causes] })),
  topExtra: topExtra.map(([id, e]) => ({ id, ...e, causes: [...e.causes] })),
  fieldCount: [...fieldCount], bridge
}, null, 2));

console.log(`Compared ${results.length} Amit dates (${dates[0]}..${dates[dates.length - 1]}); ${files.length} had bot files.`);
console.log(`July window recall ${pct(julyAgg.recall)} precision ${pct(julyAgg.precision)}; Aug11+ recall ${pct(indepAgg.recall)} precision ${pct(indepAgg.precision)}.`);
console.log('Top causes:', [...causeCount.entries()].sort((x, y) => y[1] - x[1]).slice(0, 6).map(([c, n]) => `${c}=${n}`).join(', '));
console.log(`Report: ${path.join(outDir, 'report.md')}`);
db.close();
