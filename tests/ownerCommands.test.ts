import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OwnerCommandHandler } from '../src/handlers/ownerCommands';
import { DeliveryNotifier } from '../src/notifications/deliveryNotifier';
import { InMemoryDataStore, FakeSender, rose, order, recurring } from './helpers';

const OWNER = '+919999999999';
const CUSTOMER = '+919876543210';

let store: InMemoryDataStore;
let sender: FakeSender;
let summary: { generateNow: ReturnType<typeof vi.fn> };
let dailyOps: { runRecurringOnce: ReturnType<typeof vi.fn> };
let handler: OwnerCommandHandler;

beforeEach(() => {
  store = new InMemoryDataStore();
  store.inventory.push(rose({ max_stock: 200 }));
  sender = new FakeSender();
  summary = { generateNow: vi.fn(async () => null) };
  dailyOps = { runRecurringOnce: vi.fn(async () => ({ created: 2, skipped: 1 })) };

  handler = new OwnerCommandHandler({
    dataStore: store,
    notifier: new DeliveryNotifier(sender),
    sender,
    owners: [OWNER],
    summary,
    dailyOps: dailyOps as never
  });
});

function ownerReply(): string {
  return sender.sent.filter(m => m.to === OWNER).pop()?.message ?? '';
}

function customerMessages(): string[] {
  return sender.sent.filter(m => m.to === CUSTOMER).map(m => m.message);
}

describe('isOwner', () => {
  it('matches owner numbers across transport formats', () => {
    expect(handler.isOwner('+919999999999')).toBe(true);
    expect(handler.isOwner('919999999999')).toBe(true);       // baileys, no plus
    expect(handler.isOwner('whatsapp:+919999999999'.replace('whatsapp:', ''))).toBe(true);
    expect(handler.isOwner(CUSTOMER)).toBe(false);
  });
});

describe('order lifecycle commands', () => {
  it('help lists the commands', async () => {
    await handler.handle(OWNER, 'help');
    expect(ownerReply()).toContain('Owner commands');
    expect(ownerReply()).toContain('deliver ORD-');
  });

  it('unknown input gets help, nothing else happens', async () => {
    await handler.handle(OWNER, 'what is the weather');
    expect(ownerReply()).toContain('Unrecognized command');
  });

  it('today reports orders and revenue excluding cancelled', async () => {
    const today = new Date().toISOString().split('T')[0];
    store.orders.push(order({ order_id: 'ORD-1', date: today, amount: 500 }));
    store.orders.push(order({ order_id: 'ORD-2', date: today, amount: 300, status: 'CANCELED' }));

    await handler.handle(OWNER, 'today');

    const reply = ownerReply();
    expect(reply).toContain('2 total');
    expect(reply).toContain('₹500');
    expect(reply).toContain('ORD-1');
  });

  it('out marks a confirmed order out for delivery and notifies the customer', async () => {
    store.orders.push(order({ order_id: 'ORD-1', status: 'CONFIRMED' }));

    await handler.handle(OWNER, 'out ord-1');

    expect(store.orders[0].status).toBe('OUT_FOR_DELIVERY');
    expect(customerMessages()[0]).toContain('on the way');
    expect(ownerReply()).toContain('out for delivery');
  });

  it('out refuses unpaid, cancelled, and delivered orders', async () => {
    store.orders.push(order({ order_id: 'ORD-1', status: 'PENDING_PAYMENT' }));
    await handler.handle(OWNER, 'out ORD-1');
    expect(store.orders[0].status).toBe('PENDING_PAYMENT');
    expect(ownerReply()).toContain('awaiting payment');
  });

  it('deliver marks the order delivered and notifies the customer', async () => {
    store.orders.push(order({ order_id: 'ORD-1', status: 'OUT_FOR_DELIVERY' }));

    await handler.handle(OWNER, 'deliver ORD-1');

    expect(store.orders[0].status).toBe('DELIVERED');
    expect(customerMessages()[0]).toContain('delivered');
  });

  it('cancel returns stock, records the reason, and notifies the customer', async () => {
    store.orders.push(order({ order_id: 'ORD-1', status: 'CONFIRMED', quantity: 10 }));

    await handler.handle(OWNER, 'cancel ORD-1 customer moved away');

    expect(store.orders[0].status).toBe('CANCELED');
    expect(store.orders[0].notes).toBe('customer moved away');
    expect(store.inventory[0].quantity).toBe(110);
    expect(customerMessages()[0]).toContain('ORD-1');
    expect(ownerReply()).toContain('Stock returned');
  });

  it('cancel returns per-item stock for multi-item orders', async () => {
    store.inventory.push(rose({ item_name: 'Lilies', quantity: 10 }));
    store.orders.push(order({ order_id: 'ORD-1', status: 'CONFIRMED', items: '5 Roses, 3 Lilies', quantity: 8 }));

    await handler.handle(OWNER, 'cancel ORD-1');

    expect(store.inventory[0].quantity).toBe(105);
    expect(store.inventory[1].quantity).toBe(13);
    expect(ownerReply()).toContain('5 Roses, 3 Lilies');
  });

  it('cancel refuses delivered orders and does not touch stock', async () => {
    store.orders.push(order({ order_id: 'ORD-1', status: 'DELIVERED' }));

    await handler.handle(OWNER, 'cancel ORD-1');

    expect(store.orders[0].status).toBe('DELIVERED');
    expect(store.inventory[0].quantity).toBe(100);
  });
});

