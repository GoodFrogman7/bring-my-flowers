import { DataStore } from '../data/dataStore';
import { DeliveryNotifier } from '../notifications/deliveryNotifier';
import { OllamaClient } from '../llm/ollama';
import { RazorpayClient } from '../payment/razorpayClient';
import { InventoryItem } from '../types';
import { responses, formatResponse, Language } from '../i18n/languageDetector';
import logger from '../utils/logger';

export interface FulfillmentContext {
  phone: string;
  orderId: string;
  flower: InventoryItem;
  quantity: number;
  /** YYYY-MM-DD */
  deliveryDate: string;
  totalPrice: number;
  language: Language;
}

/**
 * What happens once an order draft is complete and confirmed. The collection
 * pipeline (extraction, fuzzy match, stock check) is shared; only this final
 * step differs between the direct (Excel) and payment-link (enhanced) modes.
 */
export interface OrderFulfillment {
  fulfill(ctx: FulfillmentContext): Promise<void>;
}

/** Creates the order as CONFIRMED immediately — no payment step. */
export class DirectOrderFulfillment implements OrderFulfillment {
  constructor(
    private dataStore: DataStore,
    private ollamaClient: OllamaClient,
    private notifier: DeliveryNotifier
  ) {}

  async fulfill(ctx: FulfillmentContext): Promise<void> {
    await this.dataStore.addOrder({
      order_id: ctx.orderId,
      customer_id: `CUST-${ctx.phone.slice(-4)}`,
      customer_name: 'Customer',
      customer_phone: ctx.phone,
      items: ctx.flower.item_name,
      quantity: ctx.quantity,
      amount: ctx.totalPrice,
      date: ctx.deliveryDate,
      status: 'CONFIRMED',
      order_date: new Date().toISOString(),
      language: ctx.language
    });

    await this.dataStore.updateInventory(ctx.flower.item_name, -ctx.quantity);

    let confirmation: string;
    try {
      confirmation = await this.ollamaClient.generateOrderConfirmation({
        orderId: ctx.orderId,
        flowers: ctx.flower.item_name,
        quantity: ctx.quantity,
        price: ctx.totalPrice,
        deliveryDate: ctx.deliveryDate
      });
    } catch {
      confirmation = formatResponse(responses.order_confirmation[ctx.language], {
        orderId: ctx.orderId,
        amount: ctx.totalPrice,
        date: ctx.deliveryDate
      });
    }
    await this.notifier.sendCustomMessage(ctx.phone, confirmation);

    logger.info({
      order_id: ctx.orderId,
      phone: ctx.phone,
      flowers: ctx.flower.item_name,
      quantity: ctx.quantity,
      amount: ctx.totalPrice,
      delivery_date: ctx.deliveryDate
    }, 'Order created (direct fulfillment)');
  }
}

/**
 * Creates the order as PENDING_PAYMENT and sends a Razorpay link. The payment
 * webhook flips it to CONFIRMED. Stock is decremented here to reserve it;
 * an abandoned link should eventually return it (Phase 2).
 */
export class PaymentLinkFulfillment implements OrderFulfillment {
  constructor(
    private dataStore: DataStore,
    private razorpayClient: RazorpayClient,
    private notifier: DeliveryNotifier
  ) {}

  async fulfill(ctx: FulfillmentContext): Promise<void> {
    const customerName = `Customer ${ctx.phone.slice(-4)}`;
    const itemsDescription = `${ctx.quantity} ${ctx.flower.item_name}`;

    const paymentLink = await this.razorpayClient.createPaymentLink({
      amount: ctx.totalPrice,
      orderId: ctx.orderId,
      customerName,
      customerPhone: ctx.phone,
      description: `Flowers: ${itemsDescription}`
    });

    await this.dataStore.addOrder({
      order_id: ctx.orderId,
      customer_id: `CUST-${ctx.phone.slice(-4)}`,
      customer_name: customerName,
      customer_phone: ctx.phone,
      items: ctx.flower.item_name,
      quantity: ctx.quantity,
      amount: ctx.totalPrice,
      date: ctx.deliveryDate,
      status: 'PENDING_PAYMENT',
      payment_status: 'PENDING',
      payment_id: paymentLink.id,
      order_date: new Date().toISOString(),
      language: ctx.language
    });

    await this.dataStore.updateInventory(ctx.flower.item_name, -ctx.quantity);

    const paymentMessage = formatResponse(responses.payment_link[ctx.language], {
      link: paymentLink.short_url,
      amount: ctx.totalPrice,
      items: itemsDescription
    });
    await this.notifier.sendCustomMessage(ctx.phone, paymentMessage);

    logger.info({
      order_id: ctx.orderId,
      phone: ctx.phone,
      amount: ctx.totalPrice,
      payment_link_id: paymentLink.id
    }, 'Order created with payment link');
  }
}
