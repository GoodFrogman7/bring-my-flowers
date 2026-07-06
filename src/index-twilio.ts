import { TwilioWhatsAppBot } from './bot/twilioWhatsApp';
import { OllamaClient } from './llm/ollama';
import { ExcelManager } from './data/excelManager';
import { DeliveryNotifier } from './notifications/deliveryNotifier';
import { MessageHandler } from './handlers/messageHandler';
import { DirectOrderFulfillment } from './handlers/orderFulfillment';
import { DailySummaryGenerator } from './summary/dailySummary';
import { createWebhookServer } from './server';
import { loadConfig, ensureDirectories } from './utils/config';
import logger from './utils/logger';

async function main() {
  try {
    logger.info('🌸 Starting Bring My Flowers Chatbot (Twilio Mode)...');

    // Load configuration
    const config = loadConfig();
    ensureDirectories(config);

    // Check environment variables
    const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
    const twilioWhatsAppNumber = process.env.TWILIO_WHATSAPP_NUMBER;

    if (!twilioAccountSid || !twilioAuthToken || !twilioWhatsAppNumber) {
      logger.error('Missing Twilio credentials. Please set:');
      console.error('❌ Missing Twilio credentials in .env file:\n');
      console.error('TWILIO_ACCOUNT_SID=your_account_sid');
      console.error('TWILIO_AUTH_TOKEN=your_auth_token');
      console.error('TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886\n');
      console.error('Get these from: https://console.twilio.com\n');
      process.exit(1);
    }

    // Initialize Ollama client
    logger.info({ endpoint: config.ollama.endpoint, model: config.ollama.model }, 'Initializing Ollama client');
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

    // Initialize Excel manager
    logger.info({ filePath: config.excel.filePath }, 'Initializing Excel manager');
    const excelManager = new ExcelManager(
      config.excel.filePath,
      config.excel.backupPath,
      config.excel.backupBeforeWrite
    );
    logger.info('✓ Excel manager initialized');

    // Initialize Twilio WhatsApp bot
    logger.info('Initializing Twilio WhatsApp bot');
    const whatsappBot = new TwilioWhatsAppBot(
      twilioAccountSid,
      twilioAuthToken,
      twilioWhatsAppNumber
    );
    await whatsappBot.start();
    logger.info('✓ Twilio WhatsApp bot initialized');

    // Initialize delivery notifier
    const deliveryNotifier = new DeliveryNotifier(whatsappBot);
    logger.info('✓ Delivery notifier initialized');

    // Initialize message handler
    const messageHandler = new MessageHandler({
      ollamaClient,
      dataStore: excelManager,
      notifier: deliveryNotifier,
      fulfillment: new DirectOrderFulfillment(excelManager, ollamaClient, deliveryNotifier),
      rateLimitPerMinute: config.messaging.rateLimitPerMinute,
      confirmationRequired: config.messaging.confirmationRequired
    });
    logger.info('✓ Message handler initialized');

    // Set up webhook endpoint for receiving messages
    const webhookPort = parseInt(process.env.WEBHOOK_PORT || '3000');
    const server = createWebhookServer(messageHandler, webhookPort, twilioAuthToken);

    // Initialize daily summary generator
    logger.info({ time: config.scheduler.summaryTime }, 'Initializing daily summary generator');
    const summaryGenerator = new DailySummaryGenerator(
      ollamaClient,
      excelManager,
      whatsappBot,
      config.whatsapp.owners,
      config.scheduler.summaryTime
    );
    summaryGenerator.start();
    logger.info('✓ Daily summary scheduler started');

    logger.info('🎉 Bring My Flowers Chatbot (Twilio) is fully operational!');
    console.log('\n=====================================================');
    console.log('📱 Twilio WhatsApp: Ready');
    console.log(`🌐 Webhook: http://localhost:${webhookPort}/webhook/whatsapp`);
    console.log(`📊 Daily Summary: Scheduled at ${config.scheduler.summaryTime}`);
    console.log(`💾 Data Storage: ${config.excel.filePath}`);
    console.log('=====================================================\n');
    console.log('⚠️  IMPORTANT: Expose webhook to internet using ngrok:');
    console.log(`   ngrok http ${webhookPort}`);
    console.log('   Then configure the ngrok URL in Twilio console\n');

    // Graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down gracefully...');
      summaryGenerator.stop();
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

