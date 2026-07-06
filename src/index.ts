import { google } from 'googleapis';
import { WhatsAppBot } from './bot/whatsapp';
import { TwilioWhatsAppBot } from './bot/twilioWhatsApp';
import { MessageSender } from './bot/messageSender';
import { OllamaClient } from './llm/ollama';
import { ExcelManager } from './data/excelManager';
import { GoogleSheetsManager } from './data/googleSheetsManager';
import { DataStore } from './data/dataStore';
import { DeliveryNotifier } from './notifications/deliveryNotifier';
import { MessageHandler } from './handlers/messageHandler';
import { OwnerCommandHandler } from './handlers/ownerCommands';
import { DirectOrderFulfillment, PaymentLinkFulfillment, OrderFulfillment } from './handlers/orderFulfillment';
import { DailySummaryGenerator } from './summary/dailySummary';
import { DailyOpsScheduler } from './scheduler/dailyOps';
import { RazorpayClient } from './payment/razorpayClient';
import { VoiceTranscriber } from './voice/transcriber';
import { CalendarManager } from './calendar/calendarManager';
import { InventoryMonitor } from './inventory/inventoryMonitor';
import { createServer, VoiceComponents, PaymentComponents } from './server';
import { openDb } from './business/db';
import { BusinessMessageHandler } from './business/businessHandler';
import { loadConfig, ensureDirectories } from './utils/config';
import logger from './utils/logger';

/**
 * Single entry point for all three deployment modes:
 *
 *   baileys   — WhatsApp Web (QR login), Excel storage, orders confirmed
 *               directly with no payment step. No webhook server.
 *   twilio    — Twilio WhatsApp API + webhook server, Excel storage, direct
 *               order confirmation.
 *   enhanced  — Twilio + Google Sheets + Razorpay payment links + voice-call
 *               ordering + Google Calendar + inventory monitoring.
 *
 * Every mode gets the owner command channel, recurring-order materialization,
 * and morning delivery reminders.
 *
 * Mode is chosen by CLI argument (`node dist/index.js enhanced`) or the
 * BOT_MODE environment variable; default is baileys.
 */
export type BotMode = 'baileys' | 'twilio' | 'enhanced' | 'business';

const MODES: BotMode[] = ['baileys', 'twilio', 'enhanced', 'business'];

function resolveMode(): BotMode {
  const raw = (process.argv[2]?.replace(/^--mode=/, '') || process.env.BOT_MODE || 'baileys').toLowerCase();
  if (!MODES.includes(raw as BotMode)) {
    console.error(`❌ Unknown mode "${raw}". Use one of: ${MODES.join(', ')}\n`);
    console.error('  baileys   — WhatsApp Web (QR code), Excel storage, no payment step');
    console.error('  twilio    — Twilio WhatsApp API, Excel storage, no payment step');
    console.error('  enhanced  — Twilio + Google Sheets + Razorpay + voice + calendar');
    console.error('  business  — the real subscription operation (SQLite datastore,');
    console.error('              instruction intake, payment runs; docs/BUSINESS.md)\n');
    console.error('Examples: npm start                (baileys)');
    console.error('          npm run start:business   (node dist/index.js business)');
    process.exit(1);
  }
  return raw as BotMode;
}

/** Exit with a clear message listing every missing environment variable. */
function requireEnv(mode: BotMode, names: string[]): string[] {
  const missing = names.filter(name => !process.env[name]);
  if (missing.length > 0) {
    logger.error({ mode, missing }, 'Missing required environment variables');
    console.error(`\n❌ Mode "${mode}" requires these variables in .env:\n`);
    for (const name of missing) console.error(`   ${name}`);
    console.error('\nSee .env.example for details.\n');
    process.exit(1);
  }
  return names.map(name => process.env[name]!);
}

/**
 * The business mode runs the real subscription operation: the customer-care
 * WhatsApp number (Baileys QR by default, Twilio via BUSINESS_TRANSPORT=twilio)
 * wired to the SQLite datastore — instruction intake for customers, ops
 * commands for staff. The generic bot's Excel/Sheets stack stays untouched.
 */
