/**
 * Generate the daily delivery sheet from the datastore, in the owner's format.
 *
 *   npx ts-node scripts/make-del-sheet.ts <YYYY-MM-DD> [out.xlsx] [db-path]
 */
import { openDb } from '../src/business/db';
import { writeDelSheetDetailed } from '../src/business/delSheet';

const [date, outPath, dbPath = './data/business.db'] = process.argv.slice(2);
if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error('Usage: npx ts-node scripts/make-del-sheet.ts <YYYY-MM-DD> [out.xlsx] [db-path]');
  process.exit(1);
}

const db = openDb(dbPath);
const out = outPath ?? `./data/del-sheet-${date}.xlsx`;
const result = writeDelSheetDetailed(db, date, out);
console.log(`${result.rows} deliveries for ${date} → ${out}`);
console.log(`Auto-assigned: ${result.autoAssigned} · manual: ${result.manual.length}`);
for (const entry of result.manual.slice(0, 15)) {
  console.log(`  ✍️ #${entry.id} ${entry.name} — ${entry.reason}`);
}
if (result.manual.length > 15) console.log(`  …and ${result.manual.length - 15} more`);
