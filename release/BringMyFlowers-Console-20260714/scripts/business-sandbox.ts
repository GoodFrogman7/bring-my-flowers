import 'dotenv/config';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline/promises';
import { stdin, stdout } from 'process';
import { MessageSender } from '../src/bot/messageSender';
import { openDb } from '../src/business/db';
import { todayIST } from '../src/business/dates';
import { GroupAssistant } from '../src/business/groupAssistant';
import { formatGroupSummary, processGroupMessages } from '../src/business/groupUpdates';
import { OllamaClient } from '../src/llm/ollama';
import { createCloudProvider } from '../src/llm/provider';
import { startDashboard } from '../src/dashboard/dashboard';

const SMOKE = process.argv.includes('--smoke');
const SOURCE_DB = path.resolve(process.env.SANDBOX_SOURCE_DB ?? './data/business.db');
// The smoke test gets its own directory so it never fights an open
// interactive sandbox session over the SQLite file lock.
const SANDBOX_DIR = path.resolve(process.env.SANDBOX_DIR ?? (SMOKE ? './sandbox/smoke' : './sandbox'));
const SANDBOX_DB = path.join(SANDBOX_DIR, 'business-sandbox.db');
const OUTPUT_DIR = path.join(SANDBOX_DIR, 'output');
const DASHBOARD_PORT = parseInt(process.env.SANDBOX_DASHBOARD_PORT ?? '8788');

class ConsoleSender implements MessageSender {
  async sendMessage(_to: string, message: string): Promise<boolean> {
    console.log(`\nBOT:\n${message}\n`);
    return true;
  }

  async sendMessageToMultiple(_recipients: string[], message: string): Promise<void> {
    console.log(`\nBOT:\n${message}\n`);
  }

  async sendDocument(_to: string, filePath: string, caption?: string): Promise<boolean> {
    console.log(`\nBOT DOCUMENT:\n${caption ?? ''}\n${path.resolve(filePath)}\n`);
    return true;
  }

  isConnected(): boolean {
    return true;
  }
}

async function prepareSandbox(): Promise<void> {
  if (SOURCE_DB === SANDBOX_DB) throw new Error('Sandbox database must differ from production');
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  for (const suffix of ['', '-wal', '-shm']) {
    const candidate = `${SANDBOX_DB}${suffix}`;
    if (fs.existsSync(candidate)) fs.rmSync(candidate);
  }
  const source = new Database(SOURCE_DB, { readonly: true, fileMustExist: true });
  await source.backup(SANDBOX_DB);
  source.close();
}

function printHelp(): void {
  console.log(`
Commands:
  update <message>        Stage an Updates-group message (use \\n for line breaks)
  ask <question>          Ask the bot, equivalent to "Bot, <question>"
  raw <message>           Send exact group text to test routing
  process                 Run the conservative Updates parser now
  sheet [YYYY-MM-DD]      Process staged updates and generate a sandbox sheet
  dashboard               Open the owner dashboard on this sandbox copy
  status                  Show sandbox record counts
  help                    Show these commands
  exit                    Close the sandbox

Examples:
  update Hold Smita Mathur
  update Send today to Riya +919876543210\\nB-12 Sector 50\\n2 oriental lilies
  ask how many deliveries tomorrow?
  sheet 2026-07-15
`);
}

