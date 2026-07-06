import * as XLSX from 'xlsx';
import { BusinessDb } from './db';
import {
  serialToDate,
  normalizePhones,
  classifyActiveValue,
  mapPaymentStatus,
  frequencyFromRevenue,
  parseRestrictions,
  isOneTimeId,
  normalizeCustomerId
} from './parse';
import logger from '../utils/logger';

/**
 * Import the owner's Master workbook (MASTER tab) into the datastore.
 *
 * Master facts (docs/BUSINESS.md):
 *  - One row = one customer-CYCLE (renewals append rows; 'Active 1' marks the
 *    current cycle, 'Renewed' rows are history).
 *  - Weekly cycles: 4 date-pairs (planned + changed/rescheduled).
 *  - Biweekly cycles: the same pairs hold TWO deliveries each (the week's
 *    first and second visit) — 8 deliveries total.
 *  - 'Bouquet' rows are one-time orders with their own B-prefix ID scheme.
 *
 * The import is idempotent per run (wipes and reloads — it is a migration
 * tool, not a sync) and tolerant: unparseable rows land in the report, never
 * throw.
 */

// MASTER tab column indexes (0-based) — from the real Apr-2026 workbook.
const COL = {
  ACTIVE: 0,
  DATE: 1,
  ID: 6,
  NAME: 7,
  EMAIL: 8,
  PHONE: 9,
  ADDRESS: 10,
  ZONE: 11,
  DAY: 13,
  TIME_SLOT: 14,
  PACK: 15,
  REVENUE: 16,
  TYPE: 17,
  PAYMENT_TYPE: 18,
  PAYMENT_STATUS: 19,
  COLLECT: 20,
  CYCLES_PENDING: 21,
  PAYMENT_DATE: 23,
  REMARKS: 25,
  FLOWER_RESTRICTION: 26,
  EXTRA_INSTRUCTION: 27,
  DELIVERY_DATES_START: 32 // 4 pairs: (1st del, 1st chngd), … (4th del, 4th chngd)
} as const;

export interface ImportReport {
  totalRows: number;
  subscriptionRows: number;
  oneTimeOrders: number;
  skippedRows: number;
  customers: number;
  subscriptions: number;
  cycles: number;
  deliveries: number;
  warnings: string[];
}

interface MasterRow {
  rowNumber: number;
  cells: unknown[];
}

function cell(row: MasterRow, col: number): unknown {
  return row.cells[col];
}

function text(row: MasterRow, col: number): string {
  return String(row.cells[col] ?? '').trim();
}

function num(row: MasterRow, col: number): number {
  const n = Number(row.cells[col]);
  return Number.isFinite(n) ? n : 0;
}

