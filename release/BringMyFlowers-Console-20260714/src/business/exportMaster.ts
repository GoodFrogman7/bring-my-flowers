import * as XLSX from 'xlsx';
import { BusinessDb } from './db';
import logger from '../utils/logger';

/**
 * Export the datastore as a Master-view workbook — the same shape the owner
 * reads today (one row per customer-cycle, his column vocabulary, his status
 * words, biweekly date-pair encoding). This is the verification artifact for
 * the pilot: after the bot applies a customer's instruction, regenerating
 * this file shows the change exactly where he'd look for it in his own
 * Master. The DB stays the source of truth; this sheet is a view of it.
 */

const HEADERS = [
  'Active', 'Date', 'ID', 'Name', 'Mail Id', 'Ph. Number', 'Address', 'Zone',
  'Day', 'Time Slot', 'Pack', 'Revenue', 'Type', 'Payment Type', 'Payment status',
  'Collect', 'Remarks', 'Flower Restriction', 'Extra Instruction',
  '1st del Date', '1st del Chngd date', '2nd Delivery', '2nd del Chngd Date',
  '3rd Delivery', '3rd del Chngd Date', '4th Delivery', '4th del Chngd Date'
] as const;

const PAYMENT_WORDS: Record<string, string> = {
  COMPLETED: 'Completed',
  PENDING: 'Pending',
  IN_PROCESS: 'In Process',
  COMPLIMENTARY: 'Complimentary',
  CANCELLED: 'Cancel'
};

const STATUS_WORDS: Record<string, string> = {
  ACTIVE: 'Active 1',
  HOLD: 'Hold',
  CLOSED: 'Closed'
};

export function writeMasterView(db: BusinessDb, outPath: string): number {
  interface CycleRow {
    cycle_id: number; renewal_date: string; pack_amount: number; per_delivery_revenue: number;
    payment_status: string; payment_mode: string; collect: number; cycle_remarks: string;
    customer_id: string; name: string; email: string; phones: string; address: string;
    zone: string; remarks: string; extra_instruction: string;
    package_name: string; frequency: string; day: string; time_slot: string;
    sub_status: string; subscription_id: number;
  }
  const cycles = db.prepare(`
    SELECT cy.id AS cycle_id, cy.renewal_date, cy.pack_amount, cy.per_delivery_revenue,
           cy.payment_status, cy.payment_mode, cy.collect, cy.remarks AS cycle_remarks,
           c.id AS customer_id, c.name, c.email, c.phones, c.address, c.zone,
           c.remarks, c.extra_instruction,
           s.package_name, s.frequency, s.day, s.time_slot, s.status AS sub_status,
           s.id AS subscription_id
    FROM cycles cy
    JOIN subscriptions s ON cy.subscription_id = s.id
    JOIN customers c ON s.customer_id = c.id
    ORDER BY CAST(c.id AS INTEGER), c.id, cy.renewal_date, cy.id
  `).all() as CycleRow[];

  const latestCycle = new Map<number, number>();
  for (const cycle of cycles) {
    latestCycle.set(cycle.subscription_id, cycle.cycle_id);
  }

  const deliveriesFor = db.prepare(`
    SELECT seq, planned_date, changed_date FROM deliveries WHERE cycle_id = ? ORDER BY seq`);
  const restrictionsFor = db.prepare(`SELECT flower FROM restrictions WHERE customer_id = ?`);

  const grid: unknown[][] = [HEADERS as unknown as unknown[]];

  for (const cycle of cycles) {
    const isCurrent = latestCycle.get(cycle.subscription_id) === cycle.cycle_id;
    const active = isCurrent ? (STATUS_WORDS[cycle.sub_status] ?? cycle.sub_status) : 'Renewed';

    // 4 date-pair columns. Weekly: (planned, changed). Biweekly: consecutive
    // deliveries share a pair — the same encoding his Master uses.
    const deliveries = deliveriesFor.all(cycle.cycle_id) as Array<{ seq: number; planned_date: string; changed_date: string }>;
    const pairs = new Array<string>(8).fill('');
    if (cycle.frequency === 'BIWEEKLY') {
      deliveries.slice(0, 8).forEach((delivery, i) => {
        pairs[i] = delivery.changed_date || delivery.planned_date;
      });
    } else {
      deliveries.slice(0, 4).forEach((delivery, i) => {
        pairs[i * 2] = delivery.planned_date;
        pairs[i * 2 + 1] = delivery.changed_date;
      });
    }

    const restrictions = (restrictionsFor.all(cycle.customer_id) as Array<{ flower: string }>)
      .map(row => row.flower).join(' n ');

    grid.push([
      active, cycle.renewal_date, cycle.customer_id, cycle.name, cycle.email,
      cycle.phones.replace(/\/\//g, ' // '), cycle.address, cycle.zone,
      cycle.day, cycle.time_slot, cycle.pack_amount, cycle.per_delivery_revenue,
      cycle.package_name, cycle.payment_mode, PAYMENT_WORDS[cycle.payment_status] ?? cycle.payment_status,
      cycle.collect, cycle.remarks, restrictions, cycle.extra_instruction,
      ...pairs
    ]);
  }

  // One-time bouquets, his 'Bouquet' rows
  const bouquets = db.prepare(`
    SELECT id, date, customer_name, phone, address, zone, time_slot, amount, description, payment_status, remarks
    FROM one_time_orders ORDER BY date, id
  `).all() as Array<{
    id: string; date: string; customer_name: string; phone: string; address: string; zone: string;
    time_slot: string; amount: number; description: string; payment_status: string; remarks: string;
  }>;
  for (const order of bouquets) {
    grid.push([
      'Bouquet', order.date, order.id, order.customer_name, '', order.phone, order.address, order.zone,
      '', order.time_slot, order.amount, order.amount, order.description || 'Bouquet', '',
      PAYMENT_WORDS[order.payment_status] ?? order.payment_status, '', order.remarks, '', '',
      '', '', '', '', '', '', '', ''
    ]);
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(grid), 'MASTER');
  XLSX.writeFile(workbook, outPath);

  const rows = grid.length - 1;
  logger.info({ rows, outPath }, 'Master view exported');
  return rows;
}
