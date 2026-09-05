import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { openDb, BusinessDb } from '../src/business/db';
import { importMaster } from '../src/business/importMaster';
import { importFeedback } from '../src/business/importFeedback';
import { dueRows, writeDelSheet, DEL_SHEET_HEADERS } from '../src/business/delSheet';

let dir: string;
let db: BusinessDb;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bmf-biz-'));
  db = openDb(':memory:');
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Excel serial for a YYYY-MM-DD date. */
function serial(date: string): number {
  return Math.round(new Date(`${date}T00:00:00Z`).getTime() / 86400000) + 25569;
}

/** Build a synthetic MASTER row (63 cols) with the real column layout. */
function masterRow(overrides: Record<number, unknown>): unknown[] {
  const row = new Array(63).fill('');
  for (const [col, value] of Object.entries(overrides)) row[Number(col)] = value;
  return row;
}

const MASTER_HEADERS = new Array(63).fill('').map((_, i) => `col${i}`);

function writeMaster(rows: unknown[][]): string {
  const file = path.join(dir, 'master.xlsx');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([MASTER_HEADERS, ...rows]), 'MASTER');
  XLSX.writeFile(workbook, file);
  return file;
}

// Column indexes mirroring importMaster's COL map
const C = {
  ACTIVE: 0, DATE: 1, ID: 6, NAME: 7, EMAIL: 8, PHONE: 9, ADDRESS: 10, ZONE: 11,
  DAY: 13, SLOT: 14, PACK: 15, REVENUE: 16, TYPE: 17, PAY_TYPE: 18, PAY_STATUS: 19,
  COLLECT: 20, PAY_DATE: 23, REMARKS: 25, RESTRICTION: 26, EXTRA: 27, DEL: 32
};

