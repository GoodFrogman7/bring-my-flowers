/**
 * Import the owner's Master workbook into the business datastore.
 *
 *   npx ts-node scripts/import-master.ts <path-to-Master.xlsx> [db-path] [--as-of YYYY-MM-DD]
 *
 * Wipes and reloads (migration tool, not a sync). Prints an import report.
 */
import { openDb } from '../src/business/db';
import { importMaster } from '../src/business/importMaster';
import { todayIST } from '../src/business/dates';

const rawArgs = process.argv.slice(2);
const asOfIndex = rawArgs.indexOf('--as-of');
const asOf = asOfIndex >= 0 ? rawArgs[asOfIndex + 1] : todayIST();
const positional = asOfIndex >= 0 ? [...rawArgs.slice(0, asOfIndex), ...rawArgs.slice(asOfIndex + 2)] : rawArgs;
const [workbookPath, dbPath = './data/business.db'] = positional;
if (!workbookPath) {
  console.error('Usage: npx ts-node scripts/import-master.ts <Master.xlsx> [db-path] [--as-of YYYY-MM-DD]');
  process.exit(1);
}

const db = openDb(dbPath);
const report = importMaster(db, workbookPath, { asOf });
console.log(`asOf: ${asOf} (IST)`);

console.log('\n=== Master import report ===');
console.log(`Rows in MASTER tab:   ${report.totalRows}`);
console.log(`Subscription rows:    ${report.subscriptionRows}`);
console.log(`One-time orders:      ${report.oneTimeOrders}`);
console.log(`Skipped rows:         ${report.skippedRows}`);
console.log(`→ Customers:          ${report.customers}`);
console.log(`→ Subscriptions:      ${report.subscriptions}`);
console.log(`→ Cycles:             ${report.cycles}`);
console.log(`→ Deliveries:         ${report.deliveries}`);
if (report.warnings.length > 0) {
  console.log(`\nWarnings (first ${Math.min(report.warnings.length, 20)} of ${report.warnings.length}):`);
  for (const warning of report.warnings.slice(0, 20)) console.log(`  - ${warning}`);
}

const active = db.prepare(`SELECT COUNT(*) AS n FROM subscriptions WHERE status = 'ACTIVE'`).get() as { n: number };
const hold = db.prepare(`SELECT COUNT(*) AS n FROM subscriptions WHERE status = 'HOLD'`).get() as { n: number };
const upcoming = db.prepare(`
  SELECT COUNT(*) AS n FROM deliveries WHERE status = 'PLANNED'`).get() as { n: number };
console.log(`\nActive subscriptions: ${active.n} · On hold: ${hold.n} · Planned deliveries ahead: ${upcoming.n}`);
console.log(`DB: ${dbPath}`);
