/**
 * Terminal chat simulator — rehearse the whole demo WITHOUT WhatsApp.
 * Type messages as the demo customer (or staff) and watch every reply and
 * staff alert the bot would send.
 *
 *   npx ts-node scripts/demo-chat.ts            # chat as customer #9999
 *   npx ts-node scripts/demo-chat.ts --staff    # chat as a staff number
 *
 * Uses ./data/demo.db (run scripts/demo-setup.ts first).
 */
import * as readline from 'readline';
import { openDb } from '../src/business/db';
import { BusinessMessageHandler } from '../src/business/businessHandler';
import { MessageSender } from '../src/bot/messageSender';

const asStaff = process.argv.includes('--staff');
const STAFF_NUMBER = '+919999999999';

const db = openDb(process.env.BUSINESS_DB || './data/demo.db');
const demo = db.prepare(`SELECT phones FROM customers WHERE id = '9999'`).get() as { phones: string } | undefined;
if (!demo) {
  console.error('No demo customer found — run: npx ts-node scripts/demo-setup.ts <phone>');
  process.exit(1);
}
const from = asStaff ? STAFF_NUMBER : `+${demo.phones.split('//')[0]}`;

const consoleSender: MessageSender = {
  async sendMessage(to, message) {
    const tag = to === from ? 'reply to you' : `→ ${to}`;
    console.log(`\n🤖 BOT (${tag}):\n${message.split('\n').map(line => '   ' + line).join('\n')}\n`);
    return true;
  },
  async sendMessageToMultiple(recipients, message) {
    for (const recipient of recipients) await this.sendMessage(recipient, message);
  },
  isConnected: () => true
};

const handler = new BusinessMessageHandler({
  db,
  sender: consoleSender,
  staff: [STAFF_NUMBER]
});

console.log(`💬 Chatting as ${asStaff ? `STAFF (${STAFF_NUMBER}) — try "help"` : `Demo Customer (${from}) — try "when is my next delivery?"`}`);
console.log('   (Ctrl+C to exit)\n');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'you> ' });
rl.prompt();
rl.on('line', async line => {
  const message = line.trim();
  if (message) await handler.handleMessage(from, message);
  rl.prompt();
});
rl.on('close', () => process.exit(0));