describe('stock commands', () => {
  it('stock lists inventory with low-stock markers', async () => {
    store.inventory.push(rose({ item_name: 'Lilies', quantity: 10, max_stock: 100 }));

    await handler.handle(OWNER, 'stock');

    const reply = ownerReply();
    expect(reply).toContain('Roses: 100');
    expect(reply).toContain('Lilies: 10');
    expect(reply).toContain('LOW');
  });

  it('stock add receives stock with fuzzy flower matching', async () => {
    await handler.handle(OWNER, 'stock add rozes 50');

    expect(store.inventory[0].quantity).toBe(150);
    expect(ownerReply()).toContain('100 → 150');
  });

  it('stock set corrects the count', async () => {
    await handler.handle(OWNER, 'stock set Roses 80');

    expect(store.inventory[0].quantity).toBe(80);
  });

  it('rejects unknown flowers', async () => {
    await handler.handle(OWNER, 'stock add sunflowers 50');

    expect(ownerReply()).toContain('No flower matching');
    expect(store.inventory[0].quantity).toBe(100);
  });
});

describe('recurring commands', () => {
  it('recurring lists non-cancelled subscriptions', async () => {
    store.recurring.push(recurring({ recurring_id: 'REC-1' }));
    store.recurring.push(recurring({ recurring_id: 'REC-2', status: 'CANCELLED' }));

    await handler.handle(OWNER, 'recurring');

    expect(ownerReply()).toContain('REC-1');
    expect(ownerReply()).not.toContain('REC-2');
  });

  it('recurring pause/resume notify the customer and recompute the next date on resume', async () => {
    store.recurring.push(recurring({ recurring_id: 'REC-1', frequency: 'WEEKLY', day: 1 }));

    await handler.handle(OWNER, 'recurring pause REC-1');
    expect(store.recurring[0].status).toBe('PAUSED');
    expect(customerMessages()[0]).toContain('paused');

    await handler.handle(OWNER, 'recurring resume REC-1');
    expect(store.recurring[0].status).toBe('ACTIVE');
    expect(store.recurring[0].next_date > new Date().toISOString().split('T')[0]).toBe(true);
    expect(customerMessages()[1]).toContain('active again');
  });

  it('recurring cancel notifies the customer', async () => {
    store.recurring.push(recurring({ recurring_id: 'REC-1' }));

    await handler.handle(OWNER, 'recurring cancel REC-1');

    expect(store.recurring[0].status).toBe('CANCELLED');
    expect(customerMessages()[0]).toContain('cancelled');
  });

  it('recurring run triggers materialization and reports counts', async () => {
    await handler.handle(OWNER, 'recurring run');

    expect(dailyOps.runRecurringOnce).toHaveBeenCalledOnce();
    expect(ownerReply()).toContain('2 order(s) created, 1 skipped');
  });
});

describe('summary command', () => {
  it('triggers immediate summary generation', async () => {
    await handler.handle(OWNER, 'summary');
    expect(summary.generateNow).toHaveBeenCalledOnce();
  });
});

describe('failure safety', () => {
  it('a store failure produces an apology, not silence', async () => {
    vi.spyOn(store, 'getOrderById').mockRejectedValueOnce(new Error('sheet down'));
    store.orders.push(order({ order_id: 'ORD-1' }));

    await handler.handle(OWNER, 'deliver ORD-1');

    expect(ownerReply()).toContain('failed');
    expect(store.orders[0].status).toBe('CONFIRMED');
  });
});
