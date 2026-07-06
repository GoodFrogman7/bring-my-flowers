import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DailyOpsScheduler } from '../src/scheduler/dailyOps';
import { DeliveryNotifier } from '../src/notifications/deliveryNotifier';
import { OrderFulfillment, FulfillmentContext } from '../src/handlers/orderFulfillment';
import { InMemoryDataStore, FakeSender, rose, order, recurring } from './helpers';

const TODAY = '2026-07-06'; // a Monday
const OWNER = '+919999999999';

let store: InMemoryDataStore;
let sender: FakeSender;
let fulfilled: FulfillmentContext[];
let scheduler: DailyOpsScheduler;

beforeEach(() => {
  store = new InMemoryDataStore();
  store.inventory.push(rose());
  sender = new FakeSender();
  fulfilled = [];

  const fulfillment: OrderFulfillment = {
    fulfill: async ctx => {
      fulfilled.push(ctx);
      // Real fulfillments decrement stock; mirror that so shortage tests are honest
      await store.updateInventory(ctx.flower.item_name, -ctx.quantity);
    }
  };

  scheduler = new DailyOpsScheduler({
    dataStore: store,
    fulfillment,
    notifier: new DeliveryNotifier(sender),
    owners: [OWNER],
    ownerSender: sender
  });
});

describe('runRecurringOnce', () => {
  it('materializes a due subscription and advances next_date', async () => {
    store.recurring.push(recurring({ next_date: TODAY, frequency: 'WEEKLY', day: 1 }));

    const result = await scheduler.runRecurringOnce(TODAY);

    expect(result).toEqual({ created: 1, skipped: 0 });
    expect(fulfilled).toHaveLength(1);
    expect(fulfilled[0]).toMatchObject({
      phone: '+919876543210',
      quantity: 10,
      deliveryDate: TODAY,
      totalPrice: 500
    });
    expect(fulfilled[0].orderId).toMatch(/^ORD-/);
    expect(store.recurring[0].next_date).toBe('2026-07-13');
  });

  it('materializes an overdue subscription for today (bot was down)', async () => {
    store.recurring.push(recurring({ next_date: '2026-07-01', frequency: 'WEEKLY', day: 1 }));

    await scheduler.runRecurringOnce(TODAY);

    expect(fulfilled[0].deliveryDate).toBe(TODAY);
    expect(store.recurring[0].next_date).toBe('2026-07-13');
  });

  it('ignores subscriptions that are not yet due, paused, or cancelled', async () => {
    store.recurring.push(recurring({ recurring_id: 'REC-1', next_date: '2026-07-13' }));
    store.recurring.push(recurring({ recurring_id: 'REC-2', next_date: TODAY, status: 'PAUSED' }));
    store.recurring.push(recurring({ recurring_id: 'REC-3', next_date: TODAY, status: 'CANCELLED' }));

    const result = await scheduler.runRecurringOnce(TODAY);

    expect(result).toEqual({ created: 0, skipped: 0 });
    expect(fulfilled).toHaveLength(0);
    expect(store.recurring[0].next_date).toBe('2026-07-13');
  });

  it('skips a cycle on insufficient stock, alerts owner and customer, still advances', async () => {
    store.inventory[0].quantity = 3;
    store.recurring.push(recurring({ next_date: TODAY, quantity: 10 }));

    const result = await scheduler.runRecurringOnce(TODAY);

    expect(result).toEqual({ created: 0, skipped: 1 });
    expect(fulfilled).toHaveLength(0);
    expect(store.recurring[0].next_date).toBe('2026-07-13');

    const customerMsg = sender.sent.find(m => m.to === '+919876543210');
    expect(customerMsg?.message).toContain("couldn't prepare");
    const ownerMsg = sender.sent.find(m => m.to === OWNER);
    expect(ownerMsg?.message).toContain('SKIPPED');
    expect(ownerMsg?.message).toContain('REC-TEST-1');
  });

  it('a failed fulfillment leaves next_date untouched for a retry tomorrow', async () => {
    store.recurring.push(recurring({ next_date: TODAY }));
    const failing: OrderFulfillment = {
      fulfill: async () => { throw new Error('razorpay down'); }
    };
    const failingScheduler = new DailyOpsScheduler({
      dataStore: store,
      fulfillment: failing,
      notifier: new DeliveryNotifier(sender),
      owners: [OWNER],
      ownerSender: sender
    });

    const result = await failingScheduler.runRecurringOnce(TODAY);

    expect(result).toEqual({ created: 0, skipped: 1 });
    expect(store.recurring[0].next_date).toBe(TODAY);
  });

  it('processes multiple due subscriptions independently', async () => {
    store.inventory[0].quantity = 15;
    store.recurring.push(recurring({ recurring_id: 'REC-A', next_date: TODAY, quantity: 10 }));
    store.recurring.push(recurring({ recurring_id: 'REC-B', next_date: TODAY, quantity: 10, customer_phone: '+922' }));

    const result = await scheduler.runRecurringOnce(TODAY);

    // First consumes 10 of 15; second is short and skips
    expect(result).toEqual({ created: 1, skipped: 1 });
  });
});

describe('runRemindersOnce', () => {
  it('reminds only confirmed/rescheduled orders due today, in the customer language', async () => {
    store.orders.push(order({ order_id: 'ORD-1', date: TODAY, status: 'CONFIRMED' }));
    store.orders.push(order({ order_id: 'ORD-2', date: TODAY, status: 'RESCHEDULED', customer_phone: '+922', language: 'hi' }));
    store.orders.push(order({ order_id: 'ORD-3', date: TODAY, status: 'PENDING_PAYMENT', customer_phone: '+933' }));
    store.orders.push(order({ order_id: 'ORD-4', date: TODAY, status: 'CANCELED', customer_phone: '+944' }));
    store.orders.push(order({ order_id: 'ORD-5', date: '2026-07-07', status: 'CONFIRMED', customer_phone: '+955' }));

    const sent = await scheduler.runRemindersOnce(TODAY);

    expect(sent).toBe(2);
    expect(sender.sent).toHaveLength(2);
    expect(sender.sent[0].message).toContain('ORD-1');
    expect(sender.sent[1].to).toBe('+922');
    expect(sender.sent[1].message).toContain('रिमाइंडर');
  });

  it('one failed send does not stop the rest', async () => {
    store.orders.push(order({ order_id: 'ORD-1', date: TODAY, status: 'CONFIRMED' }));
    store.orders.push(order({ order_id: 'ORD-2', date: TODAY, status: 'CONFIRMED', customer_phone: '+922' }));

    const flaky = vi.spyOn(sender, 'sendMessage')
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue(true);

    const sent = await scheduler.runRemindersOnce(TODAY);

    expect(sent).toBe(1);
    expect(flaky).toHaveBeenCalledTimes(2);
  });
});
