/**
 * Terminal chat simulator — rehearse the whole demo WITHOUT WhatsApp.
 * Type messages as the demo customer (or staff) and watch every reply and
 * staff alert the bot would send.
 *
 *   npx ts-node scripts/demo-chat.ts            # start as customer #9999
 *   npx ts-node scripts/demo-chat.ts --staff    # start as a staff number
 *
 * In-chat commands: /staff and /customer switch roles, exit (or quit) leaves.
 * Uses ./data/demo.db (run scripts/demo-setup.ts first).
 */

// Quiet the pino log stream before any module creates the logger
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';

/* eslint-disable @typescript-eslint/no-var-requires */
import * as readline from 'readline';
import type { MessageSender } from '../src/bot/messageSender';
const { openDb } = require('../src/business/db') as typeof import('../src/business/db');
const { BusinessMessageHandler } = require('../src/business/businessHandler') as typeof import('../src/business/businessHandler');

const STAFF_NUMBER = '+919999999999';

const db = openDb(process.env.BUSINESS_DB || './data/demo.db');
const demo = db.prepare(`SELECT phones FROM customers WHERE id = '9999'`).get() as { phones: string } | undefined;
if (!demo) {
  console.error('No demo customer found — run: npx ts-node scripts/demo-setup.ts <phone>');
  process.exit(1);
}
const customerNumber = `+${demo.phones.split('//')[0]}`;
let from = process.argv.includes('--staff') ? STAFF_NUMBER : customerNumber;

const consoleSender: MessageSender = {
  async sendMessage(to, message) {
    const tag = to === from ? 'reply to you' : `staff alert → ${to}`;
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

function announceRole() {
  console.log(from === STAFF_NUMBER
    ? `💬 You are STAFF (${STAFF_NUMBER}) — try "help", "due", "pending", "payrun"`
    : `💬 You are the Demo Customer (${from}) — try "when is my next delivery?"`);
  console.log('   /staff · /customer to switch roles — exit to leave\n');
}
announceRole();

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'you> ' });
rl.prompt();
// Serialize handling so piped input can't interleave or exit past pending replies
let queue: Promise<void> = Promise.resolve();
rl.on('line', line => {
  queue = queue.then(async () => {
    const message = line.trim();
    if (message === 'exit' || message === 'quit') {
      rl.close();
      return;
    }
    if (message === '/staff') {
      from = STAFF_NUMBER;
      announceRole();
    } else if (message === '/customer') {
      from = customerNumber;
      announceRole();
    } else if (message) {
      await handler.handleMessage(from, message);
    }
    rl.prompt();
  });
});
rl.on('close', () => {
  console.log('bye 🌸');
  process.exit(0);
});
