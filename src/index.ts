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
import { DirectOrderFulfillment, PaymentLinkFulfillment } from './handlers/orderFulfillment';
import { DailySummaryGenerator } from './summary/dailySummary';
import { RazorpayClient } from './payment/razorpayClient';
import { VoiceTranscriber } from './voice/transcriber';
import { CalendarManager } from './calendar/calendarManager';
import { InventoryMonitor } from './inventory/inventoryMonitor';
import { createServer } from './server';
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
 * Mode is chosen by CLI argument (`node dist/index.js enhanced`) or the
 * BOT_MODE environment variable; default is baileys.
 */
export type BotMode = 'baileys' | 'twilio' | 'enhanced';

const MODES: BotMode[] = ['baileys', 'twilio', 'enhanced'];

function resolveMode(): BotMode {
  const raw = (process.argv[2]?.replace(/^--mode=/, '') || process.env.BOT_MODE || 'baileys').toLowerCase();
  if (!MODES.includes(raw as BotMode)) {
    console.error(`❌ Unknown mode "${raw}". Use one of: ${MODES.join(', ')}\n`);
    console.error('  baileys   — WhatsApp Web (QR code), Excel storage, no payment step');
    console.error('  twilio    — Twilio WhatsApp API, Excel storage, no payment step');
    console.error('  enhanced  — Twilio + Google Sheets + Razorpay + voice + calendar\n');
    console.error('Examples: npm start                (baileys)');
    console.error('          npm run start:enhanced   (node dist/index.js enhanced)');
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

    // Assembled per mode below.
    let dataStore!: DataStore;
    let whatsappBot!: MessageSender & { disconnect(): Promise<void> };
    let messageHandler!: MessageHandler;
    let server: ReturnType<typeof createServer> | null = null;
    let inventoryMonitor: InventoryMonitor | null = null;

    if (mode === 'baileys') {
      logger.info({ filePath: config.excel.filePath }, 'Initializing Excel manager');
      const excelManager = new ExcelManager(
        config.excel.filePath,
        config.excel.backupPath,
        config.excel.backupBeforeWrite
      );
      dataStore = excelManager;
      logger.info('✓ Excel manager initialized');

      logger.info('Initializing WhatsApp bot');
      const bot = new WhatsAppBot(
        config.whatsapp.sessionPath,
        config.whatsapp.reconnectDelay,
        config.whatsapp.maxReconnectAttempts
      );
      whatsappBot = bot;

      const notifier = new DeliveryNotifier(bot);
      messageHandler = new MessageHandler({
        ollamaClient,
        dataStore,
        notifier,
        fulfillment: new DirectOrderFulfillment(dataStore, ollamaClient, notifier),
        rateLimitPerMinute: config.messaging.rateLimitPerMinute,
        confirmationRequired: config.messaging.confirmationRequired
      });
      logger.info('✓ Message handler initialized');

      bot.onMessage(async (from, message) => {
        await messageHandler.handleMessage(from, message);
      });

      logger.info('Starting WhatsApp bot...');
      await bot.start();

      // Wait for the QR scan / session restore to connect
      let attempts = 0;
      while (!bot.isConnected() && attempts < 60) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        attempts++;
      }

      if (!bot.isConnected()) {
        logger.error('WhatsApp bot failed to connect within 60 seconds');
        process.exit(1);
      }
      logger.info('✓ WhatsApp bot connected successfully');
    } else {
      const [twilioAccountSid, twilioAuthToken, twilioWhatsAppNumber] = requireEnv(mode, [
        'TWILIO_ACCOUNT_SID',
        'TWILIO_AUTH_TOKEN',
        'TWILIO_WHATSAPP_NUMBER'
      ]);

      logger.info('Initializing Twilio WhatsApp bot');
      const bot = new TwilioWhatsAppBot(twilioAccountSid, twilioAuthToken, twilioWhatsAppNumber);
      await bot.start();
      whatsappBot = bot;
      logger.info('✓ Twilio WhatsApp bot initialized');

      const notifier = new DeliveryNotifier(bot);
      const webhookPort = parseInt(process.env.WEBHOOK_PORT || '3000');

      if (mode === 'twilio') {
        logger.info({ filePath: config.excel.filePath }, 'Initializing Excel manager');
        const excelManager = new ExcelManager(
          config.excel.filePath,
          config.excel.backupPath,
          config.excel.backupBeforeWrite
        );
        dataStore = excelManager;
        logger.info('✓ Excel manager initialized');

        messageHandler = new MessageHandler({
          ollamaClient,
          dataStore,
          notifier,
          fulfillment: new DirectOrderFulfillment(dataStore, ollamaClient, notifier),
          rateLimitPerMinute: config.messaging.rateLimitPerMinute,
          confirmationRequired: config.messaging.confirmationRequired
        });
        logger.info('✓ Message handler initialized');

        server = createServer({ messageHandler, twilioAuthToken }, webhookPort);
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
        const razorpayClient = new RazorpayClient(razorpayKeyId, razorpayKeySecret, razorpayWebhookSecret);
        logger.info('✓ Razorpay client initialized');

        const voiceTranscriber = new VoiceTranscriber('base');
        logger.info('✓ Voice Transcriber initialized');

        const calendarManager = new CalendarManager(authClient);
        logger.info('✓ Calendar Manager initialized');

        // Orders end in a Razorpay payment link; the payment webhook confirms them
        messageHandler = new MessageHandler({
          ollamaClient,
          dataStore,
          notifier,
          fulfillment: new PaymentLinkFulfillment(dataStore, razorpayClient, notifier),
          rateLimitPerMinute: config.messaging.rateLimitPerMinute,
          confirmationRequired: config.messaging.confirmationRequired
        });
        logger.info('✓ Message handler initialized');

        inventoryMonitor = new InventoryMonitor(
          sheetsManager,
          bot,
          config.whatsapp.owners,
          calendarManager
        );
        inventoryMonitor.start();
        logger.info('✓ Inventory Monitor started');

        server = createServer({
          messageHandler,
          twilioAuthToken,
          voice: { transcriber: voiceTranscriber, dataStore },
          payment: { razorpayClient, dataStore, calendarManager, whatsappBot: bot }
        }, webhookPort);
      }
    }

    // Daily summary runs in every mode
    logger.info({ time: config.scheduler.summaryTime }, 'Initializing daily summary generator');
    const summaryGenerator = new DailySummaryGenerator(
      ollamaClient,
      dataStore,
      whatsappBot,
      config.whatsapp.owners,
      config.scheduler.summaryTime
    );
    summaryGenerator.start();
    logger.info('✓ Daily summary scheduler started');

    logger.info({ mode }, '🎉 Bring My Flowers Chatbot is fully operational!');
    console.log('\n=====================================================');
    console.log(`🌸 Mode: ${mode}`);
    console.log('📱 WhatsApp: Connected and listening for messages');
    console.log(`📊 Daily Summary: Scheduled at ${config.scheduler.summaryTime}`);
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