export function importMaster(db: BusinessDb, workbookPath: string, options: { asOf?: string } = {}): ImportReport {
  const asOf = options.asOf ?? new Date().toISOString().split('T')[0];
  const workbook = XLSX.readFile(workbookPath, { sheets: ['MASTER'] });
  const sheet = workbook.Sheets['MASTER'];
  if (!sheet) throw new Error(`No MASTER tab in ${workbookPath}`);

  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
  const rows: MasterRow[] = grid.slice(1).map((cells, i) => ({ rowNumber: i + 2, cells }));

  const report: ImportReport = {
    totalRows: rows.length,
    subscriptionRows: 0,
    oneTimeOrders: 0,
    skippedRows: 0,
    customers: 0,
    subscriptions: 0,
    cycles: 0,
    deliveries: 0,
    warnings: []
  };
  const warn = (msg: string) => {
    if (report.warnings.length < 200) report.warnings.push(msg);
  };

  // Group subscription rows by customer ID; collect one-time orders directly.
  const byCustomer = new Map<string, { rows: MasterRow[]; hasCurrent: boolean; status: string }>();
  const oneTimeRows: MasterRow[] = [];

  for (const row of rows) {
    const activeInfo = classifyActiveValue(cell(row, COL.ACTIVE));
    const rawId = normalizeCustomerId(cell(row, COL.ID));

    if (activeInfo.kind === 'ONE_TIME' || (rawId && isOneTimeId(rawId))) {
      oneTimeRows.push(row);
      continue;
    }
    if (activeInfo.kind === 'SKIP') {
      // Rows with a real subscriber ID but odd status still count; pure junk doesn't
      if (!rawId) {
        report.skippedRows++;
        continue;
      }
    }
    if (!rawId) {
      report.skippedRows++;
      warn(`row ${row.rowNumber}: subscription row without usable ID (name="${text(row, COL.NAME)}")`);
      continue;
    }

    const group = byCustomer.get(rawId) ?? { rows: [], hasCurrent: false, status: 'ACTIVE' };
    group.rows.push(row);
    if (activeInfo.isCurrent) {
      group.hasCurrent = true;
      group.status = activeInfo.status;
    }
    byCustomer.set(rawId, group);
    report.subscriptionRows++;
  }

  const insertCustomer = db.prepare(`
    INSERT OR REPLACE INTO customers (id, name, phones, email, address, zone, remarks, extra_instruction)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertSubscription = db.prepare(`
    INSERT INTO subscriptions (customer_id, package_name, pack_amount, frequency, day, day2, time_slot, status, is_corporate, is_gift)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertRestriction = db.prepare(`INSERT OR IGNORE INTO restrictions (customer_id, flower) VALUES (?, ?)`);
  const insertCycle = db.prepare(`
    INSERT INTO cycles (subscription_id, renewal_date, deliveries_planned, pack_amount, per_delivery_revenue,
                        payment_status, payment_mode, payment_date, collect, remarks, source_row)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertDelivery = db.prepare(`
    INSERT INTO deliveries (cycle_id, one_time_order_id, seq, planned_date, changed_date, status)
    VALUES (?, ?, ?, ?, ?, ?)`);
  const insertOneTime = db.prepare(`
    INSERT OR REPLACE INTO one_time_orders (id, customer_name, phone, address, zone, date, time_slot, amount, description, payment_status, remarks)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  const wipe = db.transaction(() => {
    for (const table of ['deliveries', 'cycles', 'restrictions', 'subscriptions', 'one_time_orders', 'customers']) {
      db.prepare(`DELETE FROM ${table}`).run();
    }
  });

  const run = db.transaction(() => {
    wipe();

    for (const [customerId, group] of byCustomer) {
      // Latest row (by renewal date, falling back to sheet order) defines
      // current customer/subscription attributes.
      const sorted = [...group.rows].sort((a, b) =>
        serialToDate(cell(a, COL.DATE)).localeCompare(serialToDate(cell(b, COL.DATE))) || a.rowNumber - b.rowNumber
      );
      const latest = sorted[sorted.length - 1];

      insertCustomer.run(
        customerId,
        text(latest, COL.NAME),
        normalizePhones(cell(latest, COL.PHONE)),
        text(latest, COL.EMAIL),
        text(latest, COL.ADDRESS),
        text(latest, COL.ZONE),
        text(latest, COL.REMARKS),
        text(latest, COL.EXTRA_INSTRUCTION)
      );
      report.customers++;

      for (const flower of parseRestrictions(cell(latest, COL.FLOWER_RESTRICTION))) {
        insertRestriction.run(customerId, flower);
      }

      const { frequency } = frequencyFromRevenue(cell(latest, COL.PACK), cell(latest, COL.REVENUE));
      const packageName = text(latest, COL.TYPE);
      const activeValue = String(cell(latest, COL.ACTIVE) ?? '').trim().toLowerCase();
      const subscriptionId = insertSubscription.run(
        customerId,
        packageName,
        num(latest, COL.PACK),
        frequency,
        text(latest, COL.DAY),
        '', // day2 lives only in remarks ("Friday n Monday"); left for Phase B
        text(latest, COL.TIME_SLOT),
        group.status,
        activeValue === 'corporate' || /corporate/i.test(packageName) ? 1 : 0,
        customerId.startsWith('G') ? 1 : 0
      ).lastInsertRowid as number;
      report.subscriptions++;

      for (const row of sorted) {
        const { frequency: rowFreq, deliveriesPerCycle } = frequencyFromRevenue(cell(row, COL.PACK), cell(row, COL.REVENUE));
        const cycleId = insertCycle.run(
          subscriptionId,
          serialToDate(cell(row, COL.DATE)),
          deliveriesPerCycle,
          num(row, COL.PACK),
          num(row, COL.REVENUE),
          mapPaymentStatus(cell(row, COL.PAYMENT_STATUS)),
          text(row, COL.PAYMENT_TYPE),
          serialToDate(cell(row, COL.PAYMENT_DATE)),
          num(row, COL.COLLECT),
          text(row, COL.REMARKS),
          row.rowNumber
        ).lastInsertRowid as number;
        report.cycles++;

        // 4 date-pairs. Weekly: pair = (planned, changed). Biweekly: pair =
        // two separate deliveries (the week's 1st and 2nd visit).
        let seq = 1;
        for (let pair = 0; pair < 4; pair++) {
          const first = serialToDate(cell(row, COL.DELIVERY_DATES_START + pair * 2));
          const second = serialToDate(cell(row, COL.DELIVERY_DATES_START + pair * 2 + 1));
          if (rowFreq === 'BIWEEKLY') {
            for (const date of [first, second]) {
              if (!date) continue;
              insertDelivery.run(cycleId, null, seq++, date, '', date < asOf ? 'DELIVERED' : 'PLANNED');
              report.deliveries++;
            }
          } else {
            if (!first && !second) continue;
            const effective = second || first;
            insertDelivery.run(cycleId, null, seq++, first || second, second && first ? second : '', effective < asOf ? 'DELIVERED' : 'PLANNED');
            report.deliveries++;
          }
        }
      }
    }

    for (const row of oneTimeRows) {
      const rawId = normalizeCustomerId(cell(row, COL.ID)) || `B-ROW${row.rowNumber}`;
      const date = serialToDate(cell(row, COL.DATE));
      insertOneTime.run(
        rawId,
        text(row, COL.NAME),
        normalizePhones(cell(row, COL.PHONE)),
        text(row, COL.ADDRESS),
        text(row, COL.ZONE),
        date,
        text(row, COL.TIME_SLOT),
        num(row, COL.PACK),
        text(row, COL.TYPE),
        mapPaymentStatus(cell(row, COL.PAYMENT_STATUS)),
        text(row, COL.REMARKS)
      );
      report.oneTimeOrders++;
    }
  });

  run();
  logger.info({
    customers: report.customers,
    cycles: report.cycles,
    deliveries: report.deliveries,
    oneTime: report.oneTimeOrders,
    skipped: report.skippedRows
  }, 'Master import complete');
  return report;
}
