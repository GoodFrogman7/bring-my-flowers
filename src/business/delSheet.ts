import * as XLSX from 'xlsx';
import { BusinessDb } from './db';
import { deliveryStatusString, PaymentStatus } from './parse';
import logger from '../utils/logger';

/**
 * Generate the daily delivery sheet in the owner's exact format: same 30
 * columns his team works with today, including the five "Pre Flowers"
 * lookback columns (what the customer received on their last 5 deliveries,
 * from delivery_log). Flower 1-3/Stick assignment stays manual for now
 * (Phase C automates it); the exporter leaves those columns empty exactly
 * where the owner fills them in.
 */

export const DEL_SHEET_HEADERS = [
  'ID', 'Name', 'Ph. Number', 'Address', 'Zone', 'Day', 'Time Slot', 'Pack', 'Revenue',
  ' Type', 'Remarks', 'Flower Restriction', 'Extra Instruction', 'Final Number of Delivery',
  'Pre Flowers 4', 'Pre Flowers 3', 'Pre Flowers 2', 'Pre Flowers 1', 'Pre Flowers ',
  'Flower 1', 'Stick', 'Flower 2', 'Stick', 'Flower 3', 'Stick',
  'Consumables', 'Delivered By', 'Priority', 'Feedback', 'Payment'
] as const;

export interface DelSheetRow {
  id: string;
  name: string;
  phones: string;
  address: string;
  zone: string;
  day: string;
  timeSlot: string;
  pack: number;
  revenue: number;
  packageName: string;
  remarks: string;
  restriction: string;
  extraInstruction: string;
  statusString: string;
  /** Oldest → newest, up to 5 entries. */
  preFlowers: string[];
  collect: number | '';
}

export function dueRows(db: BusinessDb, date: string): DelSheetRow[] {
  interface SubDue {
    id: string; name: string; phones: string; address: string; zone: string;
    day: string; time_slot: string; pack_amount: number; per_delivery_revenue: number;
    package_name: string; remarks: string; extra_instruction: string;
    seq: number; payment_status: PaymentStatus; collect: number; subscription_id: number;
  }
  const subscriptionRows = db.prepare(`
    SELECT c.id, c.name, c.phones, c.address, c.zone,
           s.day, s.time_slot, cy.pack_amount, cy.per_delivery_revenue,
           s.package_name, c.remarks, c.extra_instruction,
           d.seq, cy.payment_status, cy.collect, s.id AS subscription_id
    FROM deliveries d
    JOIN cycles cy ON d.cycle_id = cy.id
    JOIN subscriptions s ON cy.subscription_id = s.id
    JOIN customers c ON s.customer_id = c.id
    WHERE s.status = 'ACTIVE'
      AND d.status IN ('PLANNED', 'DELIVERED')
      AND COALESCE(NULLIF(d.changed_date, ''), d.planned_date) = ?
    ORDER BY c.zone, s.time_slot, c.name
  `).all(date) as SubDue[];

  const restrictionsFor = db.prepare(`SELECT flower FROM restrictions WHERE customer_id = ?`);
  const pendingCyclesFor = db.prepare(`
    SELECT COUNT(*) AS n FROM cycles WHERE subscription_id = ? AND payment_status = 'PENDING'`);
  const lastFive = db.prepare(`
    SELECT flowers FROM delivery_log
    WHERE customer_id = ? AND date < ? AND flowers != ''
    ORDER BY date DESC LIMIT 5`);

  const rows: DelSheetRow[] = subscriptionRows.map(sub => {
    const restrictions = (restrictionsFor.all(sub.id) as Array<{ flower: string }>).map(r => r.flower).join(' n ');
    const pending = (pendingCyclesFor.get(sub.subscription_id) as { n: number }).n;
    const recent = (lastFive.all(sub.id, date) as Array<{ flowers: string }>).map(r => r.flowers);
    return {
      id: sub.id,
      name: sub.name,
      phones: sub.phones,
      address: sub.address,
      zone: sub.zone,
      day: sub.day,
      timeSlot: sub.time_slot,
      pack: sub.pack_amount,
      revenue: sub.per_delivery_revenue,
      packageName: sub.package_name,
      remarks: sub.remarks,
      restriction: restrictions,
      extraInstruction: sub.extra_instruction,
      statusString: deliveryStatusString(sub.seq, pending, sub.payment_status, sub.collect),
      preFlowers: recent.reverse(), // oldest first → maps onto Pre Flowers 4..newest
      collect: sub.payment_status === 'PENDING' && sub.collect > 0 ? sub.collect : ''
    };
  });

  interface OneTimeDue {
    id: string; customer_name: string; phone: string; address: string; zone: string;
    time_slot: string; amount: number; description: string; remarks: string;
    payment_status: PaymentStatus;
  }
  const oneTimeRows = db.prepare(`
    SELECT id, customer_name, phone, address, zone, time_slot, amount, description, remarks, payment_status
    FROM one_time_orders WHERE date = ? ORDER BY zone, customer_name
  `).all(date) as OneTimeDue[];

  for (const order of oneTimeRows) {
    rows.push({
      id: order.id,
      name: order.customer_name,
      phones: order.phone,
      address: order.address,
      zone: order.zone,
      day: '',
      timeSlot: order.time_slot,
      pack: order.amount,
      revenue: order.amount,
      packageName: order.description || 'Bouquet',
      remarks: order.remarks,
      restriction: '',
      extraInstruction: '',
      statusString: `1  del of this cycle   -  0-cycles pmnt   ${order.payment_status === 'COMPLETED' ? 'Completed' : 'Pending'} - Collect ${order.payment_status === 'COMPLETED' ? 0 : order.amount}`,
      preFlowers: [],
      collect: order.payment_status === 'COMPLETED' ? '' : order.amount
    });
  }

  return rows;
}

export function writeDelSheet(db: BusinessDb, date: string, outPath: string): number {
  const rows = dueRows(db, date);

  const grid: unknown[][] = [DEL_SHEET_HEADERS as unknown as unknown[]];
  for (const row of rows) {
    // Pre Flowers columns run oldest (Pre Flowers 4) → newest (Pre Flowers)
    const pre = new Array<string>(5).fill('');
    const recent = row.preFlowers.slice(-5);
    for (let i = 0; i < recent.length; i++) {
      pre[5 - recent.length + i] = recent[i];
    }
    grid.push([
      row.id, row.name, row.phones.replace(/\/\//g, ' // '), row.address, row.zone,
      row.day, row.timeSlot, row.pack, row.revenue, row.packageName,
      row.remarks, row.restriction, row.extraInstruction, row.statusString,
      pre[0], pre[1], pre[2], pre[3], pre[4],
      '', '', '', '', '', '',   // Flower 1-3 + sticks (assigned by the owner / Phase C)
      '', '', '', '', row.collect
    ]);
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(grid), 'Sheet1');
  XLSX.writeFile(workbook, outPath);
  logger.info({ date, rows: rows.length, outPath }, 'Delivery sheet generated');
  return rows.length;
}
