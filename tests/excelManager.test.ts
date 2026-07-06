import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { ExcelManager } from '../src/data/excelManager';
import { order, recurring } from './helpers';

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bmf-excel-'));
  file = path.join(dir, 'business_data.xlsx');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function manager(): ExcelManager {
  return new ExcelManager(file, dir, false);
}

describe('orders round-trip', () => {
  it('adds and looks up orders by id and by date', async () => {
    const mgr = manager();
    await mgr.addOrder(order({ order_id: 'ORD-1', date: '2026-07-06' }));
    await mgr.addOrder(order({ order_id: 'ORD-2', date: '2026-07-07', customer_phone: '+922' }));

    expect((await mgr.getOrderById('ORD-1'))?.date).toBe('2026-07-06');
    expect(await mgr.getOrderById('ORD-MISSING')).toBeNull();

    const july6 = await mgr.getOrdersByDate('2026-07-06');
    expect(july6).toHaveLength(1);
    expect(july6[0].order_id).toBe('ORD-1');
  });

  it('persists the OUT_FOR_DELIVERY status', async () => {
    const mgr = manager();
    await mgr.addOrder(order({ order_id: 'ORD-1' }));
    await mgr.updateOrderStatus('ORD-1', 'OUT_FOR_DELIVERY');

    expect((await mgr.getOrderById('ORD-1'))?.status).toBe('OUT_FOR_DELIVERY');
  });
});

describe('recurring orders round-trip', () => {
  it('adds, reads, filters by customer, and updates subscriptions', async () => {
    const mgr = manager();
    await mgr.addRecurringOrder(recurring({ recurring_id: 'REC-1', customer_phone: '+919876543210' }));
    await mgr.addRecurringOrder(recurring({ recurring_id: 'REC-2', customer_phone: '+922000000' }));

    const all = await mgr.getAllRecurringOrders();
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({
      recurring_id: 'REC-1',
      frequency: 'WEEKLY',
      day: 1,
      quantity: 10,
      status: 'ACTIVE'
    });

    // Baileys-style number (no +) must still match
    const mine = await mgr.getRecurringOrdersByCustomerPhone('919876543210');
    expect(mine).toHaveLength(1);
    expect(mine[0].recurring_id).toBe('REC-1');

    await mgr.updateRecurringOrder('REC-1', { status: 'PAUSED', next_date: '2026-08-01' });
    const updated = (await mgr.getAllRecurringOrders()).find(r => r.recurring_id === 'REC-1');
    expect(updated).toMatchObject({ status: 'PAUSED', next_date: '2026-08-01' });

    // REC-2 untouched
    const other = (await mgr.getAllRecurringOrders()).find(r => r.recurring_id === 'REC-2');
    expect(other?.status).toBe('ACTIVE');
  });

  it('upgrades a pre-Phase-4 workbook that has no Recurring_Orders sheet', async () => {
    // Simulate a legacy file: Orders/Inventory sheets only
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([['order_id', 'customer_name', 'customer_phone', 'date', 'status', 'items', 'quantity', 'amount']]),
      'Orders'
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([['item_name', 'quantity', 'unit_price', 'cost_price', 'last_updated']]),
      'Inventory'
    );
    XLSX.writeFile(workbook, file);

    const mgr = manager();
    expect(await mgr.getAllRecurringOrders()).toEqual([]);

    await mgr.addRecurringOrder(recurring({ recurring_id: 'REC-NEW' }));
    const all = await mgr.getAllRecurringOrders();
    expect(all).toHaveLength(1);
    expect(all[0].recurring_id).toBe('REC-NEW');
  });
});
