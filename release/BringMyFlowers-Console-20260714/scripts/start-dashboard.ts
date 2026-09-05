/**
 * Dev-only dashboard launcher. Production uses business mode (src/index.ts),
 * which starts the dashboard alongside the bot — do not run both on port 8787.
 */
import 'dotenv/config';
import { MessageSender } from '../src/bot/messageSender';
import { openDb } from '../src/business/db';
import { GroupAssistant } from '../src/business/groupAssistant';
import { startDashboard } from '../src/dashboard/dashboard';
import { OllamaClient } from '../src/llm/ollama';
import { createCloudProvider } from '../src/llm/provider';
import { loadConfig } from '../src/utils/config';

class StubSender implements MessageSender {
  async sendMessage(): Promise<boolean> { return true; }
  async sendMessageToMultiple(): Promise<void> {}
  isConnected(): boolean { return true; }
}

const port = parseInt(process.env.DASHBOARD_PORT || '8787', 10);
const dbPath = process.env.BUSINESS_DB || './data/business.db';
const config = loadConfig();
const db = openDb(dbPath);
const ollama = new OllamaClient(config.ollama.endpoint, config.ollama.model, config.ollama.timeout);
const cloudProvider = createCloudProvider();
const assistant = new GroupAssistant({
  db,
  sender: new StubSender(),
  groupJid: 'dashboard-local',
  ollama,
  provider: cloudProvider ?? undefined,
  delSheetDir: './data'
});

const server = startDashboard({
  db,
  answer: (question, today) => assistant.answer(question, today),
  port,
  delSheetDir: './data',
  qaMode: cloudProvider
    ? `Cloud AI (${cloudProvider.name}) with read-only tools`
    : 'Local read-only tools + Ollama fallback'
});

console.log(`Dashboard: http://localhost:${port}`);
console.log('Press Ctrl+C to stop.');

process.on('SIGINT', () => {
  server.close();
  db.close();
  process.exit(0);
});