describe('importMaster', () => {
  it('imports a weekly subscriber with cycles, deliveries, and restrictions', () => {
    const file = writeMaster([
      // older, renewed cycle
      masterRow({
        [C.ACTIVE]: 'Renewed', [C.DATE]: serial('2026-05-01'), [C.ID]: '588',
        [C.NAME]: 'Akiksha Mohan', [C.PHONE]: '9810145564', [C.ZONE]: 'Badshahpur',
        [C.DAY]: 'Friday', [C.SLOT]: '9 AM - 12 PM', [C.PACK]: 1450, [C.REVENUE]: 362.5,
        [C.TYPE]: 'Bliss', [C.PAY_STATUS]: 'Completed', [C.RESTRICTION]: 'GULDAWARI',
        [C.DEL]: serial('2026-05-01'), [C.DEL + 2]: serial('2026-05-08'),
        [C.DEL + 4]: serial('2026-05-15'), [C.DEL + 6]: serial('2026-05-22')
      }),
      // current cycle with one rescheduled delivery
      masterRow({
        [C.ACTIVE]: 'Active 1', [C.DATE]: serial('2026-06-26'), [C.ID]: '588',
        [C.NAME]: 'Akiksha Mohan', [C.PHONE]: '9810145564', [C.ZONE]: 'Badshahpur',
        [C.DAY]: 'Friday', [C.SLOT]: '9 AM - 12 PM', [C.PACK]: 1450, [C.REVENUE]: 362.5,
        [C.TYPE]: 'Bliss', [C.PAY_STATUS]: 'Pending', [C.COLLECT]: 1450,
        [C.RESTRICTION]: 'GULDAWARI', [C.REMARKS]: 'Skip 1 week (20/06)',
        [C.DEL]: serial('2026-07-03'), [C.DEL + 1]: serial('2026-07-06'), // rescheduled
        [C.DEL + 2]: serial('2026-07-10'), [C.DEL + 4]: serial('2026-07-17'), [C.DEL + 6]: serial('2026-07-24')
      })
    ]);

    const report = importMaster(db, file, { asOf: '2026-07-06' });

    expect(report.customers).toBe(1);
    expect(report.cycles).toBe(2);
    expect(report.deliveries).toBe(8);
    expect(report.oneTimeOrders).toBe(0);

    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get('588') as Record<string, unknown>;
    expect(customer.name).toBe('Akiksha Mohan');
    expect(customer.zone).toBe('Badshahpur');

    const sub = db.prepare('SELECT * FROM subscriptions WHERE customer_id = ?').get('588') as Record<string, unknown>;
    expect(sub.frequency).toBe('WEEKLY');
    expect(sub.status).toBe('ACTIVE');

    // Rescheduled delivery keeps planned + changed
    const moved = db.prepare(`
      SELECT * FROM deliveries WHERE planned_date = '2026-07-03'`).get() as Record<string, unknown>;
    expect(moved.changed_date).toBe('2026-07-06');
    // Past deliveries marked DELIVERED, future PLANNED (asOf 2026-07-06)
    const future = db.prepare(`SELECT status FROM deliveries WHERE planned_date = '2026-07-17'`).get() as { status: string };
    expect(future.status).toBe('PLANNED');
    const past = db.prepare(`SELECT status FROM deliveries WHERE planned_date = '2026-05-01'`).get() as { status: string };
    expect(past.status).toBe('DELIVERED');
  });

  it('expands biweekly date-pairs into two deliveries each', () => {
    const file = writeMaster([
      masterRow({
        [C.ACTIVE]: 'Active 1', [C.DATE]: serial('2026-06-15'), [C.ID]: '1147',
        [C.NAME]: 'Reena', [C.PACK]: 1600, [C.REVENUE]: 200, [C.TYPE]: 'Bloom',
        [C.DAY]: 'Tuesday', [C.PAY_STATUS]: 'Completed',
        [C.DEL]: serial('2026-06-18'), [C.DEL + 1]: serial('2026-06-21'),
        [C.DEL + 2]: serial('2026-06-25'), [C.DEL + 3]: serial('2026-06-28')
      })
    ]);

    importMaster(db, file, { asOf: '2026-06-20' });

    const deliveries = db.prepare(`SELECT planned_date, seq, status FROM deliveries ORDER BY seq`).all() as
      Array<{ planned_date: string; seq: number; status: string }>;
    expect(deliveries.map(d => d.planned_date)).toEqual(['2026-06-18', '2026-06-21', '2026-06-25', '2026-06-28']);
    expect(deliveries[0].status).toBe('DELIVERED'); // before asOf
    expect(deliveries[1].status).toBe('PLANNED');
    const sub = db.prepare('SELECT frequency, day2 FROM subscriptions').get() as { frequency: string; day2: string };
    expect(sub.frequency).toBe('BIWEEKLY');
    expect(sub.day2).toBe('Sunday'); // read off the pair's second visit (2026-06-21), not guessed as +3
  });

  it('falls back to the second weekday named in the Day cell when biweekly pairs are empty', () => {
    const file = writeMaster([
      masterRow({
        [C.ACTIVE]: 'Active 1', [C.DATE]: serial('2026-06-15'), [C.ID]: '1148',
        [C.NAME]: 'Meera', [C.PACK]: 1600, [C.REVENUE]: 200, [C.TYPE]: 'Bloom',
        [C.DAY]: 'Thursday n Monday', [C.PAY_STATUS]: 'Completed'
      })
    ]);
    importMaster(db, file, { asOf: '2026-06-20' });
    const sub = db.prepare('SELECT day2 FROM subscriptions').get() as { day2: string };
    expect(sub.day2).toBe('Monday');
  });

  it('routes Bouquet rows to one_time_orders and skips junk rows', () => {
    const file = writeMaster([
      masterRow({
        [C.ACTIVE]: 'Bouquet', [C.DATE]: serial('2026-07-06'), [C.ID]: 'B56138',
        [C.NAME]: 'Walk-in', [C.PHONE]: '8860055496', [C.PACK]: 1350, [C.REVENUE]: 1350,
        [C.TYPE]: 'Bouquet', [C.PAY_STATUS]: 'Pending', [C.ZONE]: 'Spa'
      }),
      masterRow({ [C.ACTIVE]: '', [C.NAME]: 'Send Invoice' }),
      masterRow({ [C.ACTIVE]: 'Sample', [C.ID]: '' })
    ]);

    const report = importMaster(db, file, { asOf: '2026-07-06' });

    expect(report.oneTimeOrders).toBe(1);
    expect(report.skippedRows).toBe(2);
    const order = db.prepare('SELECT * FROM one_time_orders').get() as Record<string, unknown>;
    expect(order.id).toBe('B56138');
    expect(order.amount).toBe(1350);
    expect(order.date).toBe('2026-07-06');          // booking date, as the Master has it
    expect(order.delivery_date).toBe('2026-07-07'); // flowers go out the next day
  });

  it('uses an explicit delivery date on a Bouquet row when one is filled in', () => {
    const file = writeMaster([
      masterRow({
        [C.ACTIVE]: 'Bouquet', [C.DATE]: serial('2026-07-06'), [C.ID]: 'B56139',
        [C.NAME]: 'Walk-in', [C.PACK]: 1350, [C.REVENUE]: 1350, [C.TYPE]: 'Bouquet',
        [C.PAY_STATUS]: 'Pending', [C.DEL]: serial('2026-07-09')
      })
    ]);
    importMaster(db, file, { asOf: '2026-07-06' });
    const order = db.prepare('SELECT delivery_date FROM one_time_orders').get() as { delivery_date: string };
    expect(order.delivery_date).toBe('2026-07-09');
  });

  it('puts a Hold customer on HOLD so they are excluded from delivery sheets', () => {
    const file = writeMaster([
      masterRow({
        [C.ACTIVE]: 'Hold', [C.DATE]: serial('2026-06-01'), [C.ID]: '3249',
        [C.NAME]: 'Nupur', [C.PACK]: 1450, [C.REVENUE]: 362.5, [C.PAY_STATUS]: 'Pending',
        [C.DEL]: serial('2026-07-06')
      })
    ]);

    importMaster(db, file, { asOf: '2026-07-06' });
    const sub = db.prepare('SELECT status FROM subscriptions').get() as { status: string };
    expect(sub.status).toBe('HOLD');
    expect(dueRows(db, '2026-07-06')).toHaveLength(0);
  });
});

