import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { openDb, BusinessDb } from '../src/business/db';
import { routeGroupMessage, fallbackAnswer, buildBusinessSnapshot, GroupAssistant } from '../src/business/groupAssistant';
import { MessageSender } from '../src/bot/messageSender';

const TODAY = '2026-07-06'; // Monday
const TOMORROW = '2026-07-07';

let db: BusinessDb;

function seed() {
  db.prepare(`INSERT INTO customers (id, name, phones, address, zone) VALUES ('100', 'Neeraj Rathore', '9876543210', 'H-1, Test Society', 'Zone A')`).run();
  db.prepare(`INSERT INTO subscriptions (id, customer_id, package_name, pack_amount, frequency, day, status)
              VALUES (1, '100', 'Bliss', 1450, 'WEEKLY', 'Monday', 'ACTIVE')`).run();
  db.prepare(`INSERT INTO cycles (id, subscription_id, pack_amount, payment_status, collect)
              VALUES (1, 1, 1450, 'PENDING', 1450)`).run();
  db.prepare(`INSERT INTO deliveries (cycle_id, seq, planned_date, status) VALUES (1, 1, ?, 'PLANNED')`).run(TODAY);
  db.prepare(`INSERT INTO deliveries (cycle_id, seq, planned_date, status) VALUES (1, 2, ?, 'PLANNED')`).run(TOMORROW);
}

let sheetDir: string;

beforeEach(() => {
  db = openDb(':memory:');
  seed();
  sheetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bmf-assistant-'));
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(sheetDir, { recursive: true, force: true });
});

describe('routeGroupMessage', () => {
  it('routes staff shorthand with a phone number to UPDATE (new order)', () => {
    expect(routeGroupMessage('Send one basket of 1500 to Scottish school tomorrow by 9am +919812345678', TODAY))
      .toEqual({ kind: 'UPDATE' });
  });

  it('routes verb-first shorthand to UPDATE even with a question mark', () => {
    expect(routeGroupMessage('Hold Neeraj Rathore?', TODAY)).toEqual({ kind: 'UPDATE' });
    expect(routeGroupMessage('Hold swapnil', TODAY)).toEqual({ kind: 'UPDATE' });
  });

  it('routes name-first notes to UPDATE', () => {
    expect(routeGroupMessage('Divya Sabharwal \nSend replacement tomorrow', TODAY)).toEqual({ kind: 'UPDATE' });
    expect(routeGroupMessage('Pink lilies', TODAY)).toEqual({ kind: 'UPDATE' });
  });

  it('routes explicitly invoked questions to QUESTION', () => {
    expect(routeGroupMessage('Bot, how many deliveries going out today?', TODAY)).toEqual({ kind: 'QUESTION' });
    expect(routeGroupMessage('Flower Bot: kitne orders hai kal', TODAY)).toEqual({ kind: 'QUESTION' });
    expect(routeGroupMessage('BMF what does the stock look like', TODAY)).toEqual({ kind: 'QUESTION' });
    expect(routeGroupMessage('@bot any pending payments in Zone A?', TODAY)).toEqual({ kind: 'QUESTION' });
  });

  it('stages ordinary group questions when the bot was not invoked', () => {
    expect(routeGroupMessage('How many deliveries going out today?', TODAY)).toEqual({ kind: 'UPDATE' });
    expect(routeGroupMessage('any pending payments in Zone A?', TODAY)).toEqual({ kind: 'UPDATE' });
  });

  it('routes sheet asks to SHEET_REQUEST, defaulting to tomorrow', () => {
    expect(routeGroupMessage('Bot send sheet', TODAY)).toEqual({ kind: 'SHEET_REQUEST', date: TOMORROW });
    expect(routeGroupMessage('Flower Bot, pls share the delivery sheet', TODAY)).toEqual({ kind: 'SHEET_REQUEST', date: TOMORROW });
    expect(routeGroupMessage('BMF: sheet', TODAY)).toEqual({ kind: 'SHEET_REQUEST', date: TOMORROW });
  });

  it('honours an explicit date or "today" in a sheet ask', () => {
    expect(routeGroupMessage('Bot need sheet for today', TODAY)).toEqual({ kind: 'SHEET_REQUEST', date: TODAY });
    expect(routeGroupMessage('Bot send sheet 2026-07-10', TODAY)).toEqual({ kind: 'SHEET_REQUEST', date: '2026-07-10' });
  });

  it('does not treat a sheet mention inside an update as a sheet request', () => {
    expect(routeGroupMessage('Hold Neeraj Rathore, sheet already updated by Puja', TODAY)).toEqual({ kind: 'UPDATE' });
  });
});

describe('fallbackAnswer (no LLM)', () => {
  it('answers delivery-count questions with real counts', () => {
    const answer = fallbackAnswer(db, 'how many deliveries going out today?', TODAY);
    expect(answer).toContain('1 deliveries due 2026-07-06');
    expect(answer).toContain('Zone A: 1');
  });

  it('answers pending-payment questions with the pending total', () => {
    const answer = fallbackAnswer(db, 'any pending payments?', TODAY);
    expect(answer).toContain('₹1450');
  });

  it('answers a named-customer question with that profile, not generic counts', () => {
    const answer = fallbackAnswer(db, 'when is Neeraj getting his delivery?', TODAY);
    expect(answer).toContain('#100 Neeraj Rathore');
    expect(answer).toContain(`next delivery: ${TODAY}`);
    expect(answer).not.toContain('deliveries due');
  });
});

