import express from 'express';
import bodyParser from 'body-parser';
import logger from './utils/logger';
import { MessageHandler } from './handlers/messageHandler';
import { DataStore } from './data/dataStore';
import { MessageSender } from './bot/messageSender';
import { RazorpayClient } from './payment/razorpayClient';
import { VoiceTranscriber } from './voice/transcriber';
import { CalendarManager } from './calendar/calendarManager';
import { LanguageDetector } from './i18n/languageDetector';
import { twilioSignatureValidator } from './utils/twilioSignature';

export interface EnhancedServerComponents {
  messageHandler: MessageHandler;
  dataStore: DataStore;
  razorpayClient: RazorpayClient;
  voiceTranscriber: VoiceTranscriber;
  whatsappBot: MessageSender;
  calendarManager: CalendarManager;
  languageDetector: LanguageDetector;
  twilioAuthToken: string;
}

export function createEnhancedServer(components: EnhancedServerComponents, port: number = 3000) {
  const app = express();

  // Behind ngrok/reverse proxies so req.protocol reflects the public URL
  app.enable('trust proxy');

  app.use(bodyParser.urlencoded({ extended: false }));
  // Keep the raw bytes: Razorpay signs the exact payload it sent, and
  // re-serializing req.body does not reproduce it byte-for-byte.
  app.use(bodyParser.json({
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
    }
  }));

  const {
    messageHandler,
    dataStore,
    razorpayClient,
    voiceTranscriber,
    whatsappBot,
    calendarManager,
    languageDetector,
    twilioAuthToken
  } = components;

  const validateTwilio = twilioSignatureValidator(twilioAuthToken);

  // WhatsApp text message webhook. All messages go through intent
  // classification in MessageHandler — no keyword pre-routing, which used to
  // send "I want to cancel my order" into the order/payment flow.
  app.post('/webhook/whatsapp', validateTwilio, async (req, res) => {
    try {
      const from = req.body.From || '';
      const body = req.body.Body || '';

      logger.info({ from, body }, 'Received WhatsApp message via webhook');

      const phoneNumber = from.replace('whatsapp:', '');

      const language = languageDetector.detectLanguage(body);
      logger.info({ phone: phoneNumber, language }, 'Language detected');

      await messageHandler.handleMessage(phoneNumber, body);

      res.status(200).send('OK');
    } catch (error) {
      logger.error({ error }, 'Error processing WhatsApp webhook');
      res.status(500).send('Error');
    }
  });

  // Voice call webhook
  app.post('/webhook/voice', validateTwilio, async (req, res) => {
    try {
      logger.info({ body: req.body }, 'Received voice call');

      // Get caller info
      const from = req.body.From || '';
      const phoneNumber = from.replace('tel:', '').replace('+', '');

      // Check if caller has previous orders to detect language
      const previousOrders = await dataStore.getAllOrders();
      const customerOrder = previousOrders.find(o =>
        o.customer_phone.includes(phoneNumber)
      );
      const detectedLang = customerOrder?.language || 'en';

      // Return TwiML to record the call
      const responses = {
        en: 'Welcome to Bring My Flowers. Please tell us your order after the beep.',
        ar: 'مرحبا بكم في برينغ ماي فلاورز. يرجى إخبارنا بطلبك بعد الصفارة.',
        hi: 'ब्रिंग माई फ्लावर्स में आपका स्वागत है। बीप के बाद अपना ऑर्डर बताएं।',
        ur: 'برنگ مائی فلاورز میں خوش آمدید۔ بیپ کے بعد اپنا آرڈر بتائیں۔'
      };

      const greeting = responses[detectedLang as keyof typeof responses] || responses.en;

      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Aditi" language="${detectedLang === 'ar' ? 'arb' : detectedLang === 'hi' ? 'hi-IN' : 'en-IN'}">${greeting}</Say>
  <Record maxLength="60" transcribe="false" action="/webhook/voice/recording" playBeep="true"/>
</Response>`;

      res.type('text/xml').send(twiml);
    } catch (error) {
      logger.error({ error }, 'Error processing voice webhook');
      res.status(500).send('Error');
    }
  });

  // Voice recording processing
  app.post('/webhook/voice/recording', validateTwilio, async (req, res) => {
    try {
      const recordingUrl = req.body.RecordingUrl;
      const from = req.body.From || '';
      const phoneNumber = from.replace('tel:', '').replace('+', '');

      logger.info({ recording_url: recordingUrl, from: phoneNumber }, 'Processing voice recording');

      // Transcribe the recording
      const transcription = await voiceTranscriber.transcribeFromUrl(recordingUrl);

      logger.info({ transcription }, 'Voice transcribed');

      // Process like any text message — classification decides the intent
      await messageHandler.handleMessage(phoneNumber, transcription.text);

      // Thank the caller
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Aditi">Thank you. We'll send you a confirmation via WhatsApp shortly.</Say>
  <Hangup/>
</Response>`;

      res.type('text/xml').send(twiml);
    } catch (error) {
      logger.error({ error }, 'Error processing voice recording');
      res.status(500).send('Error');
    }
  });

  // Razorpay payment webhook
  app.post('/webhook/payment', async (req, res) => {
    try {
      const signature = req.headers['x-razorpay-signature'] as string;
      const rawBody = (req as express.Request & { rawBody?: Buffer }).rawBody;

      // Verify signature over the exact bytes Razorpay sent
      const isValid = rawBody && razorpayClient.verifyWebhookSignature(rawBody, signature);

      if (!isValid) {
        logger.error('Invalid Razorpay webhook signature');
        return res.status(400).send('Invalid signature');
      }

      const event = req.body.event;
      const paymentEntity = req.body.payload?.payment_link?.entity;
      const orderId = paymentEntity?.notes?.order_id;

      logger.info({ event, order_id: orderId }, 'Payment webhook received');

      if (!paymentEntity || !orderId) {
        logger.warn({ event }, 'Payment webhook without payment_link entity or order_id note; ignoring');
        return res.status(200).send('OK');
      }

      if (event === 'payment_link.paid') {
        const paymentId = paymentEntity.payments?.[0]?.payment_id;

        // Update order payment status
        await dataStore.updateOrderPayment(orderId, paymentId || '');
        await dataStore.updateOrderStatus(orderId, 'CONFIRMED');

        // Get order details
        const orders = await dataStore.getAllOrders();
        const order = orders.find(o => o.order_id === orderId);

        if (order) {
          // Create calendar event
          const delivery = {
            scheduled_date: order.date,
            delivery_boy: order.delivery_boy
          };
          await calendarManager.createDeliveryEvent(order, delivery);

          // Send confirmation
          const confirmationMessage = `✅ Payment received!\n\nOrder ${orderId} confirmed.\nDelivery: ${order.date}\nTotal: ₹${order.amount}\n\nThank you! 🌸`;
          await whatsappBot.sendMessage(order.customer_phone, confirmationMessage);

          logger.info({ order_id: orderId }, 'Order confirmed after payment');
        }
      } else if (event === 'payment_link.expired' || event === 'payment_link.cancelled') {
        // Abandoned link: release the reserved stock and cancel the order
        const orders = await dataStore.getAllOrders();
        const order = orders.find(o => o.order_id === orderId);

        if (order && order.status === 'PENDING_PAYMENT') {
          await dataStore.updateOrderStatus(
            orderId,
            'CANCELED',
            event === 'payment_link.expired' ? 'Payment link expired' : 'Payment link cancelled'
          );

          const itemNames = order.items.split(',').map(item => item.trim());
          for (const itemName of itemNames) {
            await dataStore.updateInventory(itemName, order.quantity);
          }

          await whatsappBot.sendMessage(
            order.customer_phone,
            `Your payment link for order ${orderId} has expired, so the order was cancelled. Message us anytime to order again! 🌸`
          );

          logger.info({ order_id: orderId, event }, 'Unpaid order cancelled and stock returned');
        }
      }

      res.status(200).send('OK');
    } catch (error) {
      logger.error({ error }, 'Error processing payment webhook');
      res.status(500).send('Error');
    }
  });

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      features: {
        whatsapp: true,
        voice: true,
        payment: true,
        sheets: true,
        calendar: true,
        multilang: true
      }
    });
  });

  const server = app.listen(port, () => {
    logger.info({ port }, 'Enhanced webhook server started');
    console.log(`\n🌐 Enhanced server running on http://localhost:${port}`);
    console.log(`📱 WhatsApp webhook: http://localhost:${port}/webhook/whatsapp`);
    console.log(`🎤 Voice webhook: http://localhost:${port}/webhook/voice`);
    console.log(`💳 Payment webhook: http://localhost:${port}/webhook/payment\n`);
  });

  return server;
}
