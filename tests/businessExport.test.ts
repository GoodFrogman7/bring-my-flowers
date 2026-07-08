import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { openDb, BusinessDb } from '../src/business/db';
import { writeMasterView } from '../src/business/exportMaster';
import { applyInstruction } from '../src/business/actions';

let db: BusinessDb;
let dir: string;

beforeEach(() => {
  db = openDb(':memory:');
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bmf-export-'));

  db.prepare(`INSERT INTO customers (id, name, phones, address, zone) VALUES ('100', 'Verify Me', '9876543210', 'H-1', 'Test Zone')`).run();
  db.prepare(`INSERT INTO subscriptions (id, customer_id, package_name, pack_amount, frequency, day, time_slot, status)
              VALUES (1, '100', 'Bliss', 1450, 'WEEKLY', 'Monday', '9 AM - 12 PM', 'ACTIVE')`).run();
  // Older renewed cycle + current cycle
  db.prepare(`INSERT INTO cycles (id, subscription_id, renewal_date, deliveries_planned, pack_amount, per_delivery_revenue, payment_status)
              VALUES (1, 1, '2026-06-01', 4, 1450, 362.5, 'COMPLETED')`).run();
  db.prepare(`INSERT INTO cycles (id, subscription_id, renewal_date, deliveries_planned, pack_amount, per_delivery_revenue, payment_status, collect)
              VALUES (2, 1, '2026-07-01', 4, 1450, 362.5, 'PENDING', 1450)`).run();
  db.prepare(`INSERT INTO deliveries (cycle_id, seq, planned_date, status) VALUES (2, 1, '2026-07-06', 'PLANNED')`).run();
  db.prepare(`INSERT INTO deliveries (cycle_id, seq, planned_date, status) VALUES (2, 2, '2026-07-13', 'PLANNED')`).run();
  db.prepare(`INSERT INTO one_time_orders (id, customer_name, phone, date, amount, payment_status)
              VALUES ('B77001', 'Walk-in', '9811111111', '2026-07-06', 1350, 'PENDING')`).run();
});

function exportGrid(): unknown[][] {
  const outPath = path.join(dir, 'master.xlsx');
  writeMasterView(db, outPath);
  return XLSX.utils.sheet_to_json<unknown[]>(XLSX.readFile(outPath).Sheets['MASTER'], { header: 1, defval: '' });
}

describe('writeMasterView', () => {
  it('marks the current cycle Active 1 and older cycles Renewed, in the owner’s vocabulary', () => {
    const grid = exportGrid();
    const rows = grid.slice(1).filter(row => row[2] === '100');
    expect(rows).toHaveLength(2);
    expect(rows[0][0]).toBe('Renewed');            // 2026-06-01 cycle
    expect(rows[1][0]).toBe('Active 1');           // current
    expect(rows[1][14]).toBe('Pending');           // payment status word
    expect(rows[1][15]).toBe(1450);                // Collect
    expect(rows[1][19]).toBe('2026-07-06');        // 1st del Date
  });

  it('includes bouquets as Bouquet rows', () => {
    const grid = exportGrid();
    const bouquet = grid.slice(1).find(row => row[2] === 'B77001')!;
    expect(bouquet[0]).toBe('Bouquet');
    expect(bouquet[10]).toBe(1350);
  });

  it('reflects a customer instruction in the next export — the pilot verification loop', () => {
    const customer = { id: '100', name: 'Verify Me', phones: '9876543210', address: 'H-1', zone: 'Test Zone' };
    applyInstruction(db, customer, { type: 'SKIP', weeks: 1 }, '2026-07-06');
    applyInstruction(db, customer, { type: 'RESTRICTION', flower: 'gerbera' }, '2026-07-06');

    const grid = exportGrid();
    const current = grid.slice(1).find(row => row[2] === '100' && row[0] === 'Active 1')!;
    expect(current[16]).toContain('Skip 1 week (06/07)');   // Remarks, his stamp format
    expect(current[16]).toContain('No gerbera (06/07)');
    expect(current[17]).toBe('gerbera');                    // Flower Restriction column
    expect(current[20]).toBe('2026-07-13');                 // 1st del Chngd date — the skip, visible
  });
});
