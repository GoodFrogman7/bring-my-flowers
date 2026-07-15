import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import { openDb, BusinessDb } from '../src/business/db';
import {
  extractPhone,
  formatGroupSummary,
  insertGroupMessage,
  parseOneOffOrder,
  processGroupMessages
} from '../src/business/groupUpdates';
import { dueRows } from '../src/business/delSheet';
import { GroupUpdatesScheduler, ownerSheetDmEnabled, groupSheetSendEnabled } from '../src/scheduler/groupUpdates';
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
  it('parses a complete multiline order without crossing phone lines', () => {
    const text = `From Faisal Khan today
Immediately
To
Saif Khan, P-604, Emaar Enclave, Sector-66
Ph - 9892055569
10 mix oriental
15 shaded purple carnations
Gypso, limonium and greens
Bouquet in simple Korean wrap
Do not ask for payment`;
    const order = parseOneOffOrder(text, TODAY);

    expect(order.missing).toEqual([]);
    expect(order.phone).toBe('9892055569');
    expect(order.customerName).toBe('Saif Khan');
    expect(order.date).toBe(TODAY);
    expect(order.timeSlot).toBe('Immediately');
    expect(order.address).toContain('Emaar Enclave');
    expect(order.paymentStatus).toBe('COMPLIMENTARY');
  });

  it('never treats a WhatsApp mention ID as a phone', () => {
    expect(extractPhone('@161847957311493\nSend after 5')).toBeNull();
  });

  it('creates a one-off order for a new-order message with a phone number', async () => {
    insertGroupMessage(
      db,
      '919999999999',
      'Send tomorrow morning by 10 positively to Chandrima +919888877766\nH-9 Sector 10\n2 oriental lilies',
      '2026-07-06T10:00:00.000Z'
    );
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

  it('is idempotent when the same staged message is processed twice', async () => {
    insertGroupMessage(
      db,
      'staff',
      'Send today to Chandrima +919888877766\nH-9 Sector 10\n2 oriental lilies',
      '2026-07-06T10:00:00.000Z'
    );

    await processGroupMessages(db, TODAY);
    const second = await processGroupMessages(db, TODAY);

    expect(second.processed).toBe(0);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM one_time_orders`).get() as { n: number }).n).toBe(1);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM group_update_log`).get() as { n: number }).n).toBe(1);
  });

  it('rolls back a failed action and records it for review', async () => {
    db.exec(`
      CREATE TRIGGER reject_test_order
      BEFORE INSERT ON one_time_orders
      BEGIN
        SELECT RAISE(ABORT, 'simulated action failure');
      END;
    `);
    insertGroupMessage(
      db,
      'staff',
      'Send today to Chandrima +919888877766\nH-9 Sector 10\n2 oriental lilies',
      '2026-07-06T10:00:00.000Z'
    );

    const result = await processGroupMessages(db, TODAY);

    expect(result.escalated[0].reason).toMatch(/transaction failed/i);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM one_time_orders`).get() as { n: number }).n).toBe(0);
    expect((db.prepare(`SELECT processed_at FROM group_messages`).get() as { processed_at: string }).processed_at).toBe(TODAY);
    expect((db.prepare(`SELECT classification FROM group_update_log`).get() as { classification: string }).classification).toBe('UNCLEAR');
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

  it('does not resume subscriptions for bouquet instructions', async () => {
    db.prepare(`INSERT INTO customers (id, name, phones, address, zone) VALUES ('104', 'Asha Esther', '', 'A-1', 'Zone A')`).run();
    db.prepare(`INSERT INTO subscriptions (id, customer_id, package_name, pack_amount, frequency, day, status)
                VALUES (104, '104', 'Joy', 1950, 'WEEKLY', 'Monday', 'HOLD')`).run();
    insertGroupMessage(db, 'staff', 'Send some extra flowers to Asha Esther next', '2026-07-06T10:00:00.000Z');

    const result = await processGroupMessages(db, TODAY);

    expect(result.escalated).toHaveLength(1);
    expect(result.customerUpdates).toBe(0);
    expect((db.prepare(`SELECT status FROM subscriptions WHERE id = 104`).get() as { status: string }).status).toBe('HOLD');
  });

  it('quarantines subscription starts even when they contain a phone', async () => {
    insertGroupMessage(db, 'staff', 'Samia\nStart with Joy from Saturday\n+91 99100 22591', '2026-07-06T10:00:00.000Z');

    const result = await processGroupMessages(db, TODAY);

    expect(result.oneOffOrders).toBe(0);
    expect(result.escalated[0].reason).toMatch(/subscription/i);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM one_time_orders`).get() as { n: number }).n).toBe(0);
  });

  it('merges explicitly quoted pending messages once', async () => {
    insertGroupMessage(
      db,
      'staff',
      'From Srishti today\nNeed to send to\nNimisha\n+91 9829636216\nW2B 103 Wellington estate 2\n2 pink oriental lilies\nAmount 700',
      '2026-07-06T10:00:00.000Z',
      { externalMessageId: 'parent' }
    );
    insertGroupMessage(
      db,
      'staff',
      'Before 2:30',
      '2026-07-06T10:00:10.000Z',
      { externalMessageId: 'child', replyToExternalId: 'parent' }
    );

    const result = await processGroupMessages(db, TODAY);
    const order = db.prepare(`SELECT * FROM one_time_orders`).get() as { time_slot: string; amount: number };

    expect(result.processed).toBe(2);
    expect(result.oneOffOrders).toBe(1);
    expect(order.time_slot).toBe('Before 2:30');
    expect(order.amount).toBe(700);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM group_update_log`).get() as { n: number }).n).toBe(2);
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
  it('defaults: group sheet on, owner DM off', () => {
    const env = { ...process.env };
    delete env.OWNER_SHEET_DM;
    delete env.GROUP_SHEET_SEND;
    expect(ownerSheetDmEnabled(env)).toBe(false);
    expect(groupSheetSendEnabled(env)).toBe(true);
  });

  it('posts sheet to the Updates group by default but never DMs the owner', async () => {
    const prevDm = process.env.OWNER_SHEET_DM;
    const prevGroup = process.env.GROUP_SHEET_SEND;
    const prevSummary = process.env.GROUP_NIGHTLY_SUMMARY;
    delete process.env.OWNER_SHEET_DM;
    delete process.env.GROUP_SHEET_SEND;
    delete process.env.GROUP_NIGHTLY_SUMMARY;

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

    const status = (db.prepare(`SELECT status FROM subscriptions WHERE customer_id = '100'`).get() as { status: string }).status;
    expect(status).toBe('HOLD');

    expect(sent).toHaveLength(0);
    expect(docs.filter(d => d.to === 'g@g.us')).toHaveLength(1);
    expect(docs.filter(d => d.to === '+919717173327')).toHaveLength(0);
    expect(fs.existsSync(`./data/del-sheet-${TOMORROW}.xlsx`)).toBe(true);

    if (prevDm === undefined) delete process.env.OWNER_SHEET_DM; else process.env.OWNER_SHEET_DM = prevDm;
    if (prevGroup === undefined) delete process.env.GROUP_SHEET_SEND; else process.env.GROUP_SHEET_SEND = prevGroup;
    if (prevSummary === undefined) delete process.env.GROUP_NIGHTLY_SUMMARY; else process.env.GROUP_NIGHTLY_SUMMARY = prevSummary;
  });

  it('skips the group sheet when GROUP_SHEET_SEND=0', async () => {
    const prevGroup = process.env.GROUP_SHEET_SEND;
    process.env.GROUP_SHEET_SEND = '0';
    const docs: Array<{ to: string; filePath: string }> = [];
    const sender: MessageSender = {
      async sendMessage() { return true; },
      async sendMessageToMultiple() { /* not used */ },
      isConnected: () => true,
      async sendDocument(to, filePath) { docs.push({ to, filePath }); return true; }
    };

    const scheduler = new GroupUpdatesScheduler({
      db, sender, groupJid: 'g@g.us', delSheetDir: './data', today: () => TODAY
    });
    await scheduler.runOnce();

    expect(docs).toHaveLength(0);

    if (prevGroup === undefined) delete process.env.GROUP_SHEET_SEND; else process.env.GROUP_SHEET_SEND = prevGroup;
  });

  it('can still DM the sheet when OWNER_SHEET_DM=1 and GROUP_SHEET_SEND=1', async () => {
    const prevDm = process.env.OWNER_SHEET_DM;
    const prevGroup = process.env.GROUP_SHEET_SEND;
    process.env.OWNER_SHEET_DM = '1';
    process.env.GROUP_SHEET_SEND = '1';
    const docs: Array<{ to: string; filePath: string }> = [];
    const sender: MessageSender = {
      async sendMessage() { return true; },
      async sendMessageToMultiple() { /* not used */ },
      isConnected: () => true,
      async sendDocument(to, filePath) { docs.push({ to, filePath }); return true; }
    };

    const scheduler = new GroupUpdatesScheduler({
      db, sender, groupJid: 'g@g.us', ownerDm: ['+919717173327'],
      delSheetDir: './data', today: () => TODAY
    });
    await scheduler.runOnce();

    expect(docs.filter(d => d.to === 'g@g.us')).toHaveLength(1);
    expect(docs.filter(d => d.to === '+919717173327')).toHaveLength(1);

    if (prevDm === undefined) delete process.env.OWNER_SHEET_DM; else process.env.OWNER_SHEET_DM = prevDm;
    if (prevGroup === undefined) delete process.env.GROUP_SHEET_SEND; else process.env.GROUP_SHEET_SEND = prevGroup;
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