describe('feedback import + delivery sheet', () => {
  function seedSubscriber(id: string, deliveryDate: string) {
    const file = writeMaster([
      masterRow({
        [C.ACTIVE]: 'Active 1', [C.DATE]: serial('2026-06-26'), [C.ID]: id,
        [C.NAME]: 'Niti Beri', [C.PHONE]: '8130432211', [C.ZONE]: 'Old Gurgaon',
        [C.DAY]: 'Monday', [C.SLOT]: '9 AM - 12 PM', [C.PACK]: 1450, [C.REVENUE]: 362.5,
        [C.TYPE]: 'Bliss', [C.PAY_STATUS]: 'Pending', [C.COLLECT]: 1450,
        [C.RESTRICTION]: 'Gerbera', [C.DEL]: serial(deliveryDate)
      })
    ]);
    importMaster(db, file, { asOf: '2026-07-06' });
  }

  function writeFeedback(tabs: Record<string, unknown[][]>): string {
    const file = path.join(dir, 'feedback.xlsx');
    const workbook = XLSX.utils.book_new();
    for (const [name, grid] of Object.entries(tabs)) {
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(grid), name);
    }
    XLSX.writeFile(workbook, file);
    return file;
  }

  it('imports daily tabs into delivery_log and surfaces last-5 in the del sheet', () => {
    seedSubscriber('3353', '2026-07-06');
    const feedback = writeFeedback({
      '29-06-26': [
        ['ID', 'Name', 'Flower 1', 'Stick', 'Flower 2', 'Stick', 'Consumables', 'Delivered By', 'Feedback', 'Payment'],
        ['3353', 'Niti Beri', 'P n W Glad ( 14 Inch )', 16, '', '', 'Grass', 'Aniket', '', 0]
      ],
      '22-06-26': [
        ['ID', 'Name', 'Flower 1', 'Stick', 'Consumables', 'Delivered By', 'Feedback', 'Payment'],
        ['3353', 'Niti Beri', 'Rajni ( 14 Inch )', 16, 'Grass', 'Harish', 'Payment via Paytm', 1450]
      ],
      'Sheet2': [['not', 'a', 'date', 'tab']]
    });

    const report = importFeedback(db, feedback);
    expect(report.tabs).toBe(2);
    expect(report.rows).toBe(2);
    expect(report.tabsSkipped).toEqual(['Sheet2']);

    const rows = dueRows(db, '2026-07-06');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('3353');
    expect(rows[0].restriction).toBe('Gerbera');
    // last-5 ordered oldest → newest
    expect(rows[0].preFlowers).toEqual([
      'Rajni ( 14 Inch ) 16     Grass',
      'P n W Glad ( 14 Inch ) 16     Grass'
    ]);
    expect(rows[0].statusString).toContain('Pending - Collect 1450');
    expect(rows[0].collect).toBe(1450);
  });

  it('writes an xlsx with the owner’s exact 30 headers and Pre Flowers placement', () => {
    seedSubscriber('3353', '2026-07-06');
    const outPath = path.join(dir, 'del.xlsx');

    const count = writeDelSheet(db, '2026-07-06', outPath);
    expect(count).toBe(1);

    const grid = XLSX.utils.sheet_to_json<unknown[]>(XLSX.readFile(outPath).Sheets['Sheet1'], { header: 1, defval: '' });
    expect(grid[0]).toEqual([...DEL_SHEET_HEADERS]);
    const row = grid[1];
    expect(row[0]).toBe('3353');
    expect(row[11]).toBe('Gerbera');        // Flower Restriction
    expect(row[19]).toBe('');               // Flower 1 left for manual/Phase C assignment
  });

  it('includes one-time orders due that day', () => {
    const file = writeMaster([
      masterRow({
        [C.ACTIVE]: 'Bouquet', [C.DATE]: serial('2026-07-06'), [C.ID]: 'B56138',
        [C.NAME]: 'Walk-in', [C.PACK]: 1350, [C.REVENUE]: 1350, [C.TYPE]: 'Bouquet',
        [C.PAY_STATUS]: 'Pending', [C.ZONE]: 'Spa'
      })
    ]);
    importMaster(db, file, { asOf: '2026-07-06' });

    // Ordered on the 6th → on the 7th's sheet, not the 6th's
    expect(dueRows(db, '2026-07-06')).toHaveLength(0);
    const rows = dueRows(db, '2026-07-07');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('B56138');
    expect(rows[0].collect).toBe(1350);
  });

  it('still lists legacy one-time orders (no delivery_date) on their recorded date', () => {
    db.prepare(`INSERT INTO one_time_orders (id, customer_name, date, amount, payment_status)
                VALUES ('B77002', 'Legacy', '2026-07-06', 900, 'PENDING')`).run();
    expect(dueRows(db, '2026-07-06').map(r => r.id)).toEqual(['B77002']);
  });
});
