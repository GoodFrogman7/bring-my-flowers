/**
 * Import a Feedback workbook (daily tabs) into delivery_log.
 *
 *   npx ts-node scripts/import-feedback.ts <Feedback.xlsx> [db-path]
 */
import { openDb } from '../src/business/db';
import { importFeedback } from '../src/business/importFeedback';

const [workbookPath, dbPath = './data/business.db'] = process.argv.slice(2);
if (!workbookPath) {
  console.error('Usage: npx ts-node scripts/import-feedback.ts <Feedback.xlsx> [db-path]');
  process.exit(1);
}

const db = openDb(dbPath);
const report = importFeedback(db, workbookPath);
console.log(`Tabs imported: ${report.tabs} · rows: ${report.rows} · rows without ID: ${report.rowsWithoutId}`);
if (report.tabsSkipped.length) console.log(`Tabs skipped (not date-named): ${report.tabsSkipped.join(', ')}`);
