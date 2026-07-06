import { TwilioWhatsAppBot } from './bot/twilioWhatsApp';
import { OllamaClient } from './llm/ollama';
import { GoogleSheetsManager } from './data/googleSheetsManager';
import { DeliveryNotifier } from './notifications/deliveryNotifier';
import { MessageHandler } from './handlers/messageHandler';
import { DailySummaryGenerator } from './summary/dailySummary';
import { RazorpayClient } from './payment/razorpayClient';
import { VoiceTranscriber } from './voice/transcriber';
import { CalendarManager } from './calendar/calendarManager';
import { InventoryMonitor } from './inventory/inventoryMonitor';
import { LanguageDetector } from './i18n/languageDetector';
import { PaymentLinkFulfillment } from './handlers/orderFulfillment';
import { createEnhancedServer } from './server-enhanced';
import { loadConfig, ensureDirectories } from './utils/config';
import { google } from 'googleapis';
import logger from './utils/logger';

async function main() {
  try {
    logger.info('🌸 Starting Enhanced Bring My Flowers Chatbot...');

    // Load configuration
    const config = loadConfig();
    ensureDirectories(config);

    // Check environment variables
    const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
    const twilioWhatsAppNumber = process.env.TWILIO_WHATSAPP_NUMBER;
    const razorpayKeyId = process.env.RAZORPAY_KEY_ID;
    const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET;
    const razorpayWebhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const googleCredentials = process.env.GOOGLE_CREDENTIALS_PATH || './google-credentials.json';
    const googleSpreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;

    if (!twilioAccountSid || !twilioAuthToken || !twilioWhatsAppNumber) {
      logger.error('Missing Twilio credentials');
      process.exit(1);
    }

    if (!razorpayKeyId || !razorpayKeySecret) {
      logger.error('Missing Razorpay credentials');
      process.exit(1);
    }

    if (!googleSpreadsheetId) {
      logger.error('Missing Google Spreadsheet ID');
      process.exit(1);
    }

    // Initialize Google Auth
    const auth = new google.auth.GoogleAuth({
      keyFile: googleCredentials,
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/calendar'
      ],
    });
    const authClient = await auth.getClient();

    // Initialize Ollama client
    logger.info({ endpoint: config.ollama.endpoint }, 'Initializing Ollama client');
    const ollamaClient = new OllamaClient(
      config.ollama.endpoint,
      config.ollama.model,
      config.ollama.timeout
    );

    const ollamaHealthy = await ollamaClient.checkHealth();
    if (!ollamaHealthy) {
      logger.warn('Ollama not responding - will use fallback classification');
    } else {
      logger.info('✓ Ollama is healthy');
    }

    // Initialize Google Sheets manager
    logger.info('Initializing Google Sheets manager');
    const sheetsManager = new GoogleSheetsManager(googleCredentials, googleSpreadsheetId);
    await sheetsManager.initializeSheets();
    logger.info('✓ Google Sheets manager initialized');

    // Initialize Twilio WhatsApp bot
    logger.info('Initializing Twilio WhatsApp bot');
    const whatsappBot = new TwilioWhatsAppBot(
      twilioAccountSid,
      twilioAuthToken,
      twilioWhatsAppNumber
    );
    await whatsappBot.start();
    logger.info('✓ Twilio WhatsApp bot initialized');

    // Initialize Razorpay client
    logger.info('Initializing Razorpay client');
    const razorpayClient = new RazorpayClient(razorpayKeyId, razorpayKeySecret, razorpayWebhookSecret);
    logger.info('✓ Razorpay client initialized');

    // Initialize Voice Transcriber
    logger.info('Initializing Voice Transcriber');
    const voiceTranscriber = new VoiceTranscriber('base');
    logger.info('✓ Voice Transcriber initialized');

    // Initialize Calendar Manager
    logger.info('Initializing Calendar Manager');
    const calendarManager = new CalendarManager(authClient);
    logger.info('✓ Calendar Manager initialized');

    // Initialize Language Detector
    const languageDetector = new LanguageDetector();
    logger.info('✓ Language Detector initialized');

    // Initialize delivery notifier
    const deliveryNotifier = new DeliveryNotifier(whatsappBot);
    logger.info('✓ Delivery notifier initialized');

    // Initialize message handler: orders end in a Razorpay payment link
    const messageHandler = new MessageHandler({
      ollamaClient,
      dataStore: sheetsManager,
      notifier: deliveryNotifier,
      fulfillment: new PaymentLinkFulfillment(sheetsManager, razorpayClient, deliveryNotifier),
      rateLimitPerMinute: config.messaging.rateLimitPerMinute,
      confirmationRequired: config.messaging.confirmationRequired
    });
    logger.info('✓ Message handler initialized');

    // Initialize Inventory Monitor
    logger.info('Initializing Inventory Monitor');
    const inventoryMonitor = new InventoryMonitor(
      sheetsManager,
      whatsappBot,
      config.whatsapp.owners,
      calendarManager
    );
    inventoryMonitor.start();
    logger.info('✓ Inventory Monitor started');

    // Set up enhanced webhook server
    const webhookPort = parseInt(process.env.WEBHOOK_PORT || '3000');
    const server = createEnhancedServer({
      messageHandler,
      dataStore: sheetsManager,
      razorpayClient,
      voiceTranscriber,
      whatsappBot,
      calendarManager,
      languageDetector,
      twilioAuthToken
    }, webhookPort);

    // Initialize daily summary generator
    logger.info({ time: config.scheduler.summaryTime }, 'Initializing daily summary generator');
    const summaryGenerator = new DailySummaryGenerator(
      ollamaClient,
      sheetsManager,
      whatsappBot,
      config.whatsapp.owners,
      config.scheduler.summaryTime
    );
    summaryGenerator.start();
    logger.info('✓ Daily summary scheduler started');

    logger.info('🎉 Enhanced Bring My Flowers Chatbot is fully operational!');
    console.log('\n=====================================================');
    console.log('📱 Twilio WhatsApp: Ready');
    console.log(`🌐 Webhook: http://localhost:${webhookPort}/webhook/whatsapp`);
    console.log(`🎤 Voice: http://localhost:${webhookPort}/webhook/voice`);
    console.log(`💳 Payment: http://localhost:${webhookPort}/webhook/payment`);
    console.log(`📊 Google Sheets: Connected`);
    console.log(`📅 Google Calendar: Connected`);
    console.log(`💰 Razorpay: Connected`);
    console.log(`🌍 Languages: EN, AR, HI, UR`);
    console.log(`📦 Inventory Monitor: Running`);
    console.log(`📊 Daily Summary: Scheduled at ${config.scheduler.summaryTime}`);
    console.log('=====================================================\n');
    console.log('⚠️  IMPORTANT: Expose webhook to internet using ngrok:');
    console.log(`   ngrok http ${webhookPort}`);
    console.log('   Then configure the ngrok URL in Twilio console\n');

    // Graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down gracefully...');
      summaryGenerator.stop();
      inventoryMonitor.stop();
      await whatsappBot.disconnect();
      server.close();
      logger.info('Shutdown complete');
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

  } catch (error) {
    logger.error({ error }, 'Fatal error during startup');
    process.exit(1);
  }
}

process.on('unhandledRejection', (reason, promise) => {
  logger.error({ reason, promise }, 'Unhandled Rejection');
});

process.on('uncaughtException', (error) => {
  logger.error({ error }, 'Uncaught Exception');
  process.exit(1);
});

main();