describe('buildBusinessSnapshot', () => {
  it('includes deliveries, pending total and a profile for a named customer', () => {
    const snapshot = buildBusinessSnapshot(db, 'when is Neeraj getting his next delivery?', TODAY);
    expect(snapshot).toContain('DELIVERIES TODAY (2026-07-06): 1 total');
    expect(snapshot).toContain('PENDING COLLECTIONS: ₹1450');
    expect(snapshot).toContain('CUSTOMER #100 Neeraj Rathore');
    expect(snapshot).toContain(`next delivery: ${TODAY}`);
  });
});

describe('GroupAssistant.handle', () => {
  function fakeSender(sent: Array<{ to: string; message: string }>, docs: Array<{ to: string; filePath: string }>): MessageSender {
    return {
      async sendMessage(to, message) { sent.push({ to, message }); return true; },
      async sendMessageToMultiple() { /* not used */ },
      isConnected: () => true,
      async sendDocument(to, filePath) { docs.push({ to, filePath }); return true; }
    };
  }

  it('stages updates silently and answers questions in the group (legacy, GROUP_SILENT=0)', async () => {
    vi.stubEnv('GROUP_SILENT', '0');
    const sent: Array<{ to: string; message: string }> = [];
    const assistant = new GroupAssistant({
      db, sender: fakeSender(sent, []), groupJid: 'g@g.us', today: () => TODAY
    });

    await assistant.handle('919999999999', 'Hold Neeraj Rathore is payment not received');
    expect(sent).toHaveLength(0);
    expect((db.prepare(`SELECT COUNT(*) n FROM group_messages`).get() as { n: number }).n).toBe(1);

    await assistant.handle('919999999999', 'how many deliveries today?');
    expect(sent).toHaveLength(0);
    expect((db.prepare(`SELECT COUNT(*) n FROM group_messages`).get() as { n: number }).n).toBe(2);

    await assistant.handle('919999999999', 'Bot, how many deliveries today?');
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('g@g.us');
    expect(sent[0].message).toContain('1 deliveries due');
    // Questions are answered, not staged
    expect((db.prepare(`SELECT COUNT(*) n FROM group_messages`).get() as { n: number }).n).toBe(2);
  });

  it('preserves WhatsApp message IDs, timestamps and quoted-message references', async () => {
    const assistant = new GroupAssistant({
      db, sender: fakeSender([], []), groupJid: 'g@g.us', today: () => TODAY
    });

    await assistant.handle('919999999999', 'Before 2:30', {
      receivedAt: '2026-07-06T10:00:10.000Z',
      externalMessageId: 'child-message',
      replyToExternalId: 'parent-message'
    });

    const stored = db.prepare(`
      SELECT received_at, external_message_id, reply_to_external_id FROM group_messages
    `).get() as { received_at: string; external_message_id: string; reply_to_external_id: string };
    expect(stored).toEqual({
      received_at: '2026-07-06T10:00:10.000Z',
      external_message_id: 'child-message',
      reply_to_external_id: 'parent-message'
    });
  });

  it('never posts in the group when silent (default): questions, sheet requests and updates', async () => {
    const sent: Array<{ to: string; message: string }> = [];
    const docs: Array<{ to: string; filePath: string }> = [];
    const assistant = new GroupAssistant({
      db, sender: fakeSender(sent, docs), groupJid: 'g@g.us',
      delSheetDir: sheetDir, today: () => TODAY
    });

    await assistant.handle('919999999999', 'Hold Neeraj Rathore is payment not received');
    await assistant.handle('919999999999', 'Bot, how many deliveries today?');
    await assistant.handle('919999999999', 'Bot, send sheet for today');

    expect(sent).toHaveLength(0);
    expect(docs).toHaveLength(0);
    expect(fs.readdirSync(sheetDir)).toHaveLength(0);

    // Every message is kept; only the operational update awaits the nightly run.
    const rows = db.prepare(`SELECT message_text, processed_at FROM group_messages ORDER BY id`).all() as
      Array<{ message_text: string; processed_at: string | null }>;
    expect(rows.map(row => row.message_text)).toEqual([
      'Hold Neeraj Rathore is payment not received',
      'Bot, how many deliveries today?',
      'Bot, send sheet for today'
    ]);
    expect(rows.map(row => row.processed_at === null)).toEqual([true, false, false]);
    // The sheet request did not apply the staged hold.
    const status = (db.prepare(`SELECT status FROM subscriptions WHERE customer_id = '100'`).get() as { status: string }).status;
    expect(status).toBe('ACTIVE');
  });

  it('processes staged updates then sends the sheet as a document (legacy, GROUP_SILENT=0)', async () => {
    vi.stubEnv('GROUP_SILENT', '0');
    const sent: Array<{ to: string; message: string }> = [];
    const docs: Array<{ to: string; filePath: string }> = [];
    const assistant = new GroupAssistant({
      db, sender: fakeSender(sent, docs), groupJid: 'g@g.us',
      delSheetDir: sheetDir, today: () => TODAY
    });

    await assistant.handle('919999999999', 'Hold Neeraj Rathore is payment not received');
    await assistant.handle('919999999999', 'Bot, send sheet for today');

    // The staged hold was applied before the sheet was generated
    const status = (db.prepare(`SELECT status FROM subscriptions WHERE customer_id = '100'`).get() as { status: string }).status;
    expect(status).toBe('HOLD');
    // A processing summary was posted, and the sheet went out as a file
    expect(sent.some(m => m.message.includes('Updates processed'))).toBe(true);
    expect(docs).toHaveLength(1);
    expect(docs[0].filePath).toContain(`del-sheet-${TODAY}.xlsx`);
  });
});
