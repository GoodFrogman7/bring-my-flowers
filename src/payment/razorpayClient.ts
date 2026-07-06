import Razorpay from 'razorpay';
import crypto from 'crypto';
import logger from '../utils/logger';

export class RazorpayClient {
  private razorpay: Razorpay;
  private webhookSecret: string;

  constructor(keyId: string, keySecret: string, webhookSecret?: string) {
    this.razorpay = new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    });
    // Razorpay signs webhooks with the webhook secret configured in the
    // dashboard — NOT the API key secret.
    this.webhookSecret = webhookSecret || '';
    if (!this.webhookSecret) {
      logger.error('RAZORPAY_WEBHOOK_SECRET not set — all payment webhooks will be rejected until it is configured (Razorpay dashboard → Webhooks)');
    }
    logger.info('Razorpay client initialized');
  }

  async createPaymentLink(params: {
    amount: number;
    orderId: string;
    customerName: string;
    customerPhone: string;
    description: string;
  }): Promise<{short_url: string; id: string}> {
    try {
      const paymentLink = await this.razorpay.paymentLink.create({
        amount: Math.round(params.amount * 100), // Convert to paise
        currency: 'INR',
        description: params.description,
        customer: {
          name: params.customerName,
          contact: params.customerPhone,
        },
        notify: {
          sms: true,
          whatsapp: true,
        },
        reminder_enable: true,
        // Unpaid links expire after 24h; the webhook then returns the
        // reserved stock and cancels the order.
        expire_by: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
        notes: {
          order_id: params.orderId,
        },
        callback_url: process.env.PAYMENT_CALLBACK_URL || '',
        callback_method: 'get',
      });

      logger.info({
        order_id: params.orderId,
        payment_link_id: paymentLink.id,
        short_url: paymentLink.short_url
      }, 'Payment link created');

      return {
        short_url: paymentLink.short_url,
        id: paymentLink.id
      };
    } catch (error) {
      logger.error({ error, params }, 'Failed to create payment link');
      throw error;
    }
  }

  verifyWebhookSignature(payload: string | Buffer, signature: string): boolean {
    try {
      if (!this.webhookSecret || !signature) {
        return false;
      }

      const expectedSignature = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(payload)
        .digest('hex');

      const expected = Buffer.from(expectedSignature, 'utf8');
      const received = Buffer.from(signature, 'utf8');
      return expected.length === received.length && crypto.timingSafeEqual(expected, received);
    } catch (error) {
      logger.error({ error }, 'Failed to verify webhook signature');
      return false;
    }
  }

  async getPaymentDetails(paymentId: string): Promise<any> {
    try {
      const payment = await this.razorpay.payments.fetch(paymentId);
      return payment;
    } catch (error) {
      logger.error({ error, paymentId }, 'Failed to get payment details');
      throw error;
    }
  }

  async createRefund(paymentId: string, amount?: number): Promise<any> {
    try {
      const refund = await this.razorpay.payments.refund(paymentId, {
        amount: amount ? Math.round(amount * 100) : undefined,
        speed: 'normal',
      });

      logger.info({ payment_id: paymentId, refund_id: refund.id }, 'Refund created');
      return refund;
    } catch (error) {
      logger.error({ error, paymentId }, 'Failed to create refund');
      throw error;
    }
  }
}