async function main(): Promise<void> {
  await prepareSandbox();
  const db = openDb(SANDBOX_DB);
  const sender = new ConsoleSender();
  const ollama = process.env.SANDBOX_USE_OLLAMA === '1'
    ? new OllamaClient(
      process.env.OLLAMA_ENDPOINT ?? 'http://localhost:11434',
      process.env.OLLAMA_MODEL ?? 'llama3.2:3b'
    )
    : undefined;
  const cloudProvider = createCloudProvider();
  const assistant = new GroupAssistant({
    db,
    sender,
    groupJid: 'sandbox-updates@g.us',
    ollama,
    provider: cloudProvider ?? undefined,
    delSheetDir: OUTPUT_DIR
  });

  if (process.argv.includes('--smoke')) {
    const before = (db.prepare(`SELECT COUNT(*) AS n FROM one_time_orders`).get() as { n: number }).n;
    await assistant.handle('sandbox-user', 'Send today to Riya +919876543210', {
      externalMessageId: 'sandbox-incomplete',
      receivedAt: new Date().toISOString()
    });
    const result = await processGroupMessages(db, todayIST(), ollama);
    const after = (db.prepare(`SELECT COUNT(*) AS n FROM one_time_orders`).get() as { n: number }).n;
    const sandboxClassification = db.prepare(`
      SELECT l.classification, l.escalated
      FROM group_update_log l
      JOIN group_messages m ON m.id = l.message_id
      WHERE m.external_message_id = 'sandbox-incomplete'
    `).get() as { classification: string; escalated: number } | undefined;
    if (
      result.escalated.length < 1 ||
      before !== after ||
      sandboxClassification?.classification !== 'UNCLEAR' ||
      sandboxClassification.escalated !== 1
    ) {
      throw new Error('Sandbox smoke test failed: incomplete order was not safely quarantined');
    }
    console.log(`SANDBOX PASS: production copied read-only; incomplete order quarantined; database ${SANDBOX_DB}`);
    db.close();
    return;
  }

  console.log(`\nSafe business sandbox ready.`);
  console.log(`Production is read-only. Test changes go to: ${SANDBOX_DB}`);
  console.log(`Answering: ${cloudProvider
    ? `cloud (${cloudProvider.name}) with read-only tools`
    : 'local read-only tools → Ollama → deterministic fallback (set LLM_PROVIDER for cloud AI)'}`);
  printHelp();

  const rl = readline.createInterface({ input: stdin, output: stdout });
  let dashboard: ReturnType<typeof startDashboard> | null = null;
  try {
    while (true) {
      const input = (await rl.question('sandbox> ')).trim();
      if (!input) continue;
      const [command, ...parts] = input.split(' ');
      const payload = parts.join(' ').replace(/\\n/g, '\n');

      if (command === 'exit' || command === 'quit') break;
      if (command === 'help') {
        printHelp();
      } else if (command === 'update') {
        await assistant.handle('sandbox-user', payload, {
          externalMessageId: `sandbox-${Date.now()}`,
          receivedAt: new Date().toISOString()
        });
        console.log('Staged silently, matching the real Updates group.');
      } else if (command === 'ask') {
        await assistant.handle('sandbox-user', `Bot, ${payload}`);
      } else if (command === 'raw') {
        await assistant.handle('sandbox-user', payload);
      } else if (command === 'process') {
        console.log(formatGroupSummary(await processGroupMessages(db, todayIST(), ollama), todayIST()));
      } else if (command === 'sheet') {
        const date = payload || todayIST();
        await assistant.handle('sandbox-user', `Bot, send sheet ${date}`);
      } else if (command === 'dashboard') {
        if (dashboard) {
          console.log(`Dashboard already running at http://localhost:${DASHBOARD_PORT}`);
        } else {
          dashboard = startDashboard({
            db,
            answer: (question, today) => assistant.answer(question, today),
            answerDetailed: (question, today) => assistant.answerDetailed(question, today),
            port: DASHBOARD_PORT,
            delSheetDir: OUTPUT_DIR,
            qaMode: cloudProvider
              ? `Cloud AI (${cloudProvider.name}) with read-only tools`
              : 'Local read-only tools + Ollama fallback'
          });
          console.log(`Dashboard on this sandbox copy: http://localhost:${DASHBOARD_PORT}`);
        }
      } else if (command === 'status') {
        const counts = {
          pendingUpdates: (db.prepare(`SELECT COUNT(*) AS n FROM group_messages WHERE processed_at IS NULL`).get() as { n: number }).n,
          reviewItems: (db.prepare(`SELECT COUNT(*) AS n FROM group_update_log WHERE escalated = 1`).get() as { n: number }).n,
          oneOffOrders: (db.prepare(`SELECT COUNT(*) AS n FROM one_time_orders`).get() as { n: number }).n,
          corrections: (db.prepare(`SELECT COUNT(*) AS n FROM group_corrections`).get() as { n: number }).n
        };
        console.log(counts);
      } else {
        console.log('Unknown command. Type "help".');
      }
    }
  } finally {
    rl.close();
    dashboard?.close();
    db.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
