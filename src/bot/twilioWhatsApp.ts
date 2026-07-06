import twilio from 'twilio';
import logger from '../utils/logger';
import { MessageSender } from './messageSender';

export class TwilioWhatsAppBot implements MessageSender {
  private client: twilio.Twilio;
  private from: string;
  private messageHandler: ((from: string, message: string) => Promise<void>) | null = null;
  private connected: boolean = false;

  constructor(accountSid: string, authToken: string, fromNumber: string) {
    this.client = twilio(accountSid, authToken);
    this.from = fromNumber;
    this.connected = true;
  }

  async start(): Promise<void> {
    logger.info('Twilio WhatsApp bot initialized');
    this.connected = true;
  }

  onMessage(handler: (from: string, message: string) => Promise<void>): void {
    this.messageHandler = handler;
  }

  // This method will be called by webhook endpoint
  async handleIncomingWebhook(from: string, body: string): Promise<void> {
    if (this.messageHandler) {
      const phoneNumber = from.replace('whatsapp:', '');
      await this.messageHandler(phoneNumber, body);
    }
  }

  async sendMessage(to: string, message: string): Promise<boolean> {
    if (!this.connected) {
      logger.error({ to }, 'Cannot send message: Not connected');
      return false;
    }

    try {
      // Ensure whatsapp: prefix
      const toNumber = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
      
      await this.client.messages.create({
        body: message,
        from: this.from,
        to: toNumber
      });
      
      logger.info({ to, message }, 'Twilio message sent');
      return true;
    } catch (error) {
      logger.error({ error, to, message }, 'Failed to send Twilio message');
      return false;
    }
  }

  async sendMessageToMultiple(recipients: string[], message: string): Promise<void> {
    for (const recipient of recipients) {
      await this.sendMessage(recipient, message);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    logger.info('Twilio WhatsApp bot disconnected');
  }
}

