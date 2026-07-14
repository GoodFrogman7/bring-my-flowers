import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, BusinessDb } from '../src/business/db';
import { insertGroupMessage, processGroupMessages, formatGroupSummary } from '../src/business/groupUpdates';
import { dueRows } from '../src/business/delSheet';
import { GroupUpdatesScheduler } from '../src/scheduler/groupUpdates';
import { MessageSender } from '../src/bot/messageSender';

const TODAY = '2026-07-06'; // Monday
const TOMORROW = '2026-07-07';

let db: BusinessDb;

function seedCustomers() {
  db.prepare(`INSERT INTO customers (id, name, phones, address, zone) VALUES ('100', 'Neeraj Rathore', '9876543210', 'H-1, Test Society', 'Zone A')`).run();
  db.prepare(`INSERT INTO subscriptions (id, customer_id, package_name, pack_amount, frequency, day, status)
              VALUES (1, '100', 'Bliss', 1450, 'WEEKLY', 'Monday', 'ACTIVE')`).run();

  db.prepare(`INSERT INTO customers (id, name, phones, address, zone) VALUES ('101', 'Hardik Shah', '9123456780', 'H-2, Test Society', 'Zone B')`).run();
  db.prepare(`INSERT INTO subscriptions (id, customer_id, package_name, pack_amount, frequency, day, status)
              VALUES (2, '101', 'Joy', 2200, 'WEEKLY', 'Tuesday', 'ACTIVE')`).run();

  // Two customers sharing a name — forces an ambiguous match
  db.prepare(`INSERT INTO customers (id, name, phones, address, zone) VALUES ('102', 'Priya Singh', '9000000001', 'A-1', 'Zone A')`).run();
  db.prepare(`INSERT INTO customers (id, name, phones, address, zone) VALUES ('103', 'Priya Verma', '9000000002', 'A-2', 'Zone A')`).run();
}

beforeEach(() => {
  db = openDb(':memory:');
  seedCustomers();
});

describe('processGroupMessages', () => {
  it('creates a one-off order for a new-order message with a phone number', async () => {
    insertGroupMessage(db, '919999999999', 'Send tomorrow morning by 10 positively to Chandrima +919888877766, H-9 Sector 10', '2026-07-06T10:00:00.000Z');
    const result = await processGroupMessages(db, TODAY);

    expect(result.processed).toBe(1);
    expect(result.oneOffOrders).toBe(1);
    expect(result.escalated).toEqual([]);

    const order = db.prepare(`SELECT * FROM one_time_orders`).get() as { id: string; customer_name: string; phone: string; date: string };
    expect(order.id).toMatch(/^GU-/);
    expect(order.customer_name).toBe('Chandrima');
    expect(order.phone).toBe('9888877766');
    expect(order.date).toBe(TOMORROW);

    // Shows up on tomorrow's delivery sheet with zero delSheet.ts changes
    const rows = dueRows(db, TOMORROW);
    expect(rows.some(r => r.name === 'Chandrima')).toBe(true);
  });

  it('applies HOLD_INDEFINITE for an unambiguous named customer instruction', async () => {
    insertGroupMessage(db, '919999999999', 'Hold Neeraj Rathore is payment not received', '2026-07-06T10:00:00.000Z');
    const result = await processGroupMessages(db, TODAY);

    expect(result.customerUpdates).toBe(1);
    expect(result.escalated).toEqual([]);
    const status = (db.prepare(`SELECT status FROM subscriptions WHERE customer_id = '100'`).get() as { status: string }).status;
    expect(status).toBe('HOLD');

    const log = db.prepare(`SELECT * FROM group_update_log`).get() as { classification: string; matched_customer_id: string };
    expect(log.classification).toBe('CUSTOMER_UPDATE');
    expect(log.matched_customer_id).toBe('100');
  });

  it('appends a note without mutating schedule for non-action staff shorthand', async () => {
    insertGroupMessage(db, '919999999999', 'Hardik Shah- pls ensure collection, he always pays cash', '2026-07-06T10:00:00.000Z');
    const result = await processGroupMessages(db, TODAY);

    expect(result.notes).toBe(1);
    const status = (db.prepare(`SELECT status FROM subscriptions WHERE customer_id = '101'`).get() as { status: string }).status;
    expect(status).toBe('ACTIVE'); // untouched
    const remarks = (db.prepare(`SELECT remarks FROM customers WHERE id = '101'`).get() as { remarks: string }).remarks;
    expect(remarks).toContain('ensure collection');
  });

  it('escalates an ambiguous name match instead of guessing', async () => {
    insertGroupMessage(db, '919999999999', 'Hold Priya is out of town', '2026-07-06T10:00:00.000Z');
    const result = await processGroupMessages(db, TODAY);

    expect(result.escalated).toHaveLength(1);
    expect(result.escalated[0].reason).toMatch(/ambiguous/i);
    // Neither Priya's subscription was touched
    expect((db.prepare(`SELECT status FROM subscriptions WHERE customer_id IN ('102','103')`).all() as Array<{ status: string }>)
      .every(s => s.status === 'ACTIVE')).toBe(true);
  });

  it('escalates unclear messages with no name, phone, or action', async () => {
    insertGroupMessage(db, '919999999999', 'ok noted thanks', '2026-07-06T10:00:00.000Z');
    const result = await processGroupMessages(db, TODAY);
    expect(result.escalated).toHaveLength(1);
    expect(result.processed).toBe(1);
  });

  it('never reprocesses an already-processed message', async () => {
    insertGroupMessage(db, '919999999999', 'Hold Neeraj Rathore is payment not received', '2026-07-06T10:00:00.000Z');
    const first = await processGroupMessages(db, TODAY);
    expect(first.processed).toBe(1);

    const second = await processGroupMessages(db, TODAY);
    expect(second.processed).toBe(0);

    // Only one audit row and one HOLD application, not two
    const logCount = (db.prepare(`SELECT COUNT(*) AS n FROM group_update_log`).get() as { n: number }).n;
    expect(logCount).toBe(1);
  });
});

