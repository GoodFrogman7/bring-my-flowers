import { DataStore } from '../data/dataStore';
import { MessageSender } from '../bot/messageSender';
import { DeliveryNotifier } from '../notifications/deliveryNotifier';
import { DailyOpsScheduler } from '../scheduler/dailyOps';
import { Order, STOCK_HELD_STATUSES } from '../types';
import { responses, formatResponse, Language } from '../i18n/languageDetector';
import { findBestFlowerMatch } from '../utils/fuzzyMatch';
import { samePhone } from '../utils/ids';
import { nextOccurrence, describeSchedule } from '../utils/recurrence';
import logger from '../utils/logger';

export interface OwnerCommandOptions {
  dataStore: DataStore;
  /** Customer-facing notifications (status changes). */
  notifier: DeliveryNotifier;
  /** Replies back to the owner. */
  sender: MessageSender;
  owners: string[];
  summary?: { generateNow(): Promise<unknown> };
  dailyOps?: DailyOpsScheduler;
}

const HELP = `🌸 Owner commands

📋 Orders
  today — today's orders & revenue
  orders <YYYY-MM-DD|tomorrow> — orders for a date
  order ORD-… — order details

🚚 Delivery status (customer is notified)
  out ORD-… — mark out for delivery
  deliver ORD-… — mark delivered
  cancel ORD-… [reason] — cancel & return stock

📦 Stock
  stock — inventory levels
  stock add <flower> <qty> — receive stock
  stock set <flower> <qty> — correct a count

🔁 Subscriptions
  recurring — list all
  recurring pause|resume|cancel REC-…
  recurring run — materialize due orders now

📊 summary — send today's business summary now`;

function customerLanguage(order: Order): Language {
  const lang = order.language as Language | undefined;
  return lang && ['en', 'ar', 'hi', 'ur'].includes(lang) ? lang : 'en';
}

function describeOrder(order: Order): string {
  return `${order.order_id} — ${order.quantity} ${order.items}, ₹${order.amount}\n  ${order.date} · ${order.status} · ${order.customer_phone}${order.notes ? `\n  📝 ${order.notes}` : ''}`;
}

/**
 * Deterministic WhatsApp command channel for shop owners. No LLM in the loop:
 * these commands move money and stock, so parsing must be exact. Anything
 * unrecognized gets the help text.
 */
export class OwnerCommandHandler {
  constructor(private options: OwnerCommandOptions) {}

  isOwner(phone: string): boolean {
    return this.options.owners.some(owner => samePhone(owner, phone));
  }

  async handle(from: string, message: string): Promise<void> {
    const reply = (text: string) => this.options.sender.sendMessage(from, text);

    try {
      const trimmed = message.trim();
      const command = trimmed.split(/\s+/)[0]?.toLowerCase() ?? '';

      logger.info({ from, command }, 'Owner command received');

      switch (command) {
        case 'help':
          await reply(HELP);
          return;
        case 'today':
          await reply(await this.ordersReport(new Date().toISOString().split('T')[0]));
          return;
        case 'orders':
          await reply(await this.ordersForArg(trimmed));
          return;
        case 'order':
          await reply(await this.orderDetails(trimmed));
          return;
        case 'out':
          await reply(await this.markOutForDelivery(trimmed));
          return;
        case 'deliver':
        case 'delivered':
          await reply(await this.markDelivered(trimmed));
          return;
        case 'cancel':
          await reply(await this.cancelOrder(trimmed));
          return;
        case 'stock':
          await reply(await this.stockCommand(trimmed));
          return;
        case 'recurring':
          await reply(await this.recurringCommand(trimmed));
          return;
        case 'summary':
          if (!this.options.summary) {
            await reply('Summary is not available in this mode.');
            return;
          }
          await reply('📊 Generating today\'s summary…');
          await this.options.summary.generateNow();
          return;
        default:
          await reply(`Unrecognized command "${command}".\n\n${HELP}`);
          return;
      }
    } catch (error) {
      logger.error({ error, from, message }, 'Owner command failed');
      await reply('⚠️ That command failed — check the logs. Nothing may have been changed.');
    }
  }

  // ---- Orders ---------------------------------------------------------------

  private async ordersForArg(message: string): Promise<string> {
    const arg = message.split(/\s+/)[1]?.toLowerCase();
    let date = new Date().toISOString().split('T')[0];
    if (arg === 'tomorrow') {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      date = d.toISOString().split('T')[0];
    } else if (arg && /^\d{4}-\d{2}-\d{2}$/.test(arg)) {
      date = arg;
    } else if (arg) {
      return `Couldn't read that date. Use "orders tomorrow" or "orders YYYY-MM-DD".`;
    }
    return this.ordersReport(date);
  }

