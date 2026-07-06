/**
 * Preview the daily payment/renewal messages (the run Pooja does by hand).
 *
 *   npx ts-node scripts/payment-run.ts [YYYY-MM-DD] [db-path]
 *
 * Defaults to yesterday (IST). Prints each customer's message; sending
 * happens through the bot ("payrun" staff command) once it's live on the
 * customer-care number.
 */
import { openDb } from '../src/business/db';
import { buildPaymentMessages, renewalsDue } from '../src/business/paymentRun';
import { todayIST, addDays } from '../src/business/dates';

const [dateArg, dbPath = './data/business.db'] = process.argv.slice(2);
const date = dateArg && /^\d{4}-\d{2}-\d{2}$/.test(dateArg) ? dateArg : addDays(todayIST(), -1);

const db = openDb(dbPath);
const messages = buildPaymentMessages(db, date);

console.log(`\n=== Payment messages for deliveries of ${date} (${messages.length}) ===\n`);
for (const msg of messages) {
  const flag = msg.kind === 'PAYMENT_DUE' ? '🔴' : msg.kind === 'CYCLE_COMPLETE' ? '🔁' : '🟢';
  console.log(`${flag} #${msg.customerId} ${msg.name} → ${msg.phone}`);
  console.log(`   ${msg.message}\n`);
}

const renewals = renewalsDue(db);
if (renewals.length > 0) {
  console.log(`=== ${renewals.length} renewals waiting (last 21 days) ===`);
  for (const renewal of renewals.slice(0, 30)) {
    console.log(`🔁 #${renewal.customerId} ${renewal.name} — ${renewal.packageName} ₹${renewal.packAmount} — last delivery ${renewal.lastDelivery} (${renewal.daysSince}d ago)`);
  }
}
