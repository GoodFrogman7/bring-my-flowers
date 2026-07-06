import Razorpay from 'razorpay';
import crypto from 'crypto';
import logger from '../utils/logger';

export class RazorpayClient {
  private razorpay: Razorpay;
  private keySecret: string;

  constructor(keyId: string, keySecret: string) {
    this.razorpay = new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    });
    this.keySecret = keySecret;
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

  verifyWebhookSignature(payload: string, signature: string): boolean {
    try {
      const expectedSignature = crypto
        .createHmac('sha256', this.keySecret)
        .update(payload)
        .digest('hex');

      return expectedSignature === signature;
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
