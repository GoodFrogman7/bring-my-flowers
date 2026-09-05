import * as fs from 'fs';
import * as path from 'path';
import { openDb } from '../src/business/db';

const INCIDENT_DATE = '2026-07-14';
const BAD_SHEET = path.resolve('./data/del-sheet-2026-07-15.xlsx');
const BACKUP_DIR = path.resolve('./backups');

const BAD_ORDERS: Array<{ messageId: number; orderId: string }> = [
  { messageId: 5, orderId: 'GU-MRKU7ZBR-8WZ0' },
  { messageId: 6, orderId: 'GU-MRKU7ZBW-F40A' },
  { messageId: 9, orderId: 'GU-MRKU81FO-59IY' },
  { messageId: 20, orderId: 'GU-MRKU8CF0-4UMT' },
  { messageId: 22, orderId: 'GU-MRKU8D8X-I9EN' },
  { messageId: 23, orderId: 'GU-MRKU8D8X-C4DS' },
  { messageId: 24, orderId: 'GU-MRKU8D8X-RBG0' },
  { messageId: 28, orderId: 'GU-MRKU8GFJ-ZVF1' }
];

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function cleanResumeRemark(remarks: string): string {
  return remarks
    .replace(/\s*\/\/\s*Resumed \(14\/07\)/g, '')
    .replace(/^Resumed \(14\/07\)\s*\/\/\s*/g, '')
    .replace(/^Resumed \(14\/07\)$/g, '')
    .trim();
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const db = openDb('./data/business.db');

  const preview = {
    orders: BAD_ORDERS.map(({ messageId, orderId }) => ({
      messageId,
      order: db.prepare(`SELECT * FROM one_time_orders WHERE id = ?`).get(orderId)
    })).filter(entry => entry.order),
    asha: {
      customer: db.prepare(`SELECT id, remarks FROM customers WHERE id = '3293'`).get(),
      subscription: db.prepare(`SELECT id, status FROM subscriptions WHERE id = 1187`).get(),
      deliveries: db.prepare(`SELECT id, planned_date, changed_date FROM deliveries WHERE id IN (35794, 35795) ORDER BY id`).all()
    },
    maneesha: {
      customer: db.prepare(`SELECT id, remarks FROM customers WHERE id = '77'`).get(),
      subscription: db.prepare(`SELECT id, status FROM subscriptions WHERE id = 465`).get()
    }
  };

  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', preview }, null, 2));
  if (!apply) {
    db.close();
    return;
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = timestamp();
  const dbBackup = path.join(BACKUP_DIR, `business-pre-script-repair-${stamp}.db`);
  await db.backup(dbBackup);
  if (fs.existsSync(BAD_SHEET)) {
    fs.copyFileSync(BAD_SHEET, path.join(BACKUP_DIR, `del-sheet-2026-07-15-pre-script-repair-${stamp}.xlsx`));
  }

  const insertCorrection = db.prepare(`
    INSERT INTO group_corrections
      (message_id, correction_type, target_id, before_json, after_json, reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const repair = db.transaction(() => {
    for (const { messageId, orderId } of BAD_ORDERS) {
      const before = db.prepare(`SELECT * FROM one_time_orders WHERE id = ?`).get(orderId);
      if (!before) continue;
      db.prepare(`DELETE FROM one_time_orders WHERE id = ?`).run(orderId);
      insertCorrection.run(
        messageId,
        'DELETE_UNSAFE_ORDER',
        orderId,
        JSON.stringify(before),
        JSON.stringify(null),
        'Order was created from incomplete or misparsed Updates-group text',
        INCIDENT_DATE
      );
    }

    const ashaBefore = {
      customer: db.prepare(`SELECT id, remarks FROM customers WHERE id = '3293'`).get(),
      subscription: db.prepare(`SELECT id, status FROM subscriptions WHERE id = 1187`).get(),
      deliveries: db.prepare(`SELECT id, planned_date, changed_date FROM deliveries WHERE id IN (35794, 35795) ORDER BY id`).all()
    };
    const ashaRemarks = (ashaBefore.customer as { remarks: string }).remarks;
    db.prepare(`UPDATE subscriptions SET status = 'ACTIVE' WHERE id = 1187`).run();
    db.prepare(`UPDATE deliveries SET changed_date = '' WHERE id IN (35794, 35795)`).run();
    db.prepare(`UPDATE customers SET remarks = ? WHERE id = '3293'`).run(cleanResumeRemark(ashaRemarks));
    const ashaAfter = {
      customer: db.prepare(`SELECT id, remarks FROM customers WHERE id = '3293'`).get(),
      subscription: db.prepare(`SELECT id, status FROM subscriptions WHERE id = 1187`).get(),
      deliveries: db.prepare(`SELECT id, planned_date, changed_date FROM deliveries WHERE id IN (35794, 35795) ORDER BY id`).all()
    };
    if (JSON.stringify(ashaBefore) !== JSON.stringify(ashaAfter)) {
      insertCorrection.run(
        8,
        'REVERT_FALSE_RESUME',
        'customer:3293/subscription:1187',
        JSON.stringify(ashaBefore),
        JSON.stringify(ashaAfter),
        'Bouquet instruction was incorrectly interpreted as RESUME',
        INCIDENT_DATE
      );
    }

    const maneeshaBefore = {
      customer: db.prepare(`SELECT id, remarks FROM customers WHERE id = '77'`).get(),
      subscription: db.prepare(`SELECT id, status FROM subscriptions WHERE id = 465`).get()
    };
    const maneeshaRemarks = (maneeshaBefore.customer as { remarks: string }).remarks;
    db.prepare(`UPDATE subscriptions SET status = 'HOLD' WHERE id = 465`).run();
    db.prepare(`UPDATE customers SET remarks = ? WHERE id = '77'`).run(cleanResumeRemark(maneeshaRemarks));
    const maneeshaAfter = {
      customer: db.prepare(`SELECT id, remarks FROM customers WHERE id = '77'`).get(),
      subscription: db.prepare(`SELECT id, status FROM subscriptions WHERE id = 465`).get()
    };
    if (JSON.stringify(maneeshaBefore) !== JSON.stringify(maneeshaAfter)) {
      insertCorrection.run(
        18,
        'REVERT_FALSE_RESUME',
        'customer:77/subscription:465',
        JSON.stringify(maneeshaBefore),
        JSON.stringify(maneeshaAfter),
        'Urgent bouquet instruction was incorrectly interpreted as RESUME',
        INCIDENT_DATE
      );
    }
  });

  repair();

  const verification = {
    remainingBadOrders: db.prepare(`
      SELECT id FROM one_time_orders WHERE id IN (${BAD_ORDERS.map(() => '?').join(',')})
    `).all(...BAD_ORDERS.map(item => item.orderId)),
    asha: {
      customer: db.prepare(`SELECT id, remarks FROM customers WHERE id = '3293'`).get(),
      subscription: db.prepare(`SELECT id, status FROM subscriptions WHERE id = 1187`).get(),
      deliveries: db.prepare(`SELECT id, planned_date, changed_date FROM deliveries WHERE id IN (35794, 35795) ORDER BY id`).all()
    },
    maneesha: {
      customer: db.prepare(`SELECT id, remarks FROM customers WHERE id = '77'`).get(),
      subscription: db.prepare(`SELECT id, status FROM subscriptions WHERE id = 465`).get()
    },
    corrections: db.prepare(`SELECT COUNT(*) AS count FROM group_corrections`).get(),
    pendingMessages: db.prepare(`SELECT id, message_text FROM group_messages WHERE processed_at IS NULL ORDER BY id`).all()
  };

  console.log(JSON.stringify({ backup: dbBackup, verification }, null, 2));
  db.close();
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
