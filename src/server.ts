import express from 'express';
import bodyParser from 'body-parser';
import { MessageHandler } from './handlers/messageHandler';
import logger from './utils/logger';

export function createWebhookServer(messageHandler: MessageHandler, port: number = 3000) {
  const app = express();
  
  app.use(bodyParser.urlencoded({ extended: false }));
  app.use(bodyParser.json());

  // Twilio WhatsApp webhook endpoint
  app.post('/webhook/whatsapp', async (req, res) => {
    try {
      const from = req.body.From || '';
      const body = req.body.Body || '';
      
      logger.info({ from, body }, 'Received WhatsApp message via webhook');
      
      // Extract phone number (remove whatsapp: prefix)
      const phoneNumber = from.replace('whatsapp:', '');
      
      // Process message
      await messageHandler.handleMessage(phoneNumber, body);
      
      res.status(200).send('OK');
    } catch (error) {
      logger.error({ error }, 'Error processing webhook');
      res.status(500).send('Error');
    }
  });

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  const server = app.listen(port, () => {
    logger.info({ port }, 'Webhook server started');
    console.log(`\n🌐 Webhook server running on http://localhost:${port}`);
    console.log(`📱 WhatsApp webhook: http://localhost:${port}/webhook/whatsapp\n`);
  });

  return server;
}

