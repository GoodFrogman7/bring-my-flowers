/**
 * Export the datastore as a Master-view workbook (the owner's format).
 *
 *   npx ts-node scripts/export-master.ts [out.xlsx] [db-path]
 */
import { openDb } from '../src/business/db';
import { writeMasterView } from '../src/business/exportMaster';
import { todayIST } from '../src/business/dates';

const [outPath = `./data/master-view-${todayIST()}.xlsx`, dbPath = './data/business.db'] = process.argv.slice(2);
const db = openDb(dbPath);
const rows = writeMasterView(db, outPath);
console.log(`${rows} rows → ${outPath}`);
