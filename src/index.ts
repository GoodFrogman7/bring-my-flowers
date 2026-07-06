import { WhatsAppBot } from './bot/whatsapp';
import { OllamaClient } from './llm/ollama';
import { ExcelManager } from './data/excelManager';
import { DeliveryNotifier } from './notifications/deliveryNotifier';
import { MessageHandler } from './handlers/messageHandler';
import { DirectOrderFulfillment } from './handlers/orderFulfillment';
import { DailySummaryGenerator } from './summary/dailySummary';
import { loadConfig, ensureDirectories } from './utils/config';
import logger from './utils/logger';

async function main() {
  try {
    logger.info('🌸 Starting Bring My Flowers Chatbot...');

    // Load configuration
    const config = loadConfig();
    logger.info({ config: { ...config, whatsapp: { ...config.whatsapp, owners: '[REDACTED]' } } }, 'Configuration loaded');

    // Ensure required directories exist
    ensureDirectories(config);

    // Initialize Ollama client
    logger.info({ endpoint: config.ollama.endpoint, model: config.ollama.model }, 'Initializing Ollama client');
    const ollamaClient = new OllamaClient(
      config.ollama.endpoint,
      config.ollama.model,
      config.ollama.timeout
    );

    // Check Ollama health
    const ollamaHealthy = await ollamaClient.checkHealth();
    if (!ollamaHealthy) {
      logger.error('Ollama is not responding. Please ensure Ollama is running and the model is pulled.');
      logger.error(`Run: ollama pull ${config.ollama.model}`);
      process.exit(1);
    }
    logger.info('✓ Ollama is healthy');

    // Initialize Excel manager
    logger.info({ filePath: config.excel.filePath }, 'Initializing Excel manager');
    const excelManager = new ExcelManager(
      config.excel.filePath,
      config.excel.backupPath,
      config.excel.backupBeforeWrite
    );
    logger.info('✓ Excel manager initialized');

    // Initialize WhatsApp bot
    logger.info('Initializing WhatsApp bot');
    const whatsappBot = new WhatsAppBot(
      config.whatsapp.sessionPath,
      config.whatsapp.reconnectDelay,
      config.whatsapp.maxReconnectAttempts
    );

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

    // Set up message listener
    whatsappBot.onMessage(async (from, message) => {
      await messageHandler.handleMessage(from, message);
    });

    // Start WhatsApp bot
    logger.info('Starting WhatsApp bot...');
    await whatsappBot.start();
    logger.info('✓ WhatsApp bot started');

    // Wait for connection
    let attempts = 0;
    while (!whatsappBot.isConnected() && attempts < 60) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }

    if (!whatsappBot.isConnected()) {
      logger.error('WhatsApp bot failed to connect within 60 seconds');
      process.exit(1);
    }

    logger.info('✓ WhatsApp bot connected successfully');

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

    logger.info('🎉 Bring My Flowers Chatbot is fully operational!');
    logger.info('=====================================================');
    logger.info('📱 WhatsApp: Connected and listening for messages');
    logger.info(`📊 Daily Summary: Scheduled at ${config.scheduler.summaryTime}`);
    logger.info(`💾 Data Storage: ${config.excel.filePath}`);
    logger.info('=====================================================');

    // Graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down gracefully...');
      summaryGenerator.stop();
      await whatsappBot.disconnect();
      logger.info('Shutdown complete');
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Keep process alive
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

