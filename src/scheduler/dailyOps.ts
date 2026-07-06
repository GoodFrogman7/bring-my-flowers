import * as cron from 'node-cron';
import { DataStore } from '../data/dataStore';
import { MessageSender } from '../bot/messageSender';
import { DeliveryNotifier } from '../notifications/deliveryNotifier';
import { OrderFulfillment } from '../handlers/orderFulfillment';
import { RecurringOrder } from '../types';
import { responses, formatResponse, Language } from '../i18n/languageDetector';
import { nextOccurrence } from '../utils/recurrence';
import { parseItems, displayItems } from '../utils/orderItems';
import { generateOrderId } from '../utils/ids';
import logger from '../utils/logger';

export interface DailyOpsOptions {
  dataStore: DataStore;
  /** Mode-appropriate fulfillment: direct confirm or Razorpay payment link. */
  fulfillment: OrderFulfillment;
  notifier: DeliveryNotifier;
  /** Owner numbers for stock-shortage alerts. */
  owners: string[];
  ownerSender: MessageSender;
  /** HH:mm — when subscriptions materialize into orders. */
  recurringTime?: string;
  /** HH:mm — when customers get "delivery today" reminders. */
  reminderTime?: string;
}

function cronFor(time: string): string {
  const [hour, minute] = time.split(':').map(Number);
  return `${minute} ${hour} * * *`;
}

/**
 * Daily business automation:
 *  - materializes due recurring orders into real orders each morning
 *  - sends customers a reminder on the day of their delivery
 *
 * Both runs are also invokable on demand (owner command "recurring run").
 */
export class DailyOpsScheduler {
  private jobs: cron.ScheduledTask[] = [];

  constructor(private options: DailyOpsOptions) {}

  start(): void {
    const recurringTime = this.options.recurringTime || '07:00';
    const reminderTime = this.options.reminderTime || '08:30';

    this.jobs.push(cron.schedule(cronFor(recurringTime), async () => {
      logger.info('Recurring-order materialization triggered');
      await this.runRecurringOnce();
    }));

    this.jobs.push(cron.schedule(cronFor(reminderTime), async () => {
      logger.info('Delivery reminder run triggered');
      await this.runRemindersOnce();
    }));

    logger.info({ recurringTime, reminderTime }, 'Daily ops scheduler started');
  }

  stop(): void {
    for (const job of this.jobs) job.stop();
    this.jobs = [];
    logger.info('Daily ops scheduler stopped');
  }

  /**
   * Create a real order for every ACTIVE subscription that is due
   * (next_date <= today). Each subscription advances to its next date whether
   * the cycle fulfilled or was skipped for stock — a skipped cycle alerts the
   * owners instead of silently retrying and delivering late.
   */
  async runRecurringOnce(today: string = new Date().toISOString().split('T')[0]): Promise<{ created: number; skipped: number }> {
    const { dataStore, fulfillment, notifier, owners, ownerSender } = this.options;
    let created = 0;
    let skipped = 0;

    const subscriptions = await dataStore.getAllRecurringOrders();
    const due = subscriptions.filter(r => r.status === 'ACTIVE' && r.next_date && r.next_date <= today);

    for (const sub of due) {
      const nextDate = nextOccurrence(sub.frequency, sub.day, today);
      try {
        const inventory = await dataStore.getAllInventory();

        // Every line item must be available or the whole cycle is skipped —
        // partial bouquet deliveries would surprise the customer.
        const lines = parseItems(sub.items, sub.quantity).map(spec => ({
          spec,
          flower: inventory.find(i => i.item_name.toLowerCase() === spec.name.toLowerCase())
        }));
        const shortages = lines
          .filter(line => !line.flower || line.flower.quantity < line.spec.quantity)
          .map(line => `${line.spec.name}: need ${line.spec.quantity}, have ${line.flower?.quantity ?? 0}`);

        if (lines.length === 0 || shortages.length > 0) {
          skipped++;
          logger.warn({
            recurring_id: sub.recurring_id,
            items: sub.items,
            shortages
          }, 'Recurring order skipped: insufficient stock');

          await this.notifySkipped(sub, nextDate, shortages.join('\n'));
          await dataStore.updateRecurringOrder(sub.recurring_id, { next_date: nextDate });
          continue;
        }

        const items = lines.map(line => ({ flower: line.flower!, quantity: line.spec.quantity }));
        await fulfillment.fulfill({
          phone: sub.customer_phone,
          orderId: generateOrderId(),
          items,
          // If the bot was down past the scheduled date, deliver today
          deliveryDate: sub.next_date > today ? sub.next_date : today,
          // Reprice each cycle from current unit prices
          totalPrice: items.reduce((sum, item) => sum + item.quantity * item.flower.unit_price, 0),
          language: (sub.language || 'en') as Language
        });

        await dataStore.updateRecurringOrder(sub.recurring_id, { next_date: nextDate });
        created++;
        logger.info({ recurring_id: sub.recurring_id, next_date: nextDate }, 'Recurring order materialized');
      } catch (error) {
        // Leave next_date untouched so the failed cycle retries tomorrow
        skipped++;
        logger.error({ error, recurring_id: sub.recurring_id }, 'Failed to materialize recurring order');
      }
    }

    if (due.length > 0) {
      logger.info({ due: due.length, created, skipped }, 'Recurring run complete');
    }
    return { created, skipped };
  }

  private async notifySkipped(sub: RecurringOrder, nextDate: string, shortages: string): Promise<void> {
    const lang = (sub.language || 'en') as Language;
    await this.options.notifier.sendCustomMessage(
      sub.customer_phone,
      formatResponse(responses.recurring_skipped_stock[lang], {
        items: displayItems(sub.items, sub.quantity),
        date: nextDate
      })
    );

    const ownerAlert = `⚠️ Recurring order SKIPPED — not enough stock\n\n${sub.recurring_id}: ${displayItems(sub.items, sub.quantity)} for ${sub.customer_phone}\n${shortages}\n\nRestock and use "recurring run" to retry, or contact the customer.`;
    await this.options.ownerSender.sendMessageToMultiple(this.options.owners, ownerAlert);
  }

  /**
   * Remind every customer whose confirmed order is scheduled for today.
   * PENDING_PAYMENT orders are excluded — nothing ships until payment.
   */
  async runRemindersOnce(today: string = new Date().toISOString().split('T')[0]): Promise<number> {
    const { dataStore, notifier } = this.options;
    const orders = await dataStore.getOrdersByDate(today);
    const toRemind = orders.filter(o => o.status === 'CONFIRMED' || o.status === 'RESCHEDULED');

    let sent = 0;
    for (const order of toRemind) {
      const delivered = await notifier.notifyDeliveryReminder(order);
      if (delivered) {
        sent++;
      } else {
        logger.error({ order_id: order.order_id }, 'Failed to send delivery reminder');
      }
    }

    if (toRemind.length > 0) {
      logger.info({ reminders: sent }, 'Delivery reminders sent');
    }
    return sent;
  }
}
