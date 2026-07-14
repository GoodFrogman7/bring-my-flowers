import fetch from 'node-fetch';
import logger from '../utils/logger';
import { MessageSender } from './messageSender';

interface CloudApiResponse {
  messages?: Array<{ id?: string }>;
  error?: {
    code?: number;
    message?: string;
    type?: string;
    error_data?: { details?: string };
  };
}

/**
 * WhatsApp Business Cloud API transport.
 *
 * Inbound messages are delivered to the Express webhook; this class owns only
 * the authenticated outbound Graph API calls.
 */
export class CloudApiWhatsAppBot implements MessageSender {
  private readonly endpoint: string;
  private connected = false;

  constructor(
    private readonly phoneNumberId: string,
    private readonly accessToken: string,
    apiVersion: string = 'v22.0'
  ) {
    this.endpoint = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;
  }

  async start(): Promise<void> {
    this.connected = true;
    logger.info({ phoneNumberId: this.phoneNumberId }, 'WhatsApp Cloud API bot initialized');
  }

  async sendMessage(to: string, message: string): Promise<boolean> {
    return this.send(to, {
      type: 'text',
      text: { body: message }
    });
  }

  async sendTemplate(
    to: string,
    templateName: string,
    languageCode: string = 'en_US',
    components?: unknown[]
  ): Promise<boolean> {
    return this.send(to, {
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        ...(components && components.length > 0 ? { components } : {})
      }
    });
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
    logger.info('WhatsApp Cloud API bot disconnected');
  }

  private async send(to: string, payload: Record<string, unknown>): Promise<boolean> {
    if (!this.connected) {
      logger.error({ to }, 'Cannot send Cloud API message: Not connected');
      return false;
    }

    const recipient = to.replace(/[^0-9]/g, '');
    if (!recipient) {
      logger.error({ to }, 'Cannot send Cloud API message: Invalid recipient');
      return false;
    }

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: recipient,
          ...payload
        })
      });
      const body = await response.json() as CloudApiResponse;

      if (!response.ok || body.error) {
        logger.error({
          to: recipient,
          status: response.status,
          error: body.error
        }, 'WhatsApp Cloud API rejected message');
        return false;
      }

      logger.info({ to: recipient, messageId: body.messages?.[0]?.id }, 'WhatsApp Cloud API message sent');
      return true;
    } catch (error) {
      logger.error({ error, to: recipient }, 'Failed to send WhatsApp Cloud API message');
      return false;
    }
  }
}