  private async ordersReport(date: string): Promise<string> {
    const orders = await this.options.dataStore.getOrdersByDate(date);
    if (orders.length === 0) {
      return `📋 No orders for ${date}.`;
    }

    const active = orders.filter(o => o.status !== 'CANCELED');
    const revenue = active.reduce((sum, o) => sum + o.amount, 0);
    const byStatus = new Map<string, number>();
    for (const o of orders) byStatus.set(o.status, (byStatus.get(o.status) || 0) + 1);
    const statusLine = [...byStatus.entries()].map(([s, n]) => `${n} ${s}`).join(', ');

    const lines = orders.map(describeOrder).join('\n\n');
    return `📋 Orders for ${date}\n${orders.length} total (${statusLine}) — ₹${revenue}\n\n${lines}`;
  }

  private orderIdFrom(message: string): string | null {
    const match = message.toUpperCase().match(/\bORD-[A-Z0-9-]+\b/);
    return match ? match[0] : null;
  }

  private async orderDetails(message: string): Promise<string> {
    const orderId = this.orderIdFrom(message);
    if (!orderId) return 'Which order? e.g. "order ORD-ABC123".';
    const order = await this.options.dataStore.getOrderById(orderId);
    return order ? `📋 ${describeOrder(order)}` : `Order ${orderId} not found.`;
  }

  private async markOutForDelivery(message: string): Promise<string> {
    const orderId = this.orderIdFrom(message);
    if (!orderId) return 'Which order? e.g. "out ORD-ABC123".';

    const order = await this.options.dataStore.getOrderById(orderId);
    if (!order) return `Order ${orderId} not found.`;
    if (order.status === 'CANCELED' || order.status === 'DELIVERED') {
      return `Order ${orderId} is ${order.status} — can't send it out.`;
    }
    if (order.status === 'PENDING_PAYMENT') {
      return `Order ${orderId} is still awaiting payment. Collect payment first, or cancel it.`;
    }

    await this.options.dataStore.updateOrderStatus(orderId, 'OUT_FOR_DELIVERY');
    await this.options.notifier.notifyOutForDelivery(order);
    return `🚚 ${orderId} marked out for delivery. Customer notified.`;
  }

  private async markDelivered(message: string): Promise<string> {
    const orderId = this.orderIdFrom(message);
    if (!orderId) return 'Which order? e.g. "deliver ORD-ABC123".';

    const order = await this.options.dataStore.getOrderById(orderId);
    if (!order) return `Order ${orderId} not found.`;
    if (order.status === 'CANCELED') return `Order ${orderId} is CANCELED — can't mark it delivered.`;
    if (order.status === 'DELIVERED') return `Order ${orderId} is already delivered.`;

    await this.options.dataStore.updateOrderStatus(orderId, 'DELIVERED');
    await this.options.notifier.notifyDelivered(order);
    return `✅ ${orderId} marked delivered. Customer notified.`;
  }

  private async cancelOrder(message: string): Promise<string> {
    const orderId = this.orderIdFrom(message);
    if (!orderId) return 'Which order? e.g. "cancel ORD-ABC123 customer moved".';

    const order = await this.options.dataStore.getOrderById(orderId);
    if (!order) return `Order ${orderId} not found.`;
    if (order.status === 'DELIVERED') return `Order ${orderId} was already delivered — can't cancel.`;
    if (order.status === 'CANCELED') return `Order ${orderId} is already cancelled.`;

    const reason = message.replace(/^\s*cancel\s+\S+\s*/i, '').trim() || 'Cancelled by shop';
    const returnStock = STOCK_HELD_STATUSES.includes(order.status);

    await this.options.dataStore.updateOrderStatus(orderId, 'CANCELED', reason);
    if (returnStock) {
      const itemNames = order.items.split(',').map(item => item.trim());
      for (const itemName of itemNames) {
        await this.options.dataStore.updateInventory(itemName, order.quantity);
      }
    }

    await this.options.notifier.sendCustomMessage(
      order.customer_phone,
      formatResponse(responses.order_canceled[customerLanguage(order)], { orderId })
    );

    return `🛑 ${orderId} cancelled (${reason}).${returnStock ? ` Stock returned: ${order.quantity} ${order.items}.` : ''} Customer notified.`;
  }

  // ---- Stock ----------------------------------------------------------------

