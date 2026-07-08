/**
 * Prepare a safe live-demo environment:
 *   1. Snapshots the real datastore to ./data/demo.db (demo messages can
 *      never touch the real import).
 *   2. Seeds a demo customer (#9999) bound to the phone number that will
 *      play "customer", with a live Bliss cycle, delivery history for the
 *      last-5 lookback, and a pending payment — so every flow demos well.
 *
 *   npx ts-node scripts/demo-setup.ts <customer-phone>
 *   BUSINESS_DB=./data/demo.db npm run dev:business
 */
import Database from 'better-sqlite3';
import { openDb } from '../src/business/db';
import { todayIST, addDays, weekdayOf } from '../src/business/dates';
import { DAY_LABELS } from '../src/utils/recurrence';

async function main() {
  const [rawPhone] = process.argv.slice(2);
  const phone = (rawPhone ?? '').replace(/\D/g, '');
  if (phone.length < 10) {
    console.error('Usage: npx ts-node scripts/demo-setup.ts <customer-phone>');
    console.error('       (the phone that will send messages AS a customer, e.g. 919876543210)');
    process.exit(1);
  }

  // Snapshot the real DB (checkpoint-safe via the backup API)
  const source = new Database('./data/business.db', { readonly: true });
  await source.backup('./data/demo.db');
  source.close();

  const db = openDb('./data/demo.db');
  const today = todayIST();

  // Wipe any earlier demo rows, then seed
  db.transaction(() => {
    db.prepare(`DELETE FROM deliveries WHERE cycle_id IN (SELECT id FROM cycles WHERE subscription_id IN (SELECT id FROM subscriptions WHERE customer_id = '9999'))`).run();
    db.prepare(`DELETE FROM cycles WHERE subscription_id IN (SELECT id FROM subscriptions WHERE customer_id = '9999')`).run();
    db.prepare(`DELETE FROM subscriptions WHERE customer_id = '9999'`).run();
    db.prepare(`DELETE FROM restrictions WHERE customer_id = '9999'`).run();
    db.prepare(`DELETE FROM delivery_log WHERE customer_id = '9999'`).run();
    db.prepare(`DELETE FROM customers WHERE id = '9999'`).run();

    db.prepare(`INSERT INTO customers (id, name, phones, address, zone) VALUES ('9999', 'Demo Customer', ?, 'D-101, Demo Towers, Sector 42', 'Golf Course Road')`).run(phone);
    const day = DAY_LABELS[weekdayOf(today)];
    db.prepare(`INSERT INTO subscriptions (customer_id, package_name, pack_amount, frequency, day, time_slot, status)
                VALUES ('9999', 'Bliss', 1450, 'WEEKLY', ?, '9 AM - 12 PM', 'ACTIVE')`).run(day);
    const subId = (db.prepare(`SELECT id FROM subscriptions WHERE customer_id = '9999'`).get() as { id: number }).id;
    db.prepare(`INSERT INTO cycles (subscription_id, renewal_date, deliveries_planned, pack_amount, per_delivery_revenue, payment_status, collect)
                VALUES (?, ?, 4, 1450, 362.5, 'PENDING', 1450)`).run(subId, addDays(today, -7));
    const cycleId = (db.prepare(`SELECT id FROM cycles WHERE subscription_id = ?`).get(subId) as { id: number }).id;

    // Delivery 1 already went last week; 2-4 upcoming, next one TODAY
    db.prepare(`INSERT INTO deliveries (cycle_id, seq, planned_date, status) VALUES (?, 1, ?, 'DELIVERED')`).run(cycleId, addDays(today, -7));
    for (let i = 2; i <= 4; i++) {
      db.prepare(`INSERT INTO deliveries (cycle_id, seq, planned_date, status) VALUES (?, ?, ?, 'PLANNED')`).run(cycleId, i, addDays(today, (i - 2) * 7));
    }

    // History so Pre-Flowers / no-repeat / alternation demo well
    const history: Array<[number, string]> = [
      [-28, 'Rajni ( 14 Inch ) 16     Grass'],
      [-21, 'Sunflower ( 12 Inch ) 3     Grass'],
      [-14, 'Carnation ( 14 Inch ) 16     FF Sachet + Grass'],
      [-7, 'O Asiatic ( 14 Inch ) 3     Grass']
    ];
    for (const [offset, flowers] of history) {
      db.prepare(`INSERT INTO delivery_log (customer_id, date, flowers, delivered_by, source) VALUES ('9999', ?, ?, 'Demo', 'demo-seed')`).run(addDays(today, offset), flowers);
    }
  })();

  console.log(`✅ Demo environment ready (./data/demo.db — the real DB is untouched)\n`);
  console.log(`Demo customer #9999 "Demo Customer" bound to ${phone}`);
  console.log(`  Bliss ₹1450 weekly, next delivery TODAY (${today}), payment PENDING ₹1450`);
  console.log(`  Last flowers: Rajni → Sunflower → Carnation → Asiatic (premium last → seasonal next)\n`);
  console.log(`Try texting the bot, from that phone:`);
  console.log(`  "when is my next delivery?"   → status with pending amount`);
  console.log(`  "skip this week"              → shifts remaining deliveries +7`);
  console.log(`  "no gerbera please"           → adds a restriction`);
  console.log(`  "paid via paytm"              → staff verify alert (not auto-marked)`);
  console.log(`  "renew"                       → creates the next cycle live`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