async function startBusinessMode(config: ReturnType<typeof loadConfig>, ollamaClient: OllamaClient): Promise<void> {
  const dbPath = process.env.BUSINESS_DB || './data/business.db';
  const db = openDb(dbPath);

  const counts = db.prepare(`
    SELECT (SELECT COUNT(*) FROM customers) AS customers,
           (SELECT COUNT(*) FROM subscriptions WHERE status = 'ACTIVE') AS active`).get() as { customers: number; active: number };
  if (counts.customers === 0) {
    logger.error(`Business DB is empty (${dbPath}). Run: npm run import:master <Master.xlsx>`);
    process.exit(1);
  }
  logger.info({ dbPath, ...counts }, '✓ Business datastore ready');

  const transport = (process.env.BUSINESS_TRANSPORT || 'baileys').toLowerCase();
  let bot: MessageSender & { disconnect(): Promise<void> };
  let server: ReturnType<typeof createServer> | null = null;

  const buildHandler = (sender: MessageSender) => new BusinessMessageHandler({
    db,
    sender,
    ollama: ollamaClient,
    staff: config.whatsapp.owners
  });

  if (transport === 'twilio') {
    const [sid, token, from] = requireEnv('business', ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_NUMBER']);
    const twilioBot = new TwilioWhatsAppBot(sid, token, from);
    await twilioBot.start();
    bot = twilioBot;
    server = createServer({ messageHandler: buildHandler(twilioBot), twilioAuthToken: token }, parseInt(process.env.WEBHOOK_PORT || '3000'));
  } else {
    const baileysBot = new WhatsAppBot(
      config.whatsapp.sessionPath,
      config.whatsapp.reconnectDelay,
      config.whatsapp.maxReconnectAttempts
    );
    bot = baileysBot;
    const handler = buildHandler(baileysBot);
    baileysBot.onMessage((from, message) => handler.handleMessage(from, message));

    logger.info('Starting WhatsApp (scan the QR with the customer-care phone)...');
    await baileysBot.start();
    let attempts = 0;
    while (!baileysBot.isConnected() && attempts < 120) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }
    if (!baileysBot.isConnected()) {
      logger.error('WhatsApp failed to connect within 120 seconds');
      process.exit(1);
    }
  }

  logger.info('🎉 Business mode operational');
  console.log('\n=====================================================');
  console.log('🌸 Mode: business (the real subscription operation)');
  console.log(`💾 Datastore: ${dbPath} — ${counts.customers} customers, ${counts.active} active subscriptions`);
  console.log(`📱 Transport: ${transport}`);
  console.log(`👑 Staff numbers: ${config.whatsapp.owners.length > 0 ? config.whatsapp.owners.join(', ') + ' — text "help"' : '⚠️ none set (OWNER_NUMBERS)'}`);
  console.log('=====================================================\n');

  const shutdown = async () => {
    logger.info('Shutting down gracefully...');
    await bot.disconnect();
    server?.close();
    db.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.stdin.resume();
}

async function main() {
  const mode = resolveMode();

  try {
    logger.info({ mode }, '🌸 Starting Bring My Flowers Chatbot...');

    const config = loadConfig();
    ensureDirectories(config);

    // Ollama is shared by every mode. The bot still works without it —
    // classification falls back to regex and canned replies — so warn only.
    logger.info({ endpoint: config.ollama.endpoint, model: config.ollama.model }, 'Initializing Ollama client');
    const ollamaClient = new OllamaClient(
      config.ollama.endpoint,
      config.ollama.model,
      config.ollama.timeout
    );

    const ollamaHealthy = await ollamaClient.checkHealth();
    if (ollamaHealthy) {
      logger.info('✓ Ollama is healthy');
    } else {
      logger.warn(`Ollama not responding - will use fallback classification. Run: ollama pull ${config.ollama.model}`);
    }

    if (mode === 'business') {
      await startBusinessMode(config, ollamaClient);
      return;
    }

    // ---- Mode-specific transport, storage, and extras ----------------------
    let dataStore!: DataStore;
    let whatsappBot!: MessageSender & { disconnect(): Promise<void> };
    let razorpayClient: RazorpayClient | null = null;
    let baileysBot: WhatsAppBot | null = null;
    let twilioAuthToken: string | undefined;
    let voiceComponents: VoiceComponents | undefined;
    let paymentComponents: PaymentComponents | undefined;
    let inventoryMonitor: InventoryMonitor | null = null;

    const buildExcelStore = () => {
      logger.info({ filePath: config.excel.filePath }, 'Initializing Excel manager');
      const excelManager = new ExcelManager(
        config.excel.filePath,
        config.excel.backupPath,
        config.excel.backupBeforeWrite
      );
      logger.info('✓ Excel manager initialized');
      return excelManager;
    };

    if (mode === 'baileys') {
      dataStore = buildExcelStore();
      baileysBot = new WhatsAppBot(
        config.whatsapp.sessionPath,
        config.whatsapp.reconnectDelay,
        config.whatsapp.maxReconnectAttempts
      );
      whatsappBot = baileysBot;
    } else {
      const [twilioAccountSid, authToken, twilioWhatsAppNumber] = requireEnv(mode, [
        'TWILIO_ACCOUNT_SID',
        'TWILIO_AUTH_TOKEN',
        'TWILIO_WHATSAPP_NUMBER'
      ]);
      twilioAuthToken = authToken;

      logger.info('Initializing Twilio WhatsApp bot');
      const bot = new TwilioWhatsAppBot(twilioAccountSid, authToken, twilioWhatsAppNumber);
      await bot.start();
      whatsappBot = bot;
      logger.info('✓ Twilio WhatsApp bot initialized');

      if (mode === 'twilio') {
        dataStore = buildExcelStore();
      } else {
        const [razorpayKeyId, razorpayKeySecret, googleSpreadsheetId] = requireEnv(mode, [
          'RAZORPAY_KEY_ID',
          'RAZORPAY_KEY_SECRET',
          'GOOGLE_SPREADSHEET_ID'
        ]);
        const razorpayWebhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
        const googleCredentials = process.env.GOOGLE_CREDENTIALS_PATH || './google-credentials.json';

        const auth = new google.auth.GoogleAuth({
          keyFile: googleCredentials,
          scopes: [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/calendar'
          ],
        });
        const authClient = await auth.getClient();

        logger.info('Initializing Google Sheets manager');
        const sheetsManager = new GoogleSheetsManager(googleCredentials, googleSpreadsheetId);
        await sheetsManager.initializeSheets();
        dataStore = sheetsManager;
        logger.info('✓ Google Sheets manager initialized');

        logger.info('Initializing Razorpay client');
        razorpayClient = new RazorpayClient(razorpayKeyId, razorpayKeySecret, razorpayWebhookSecret);
        logger.info('✓ Razorpay client initialized');

        const voiceTranscriber = new VoiceTranscriber('base');
        const calendarManager = new CalendarManager(authClient);
        logger.info('✓ Voice transcriber and calendar manager initialized');

        voiceComponents = { transcriber: voiceTranscriber, dataStore };
        paymentComponents = { razorpayClient, dataStore, calendarManager, whatsappBot: bot };

        inventoryMonitor = new InventoryMonitor(
          sheetsManager,
          bot,
          config.whatsapp.owners,
          calendarManager
        );
      }
    }

    // ---- Shared wiring ------------------------------------------------------
    const notifier = new DeliveryNotifier(whatsappBot);
    // Orders end in a Razorpay payment link in enhanced mode, direct confirm otherwise
    const fulfillment: OrderFulfillment = razorpayClient
      ? new PaymentLinkFulfillment(dataStore, razorpayClient, notifier)
      : new DirectOrderFulfillment(dataStore, ollamaClient, notifier);

    const summaryGenerator = new DailySummaryGenerator(
      ollamaClient,
      dataStore,
      whatsappBot,
      config.whatsapp.owners,
      config.scheduler.summaryTime
    );

    const dailyOps = new DailyOpsScheduler({
      dataStore,
      fulfillment,
      notifier,
      owners: config.whatsapp.owners,
      ownerSender: whatsappBot,
      recurringTime: config.scheduler.recurringTime,
      reminderTime: config.scheduler.reminderTime
    });

    const ownerCommands = new OwnerCommandHandler({
      dataStore,
      notifier,
      sender: whatsappBot,
      owners: config.whatsapp.owners,
      summary: summaryGenerator,
      dailyOps
    });

    const messageHandler = new MessageHandler({
      ollamaClient,
      dataStore,
      notifier,
      fulfillment,
      ownerCommands,
      rateLimitPerMinute: config.messaging.rateLimitPerMinute,
      confirmationRequired: config.messaging.confirmationRequired
    });
    logger.info('✓ Message handler initialized');

    // ---- Start transports -----------------------------------------------------
    let server: ReturnType<typeof createServer> | null = null;

    if (baileysBot) {
      baileysBot.onMessage(async (from, message) => {
        await messageHandler.handleMessage(from, message);
      });

      logger.info('Starting WhatsApp bot...');
      await baileysBot.start();

      // Wait for the QR scan / session restore to connect
      let attempts = 0;
      while (!baileysBot.isConnected() && attempts < 60) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        attempts++;
      }

      if (!baileysBot.isConnected()) {
        logger.error('WhatsApp bot failed to connect within 60 seconds');
        process.exit(1);
      }
      logger.info('✓ WhatsApp bot connected successfully');
    } else {
      const webhookPort = parseInt(process.env.WEBHOOK_PORT || '3000');
      server = createServer({
        messageHandler,
        twilioAuthToken,
        voice: voiceComponents,
        payment: paymentComponents
      }, webhookPort);
    }

    // ---- Start schedulers -----------------------------------------------------
    summaryGenerator.start();
    dailyOps.start();
    inventoryMonitor?.start();
    logger.info('✓ Schedulers started');

    logger.info({ mode }, '🎉 Bring My Flowers Chatbot is fully operational!');
    console.log('\n=====================================================');
    console.log(`🌸 Mode: ${mode}`);
    console.log('📱 WhatsApp: Connected and listening for messages');
    console.log(`📊 Daily Summary: ${config.scheduler.summaryTime} · 🔁 Recurring: ${config.scheduler.recurringTime} · 🔔 Reminders: ${config.scheduler.reminderTime}`);
    console.log(`👑 Owner commands: ${config.whatsapp.owners.length > 0 ? `enabled for ${config.whatsapp.owners.length} number(s) — text "help"` : 'no OWNER_NUMBERS configured'}`);
    if (mode === 'enhanced') {
      console.log('📊 Google Sheets + 📅 Calendar + 💰 Razorpay: Connected');
      console.log('🌍 Languages: EN, AR, HI, UR');
    } else {
      console.log(`💾 Data Storage: ${config.excel.filePath}`);
    }
    console.log('=====================================================\n');
    if (server) {
      console.log('⚠️  IMPORTANT: Expose the webhook to the internet using ngrok:');
      console.log(`   ngrok http ${process.env.WEBHOOK_PORT || '3000'}`);
      console.log('   Then set the ngrok URL in the Twilio console and WEBHOOK_BASE_URL in .env\n');
    }

    // Graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down gracefully...');
      summaryGenerator.stop();
      dailyOps.stop();
      inventoryMonitor?.stop();
      await whatsappBot.disconnect();
      server?.close();
      logger.info('Shutdown complete');
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Keep process alive (baileys mode has no server holding the loop open)
    process.stdin.resume();

  } catch (error) {
    logger.error({ error }, 'Fatal error during startup');
    process.exit(1);
  }
}

// Handle unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error({ reason, promise }, 'Unhandled Rejection');
});

process.on('uncaughtException', (error) => {
  logger.error({ error }, 'Uncaught Exception');
  process.exit(1);
});

main();
