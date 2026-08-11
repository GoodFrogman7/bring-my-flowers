/**
 * Backfill delivery_log from the owner's real daily "<date> Del Sheet" email
 * archive. Each file is a single-tab workbook for one delivery date — not the
 * multi-tab "dd-mm-yy" Feedback format importFeedback() expects, so this
 * rewrites each file's sole tab to that naming convention (in a temp copy,
 * never mutating the source) and feeds it through the existing, unmodified
 * importFeedback(). Safe to re-run: delivery_log has a
 * UNIQUE(customer_id, date, source) constraint.
 *
 *   npx ts-node scripts/backfill-delivery-log-from-emails.ts <dir-of-YYYY-MM-DD.xlsx> [db-path]
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as XLSX from 'xlsx';
import { openDb } from '../src/business/db';
import { importFeedback } from '../src/business/importFeedback';

const [sourceDir, dbPath = './data/business.db'] = process.argv.slice(2);
if (!sourceDir) {
  console.error('Usage: npx ts-node scripts/backfill-delivery-log-from-emails.ts <dir-of-YYYY-MM-DD.xlsx> [db-path]');
  process.exit(1);
}

/** "2026-07-16" -> "16-7-26" (tabNameToDate's expected dd-mm-yy shape). */
function toTabName(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${Number(day)}-${Number(month)}-${year.slice(2)}`;
}

const db = openDb(dbPath);
const files = fs.readdirSync(sourceDir).filter(f => /^\d{4}-\d{2}-\d{2}\.xlsx$/.test(f));
files.sort();

let totalRows = 0;
let totalTabs = 0;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bmf-feedback-backfill-'));

for (const file of files) {
  const isoDate = file.replace('.xlsx', '');
  const srcPath = path.join(sourceDir, file);
  const workbook = XLSX.readFile(srcPath);
  // Sheet order is inconsistent across files (some are [Sheet1], others
  // [Sheet2, Sheet1]) — pick the tab whose header row actually has an "ID"
  // column (the per-customer delivery rows), not just the first tab.
  const dataSheetName = workbook.SheetNames.find(name => {
    const firstRow = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, range: 0 })[0] as unknown[] | undefined;
    return firstRow?.some(cell => String(cell ?? '').trim().toLowerCase() === 'id');
  }) ?? workbook.SheetNames[0];

  // Rewrite as a single-tab workbook named in dd-mm-yy form, in a temp copy.
  const renamed = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(renamed, workbook.Sheets[dataSheetName], toTabName(isoDate));
  const tmpPath = path.join(tmpDir, file);
  XLSX.writeFile(renamed, tmpPath);

  const report = importFeedback(db, tmpPath);
  totalRows += report.rows;
  totalTabs += report.tabs;
  console.log(`${isoDate}: ${report.rows} rows imported (source tab "${dataSheetName}")`);
}

fs.rmSync(tmpDir, { recursive: true, force: true });
console.log(`\nDone: ${files.length} files, ${totalTabs} tabs, ${totalRows} delivery_log rows upserted.`);