describe('GroupUpdatesScheduler.runOnce', () => {
  it('applies staged updates, posts summary + sheet to the group, and DMs the owner a copy', async () => {
    const sent: Array<{ to: string; message: string }> = [];
    const docs: Array<{ to: string; filePath: string }> = [];
    const sender: MessageSender = {
      async sendMessage(to, message) { sent.push({ to, message }); return true; },
      async sendMessageToMultiple() { /* not used */ },
      isConnected: () => true,
      async sendDocument(to, filePath) { docs.push({ to, filePath }); return true; }
    };
    insertGroupMessage(db, '919999999999', 'Hold Neeraj Rathore payment not received', '2026-07-06T10:00:00.000Z');

    const scheduler = new GroupUpdatesScheduler({
      db, sender, groupJid: 'g@g.us', ownerDm: ['+919717173327'],
      delSheetDir: './data', today: () => TODAY
    });
    await scheduler.runOnce();

    // The staged hold was applied before the sheet was generated
    const status = (db.prepare(`SELECT status FROM subscriptions WHERE customer_id = '100'`).get() as { status: string }).status;
    expect(status).toBe('HOLD');

    // Group gets the summary and the sheet file
    expect(sent.filter(m => m.to === 'g@g.us')).toHaveLength(1);
    expect(docs.filter(d => d.to === 'g@g.us')).toHaveLength(1);

    // The owner gets his own DM copy of both
    expect(sent.filter(m => m.to === '+919717173327')).toHaveLength(1);
    expect(docs.filter(d => d.to === '+919717173327')).toHaveLength(1);
    expect(docs[0].filePath).toContain(`del-sheet-${TOMORROW}.xlsx`);
  });
});

describe('formatGroupSummary', () => {
  it('reports nothing-to-do plainly', () => {
    expect(formatGroupSummary({ processed: 0, oneOffOrders: 0, customerUpdates: 0, notes: 0, escalated: [] }, TODAY))
      .toContain('no new messages');
  });

  it('lists escalated items for manual review', () => {
    const summary = formatGroupSummary(
      { processed: 2, oneOffOrders: 1, customerUpdates: 0, notes: 0, escalated: [{ text: 'unclear msg', reason: 'No name found' }] },
      TODAY
    );
    expect(summary).toContain('1 new order');
    expect(summary).toContain('unclear msg');
    expect(summary).toContain('No name found');
  });
});
