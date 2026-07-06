import * as XLSX from 'xlsx';
import { BusinessDb } from './db';
import { normalizeCustomerId } from './parse';
import logger from '../utils/logger';

/**
 * Import a Feedback workbook (one tab per delivery date) into delivery_log —
 * the record of which flowers each customer actually received, plus driver,
 * feedback, and cash collected. Powers the last-5-flowers no-repeat rule.
 *
 * Tabs vary in width across dates, so columns are located by header name,
 * not position. Tab names like "01-06-26", "06-6-26", " 07-06-26" (dd-mm-yy).
 */

export interface FeedbackImportReport {
  tabs: number;
  tabsSkipped: string[];
  rows: number;
  rowsWithoutId: number;
}

/** "01-06-26" / " 07-6-26" → "2026-06-01"; null when not a date tab. */
export function tabNameToDate(name: string): string | null {
  const match = name.trim().match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/);
  if (!match) return null;
  const [, dd, mm, yy] = match;
  const year = yy.length === 2 ? `20${yy}` : yy;
  const month = mm.padStart(2, '0');
  const day = dd.padStart(2, '0');
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31) return null;
  return `${year}-${month}-${day}`;
}

function findColumn(headers: string[], name: string, from: number = 0): number {
  const target = name.toLowerCase();
  for (let i = from; i < headers.length; i++) {
    if (headers[i].trim().toLowerCase() === target) return i;
  }
  return -1;
}

/**
 * The flowers-sent string for a row, in the owner's own format
 * ("Rajni ( 14 Inch ) 16     Grass"). Some tabs carry a pre-combined formula
 * column ("Flower 1 Stick Flower 2 Stick … Consumables") — use it verbatim
 * when present, since it is exactly what his Pre-Flowers lookups display.
 * Otherwise compose flower+stick pairs from the individual columns.
 */
export function combineFlowers(cells: unknown[], headers: string[]): string {
  for (let i = 0; i < headers.length; i++) {
    if (/^flower\s*1\s+stick/i.test(headers[i].trim())) {
      const combined = String(cells[i] ?? '').trim();
      if (combined) return combined;
    }
  }
  const parts: string[] = [];
  let consumables = '';
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i].trim();
    if (/^flower\s*\d+$/i.test(header)) {
      const flower = String(cells[i] ?? '').trim();
      if (!flower) continue;
      // Stick count lives in the next column ("Stick"/"stick")
      const stick = String(cells[i + 1] ?? '').trim();
      parts.push(stick ? `${flower} ${stick}` : flower);
    } else if (/^consumables$/i.test(header)) {
      consumables = String(cells[i] ?? '').trim();
    }
  }
  if (parts.length === 0) return '';
  return consumables ? `${parts.join(' ')}     ${consumables}` : parts.join(' ');
}

export function importFeedback(db: BusinessDb, workbookPath: string): FeedbackImportReport {
  const workbook = XLSX.readFile(workbookPath);
  const report: FeedbackImportReport = { tabs: 0, tabsSkipped: [], rows: 0, rowsWithoutId: 0 };
  const source = workbookPath.split(/[\\/]/).pop() ?? workbookPath;

  const insert = db.prepare(`
    INSERT OR REPLACE INTO delivery_log
      (customer_id, date, flowers, consumables, delivered_by, feedback, cash_collected, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

  const run = db.transaction(() => {
    for (const tabName of workbook.SheetNames) {
      const date = tabNameToDate(tabName);
      if (!date) {
        report.tabsSkipped.push(tabName);
        continue;
      }
      const grid = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[tabName], { header: 1, defval: '' });
      if (grid.length < 2) {
        report.tabsSkipped.push(tabName);
        continue;
      }
      const headers = (grid[0] as unknown[]).map(h => String(h ?? ''));
      const idCol = findColumn(headers, 'ID');
      const consumablesCol = findColumn(headers, 'Consumables');
      const deliveredByCol = findColumn(headers, 'Delivered By');
      const feedbackCol = findColumn(headers, 'Feedback');
      const paymentCol = findColumn(headers, 'Payment');
      report.tabs++;

      for (const cells of grid.slice(1)) {
        const customerId = normalizeCustomerId(idCol >= 0 ? cells[idCol] : '');
        if (!customerId) {
          report.rowsWithoutId++;
          continue;
        }
        const flowers = combineFlowers(cells, headers);
        const cash = Number(paymentCol >= 0 ? cells[paymentCol] : 0);
        insert.run(
          customerId,
          date,
          flowers,
          consumablesCol >= 0 ? String(cells[consumablesCol] ?? '').trim() : '',
          deliveredByCol >= 0 ? String(cells[deliveredByCol] ?? '').trim() : '',
          feedbackCol >= 0 ? String(cells[feedbackCol] ?? '').trim() : '',
          Number.isFinite(cash) ? cash : 0,
          `${source}#${tabName.trim()}`
        );
        report.rows++;
      }
    }
  });

  run();
  logger.info({ tabs: report.tabs, rows: report.rows, skippedTabs: report.tabsSkipped.length }, 'Feedback import complete');
  return report;
}