  private async stockCommand(message: string): Promise<string> {
    const parts = message.trim().split(/\s+/);
    const sub = parts[1]?.toLowerCase();

    if (!sub) {
      const inventory = await this.options.dataStore.getAllInventory();
      if (inventory.length === 0) return '📦 Inventory is empty.';
      const lines = inventory.map(i => {
        const low = i.max_stock && i.quantity <= i.max_stock * 0.2 ? ' ⚠️ LOW' : '';
        return `${i.item_name}: ${i.quantity} (₹${i.unit_price}/stem)${low}`;
      });
      return `📦 Stock\n${lines.join('\n')}`;
    }

    if (sub !== 'add' && sub !== 'set') {
      return 'Use "stock", "stock add <flower> <qty>" or "stock set <flower> <qty>".';
    }

    const qty = parseInt(parts[parts.length - 1], 10);
    const flowerName = parts.slice(2, -1).join(' ');
    if (!flowerName || isNaN(qty) || qty < 0 || (sub === 'add' && qty === 0)) {
      return `Use "stock ${sub} <flower> <qty>", e.g. "stock ${sub} Roses 50".`;
    }

    const inventory = await this.options.dataStore.getAllInventory();
    const match = findBestFlowerMatch(flowerName, inventory.map(i => i.item_name));
    if (!match || match.confidence < 0.6) {
      return `No flower matching "${flowerName}". In stock: ${inventory.map(i => i.item_name).join(', ')}.`;
    }

    const item = inventory.find(i => i.item_name === match.match)!;
    const before = item.quantity;
    const change = sub === 'add' ? qty : qty - before;
    await this.options.dataStore.updateInventory(item.item_name, change);
    return `📦 ${item.item_name}: ${before} → ${before + change}.`;
  }

  // ---- Subscriptions ----------------------------------------------------------

  private recurringIdFrom(message: string): string | null {
    const match = message.toUpperCase().match(/\bREC-[A-Z0-9-]+\b/);
    return match ? match[0] : null;
  }

  private async recurringCommand(message: string): Promise<string> {
    const sub = message.trim().split(/\s+/)[1]?.toLowerCase();
    const { dataStore, notifier, dailyOps } = this.options;

    if (!sub) {
      const all = await dataStore.getAllRecurringOrders();
      const live = all.filter(r => r.status !== 'CANCELLED');
      if (live.length === 0) return '🔁 No subscriptions.';
      const lines = live.map(r =>
        `${r.recurring_id} — ${r.quantity} ${r.items} ${describeSchedule(r.frequency, r.day)}\n  ${r.status} · next ${r.next_date} · ${r.customer_phone}`
      );
      return `🔁 Subscriptions\n\n${lines.join('\n\n')}`;
    }

    if (sub === 'run') {
      if (!dailyOps) return 'Recurring runs are not available in this mode.';
      const result = await dailyOps.runRecurringOnce();
      return `🔁 Run complete: ${result.created} order(s) created, ${result.skipped} skipped.`;
    }

    if (sub !== 'pause' && sub !== 'resume' && sub !== 'cancel') {
      return 'Use "recurring", "recurring run", or "recurring pause|resume|cancel REC-…".';
    }

    const recurringId = this.recurringIdFrom(message);
    if (!recurringId) return `Which subscription? e.g. "recurring ${sub} REC-ABC123".`;

    const all = await dataStore.getAllRecurringOrders();
    const recurring = all.find(r => r.recurring_id === recurringId);
    if (!recurring) return `Subscription ${recurringId} not found.`;

    const lang = (recurring.language || 'en') as Language;
    const today = new Date().toISOString().split('T')[0];

    if (sub === 'pause') {
      if (recurring.status !== 'ACTIVE') return `${recurringId} is ${recurring.status}, not active.`;
      await dataStore.updateRecurringOrder(recurringId, { status: 'PAUSED' });
      await notifier.sendCustomMessage(
        recurring.customer_phone,
        formatResponse(responses.recurring_paused[lang], { recurringId })
      );
      return `⏸️ ${recurringId} paused. Customer notified.`;
    }

    if (sub === 'resume') {
      if (recurring.status !== 'PAUSED') return `${recurringId} is ${recurring.status}, not paused.`;
      // Recompute from today so a long pause doesn't dump missed cycles
      const nextDate = nextOccurrence(recurring.frequency, recurring.day, today);
      await dataStore.updateRecurringOrder(recurringId, { status: 'ACTIVE', next_date: nextDate });
      await notifier.sendCustomMessage(
        recurring.customer_phone,
        formatResponse(responses.recurring_resumed[lang], { recurringId, date: nextDate })
      );
      return `▶️ ${recurringId} resumed, next delivery ${nextDate}. Customer notified.`;
    }

    // cancel
    if (recurring.status === 'CANCELLED') return `${recurringId} is already cancelled.`;
    await dataStore.updateRecurringOrder(recurringId, { status: 'CANCELLED' });
    await notifier.sendCustomMessage(
      recurring.customer_phone,
      formatResponse(responses.recurring_cancelled[lang], { recurringId })
    );
    return `🛑 ${recurringId} cancelled. Customer notified.`;
  }
}
