import { describe, it, expect, vi } from 'vitest';
import { MessageHandler } from '../src/handlers/messageHandler';
import { OwnerCommandHandler } from '../src/handlers/ownerCommands';
import { OrderFulfillment, FulfillmentContext } from '../src/handlers/orderFulfillment';
import { DeliveryNotifier } from '../src/notifications/deliveryNotifier';
import { OllamaClient } from '../src/llm/ollama';
import { MessageIntent } from '../src/types';
import { InMemoryDataStore, FakeSender, fakeOllama, rose, recurring } from './helpers';

const PHONE = '+919876543210';
const OWNER = '+919999999999';

function setup() {
  const store = new InMemoryDataStore();
  store.inventory.push(rose());
  const sender = new FakeSender();
  const notifier = new DeliveryNotifier(sender);
  const ollama = fakeOllama();
  const fulfilled: FulfillmentContext[] = [];
  const fulfillment: OrderFulfillment = { fulfill: async ctx => { fulfilled.push(ctx); } };

  const ownerCommands = new OwnerCommandHandler({
    dataStore: store,
    notifier,
    sender,
    owners: [OWNER]
  });

  const handler = new MessageHandler({
    ollamaClient: ollama as unknown as OllamaClient,
    dataStore: store,
    notifier,
    fulfillment,
    ownerCommands
  });

  return { store, sender, ollama, fulfilled, handler };
}

describe('owner routing', () => {
  it('owner messages go to the command channel, never the customer flow', async () => {
    const { sender, ollama, handler } = setup();

    await handler.handleMessage(OWNER, 'help');

    expect(ollama.classifyMessage).not.toHaveBeenCalled();
    expect(sender.lastMessage()).toContain('Owner commands');
  });

  it('customer messages never reach the command channel', async () => {
    const { sender, ollama, handler } = setup();
    ollama.classifyMessage.mockResolvedValue({
      intent: MessageIntent.UNKNOWN, customer_phone: PHONE, confidence: 0.9
    });
    ollama.generate.mockResolvedValue('Hello!');

    await handler.handleMessage(PHONE, 'help');

    expect(sender.lastMessage()).toBe('Hello!');
  });
});

describe('subscription creation flow', () => {
  function classifyRecurring(ollama: ReturnType<typeof fakeOllama>) {
    ollama.classifyMessage.mockResolvedValue({
      intent: MessageIntent.RECURRING, customer_phone: PHONE, confidence: 0.9
    });
  }

  it('creates a weekly subscription from a complete message after confirmation', async () => {
    const { store, sender, ollama, handler } = setup();
    classifyRecurring(ollama);
    ollama.extractOrderDetails.mockResolvedValue({ flowers: 'roses', quantity: 10, date: null });

    await handler.handleMessage(PHONE, 'I want 10 roses every monday');

    expect(sender.lastMessage()).toContain('10 Roses every Monday — ₹500 per delivery');
    expect(sender.lastMessage()).toContain('Reply YES');
    expect(store.recurring).toHaveLength(0);

    await handler.handleMessage(PHONE, 'yes');

    expect(store.recurring).toHaveLength(1);
    expect(store.recurring[0]).toMatchObject({
      customer_phone: PHONE,
      items: 'Roses',
      quantity: 10,
      frequency: 'WEEKLY',
      day: 1,
      status: 'ACTIVE',
      amount: 500
    });
    expect(store.recurring[0].recurring_id).toMatch(/^REC-/);
    expect(store.recurring[0].next_date > new Date().toISOString().split('T')[0]).toBe(true);
    expect(sender.lastMessage()).toContain('Subscription confirmed');
  });

  it('asks for the weekday when the cadence has no day, then parses the answer locally', async () => {
    const { store, sender, ollama, handler } = setup();
    classifyRecurring(ollama);
    ollama.extractOrderDetails.mockResolvedValue({ flowers: 'roses', quantity: 5, date: null });

    await handler.handleMessage(PHONE, '5 roses every week');
    expect(sender.lastMessage()).toContain('Which day');

    ollama.extractOrderDetails.mockClear();
    await handler.handleMessage(PHONE, 'friday');

    expect(ollama.extractOrderDetails).not.toHaveBeenCalled();
    expect(sender.lastMessage()).toContain('every Friday');

    await handler.handleMessage(PHONE, 'yes');
    expect(store.recurring[0].day).toBe(5);
  });

  it('collects quantity first, then the day of month for monthly subscriptions', async () => {
    const { store, sender, ollama, handler } = setup();
    classifyRecurring(ollama);
    ollama.extractOrderDetails.mockResolvedValue({ flowers: 'roses', quantity: null, date: null });

    await handler.handleMessage(PHONE, 'roses every month');
    expect(sender.lastMessage()).toBe('ask:missing_quantity');

    await handler.handleMessage(PHONE, '12');
    expect(sender.lastMessage()).toContain('day of the month');

    await handler.handleMessage(PHONE, '5');
    expect(sender.lastMessage()).toContain('on the 5th of every month');

    await handler.handleMessage(PHONE, 'yes');
    expect(store.recurring[0]).toMatchObject({ frequency: 'MONTHLY', day: 5, quantity: 12 });
  });

  it('NO at confirmation abandons the subscription', async () => {
    const { store, ollama, handler } = setup();
    classifyRecurring(ollama);
    ollama.extractOrderDetails.mockResolvedValue({ flowers: 'roses', quantity: 10, date: null });

    await handler.handleMessage(PHONE, '10 roses every monday');
    await handler.handleMessage(PHONE, 'no');

    expect(store.recurring).toHaveLength(0);
  });

  it('an in-flight one-off order upgrades when the customer adds a cadence', async () => {
    const { store, sender, ollama, handler } = setup();
    ollama.classifyMessage.mockResolvedValue({
      intent: MessageIntent.ORDER, customer_phone: PHONE, confidence: 0.9
    });
    ollama.extractOrderDetails.mockResolvedValue({ flowers: 'roses', quantity: 10, date: null });

    await handler.handleMessage(PHONE, 'I want 10 roses');
    expect(sender.lastMessage()).toBe('ask:missing_date');

    await handler.handleMessage(PHONE, 'actually every monday please');
    expect(sender.lastMessage()).toContain('every Monday');

    await handler.handleMessage(PHONE, 'yes');
    expect(store.recurring).toHaveLength(1);
  });
});

describe('subscription management', () => {
  it('cancel my subscription is handled deterministically without the LLM', async () => {
    const { store, sender, ollama, handler } = setup();
    store.recurring.push(recurring({ recurring_id: 'REC-1', customer_phone: PHONE }));

    await handler.handleMessage(PHONE, 'please cancel my subscription');

    expect(ollama.classifyMessage).not.toHaveBeenCalled();
    expect(store.recurring[0].status).toBe('CANCELLED');
    expect(sender.lastMessage()).toContain('cancelled');
  });

  it('pause and resume round-trip, recomputing the next date', async () => {
    const { store, sender, handler } = setup();
    store.recurring.push(recurring({ recurring_id: 'REC-1', customer_phone: PHONE, next_date: '2020-01-01' }));

    await handler.handleMessage(PHONE, 'pause my subscription');
    expect(store.recurring[0].status).toBe('PAUSED');

    await handler.handleMessage(PHONE, 'resume my subscription');
    expect(store.recurring[0].status).toBe('ACTIVE');
    expect(store.recurring[0].next_date > new Date().toISOString().split('T')[0]).toBe(true);
    expect(sender.lastMessage()).toContain('active again');
  });

  it('with multiple subscriptions it asks which one, then acts on the named ID', async () => {
    const { store, sender, handler } = setup();
    store.recurring.push(recurring({ recurring_id: 'REC-1', customer_phone: PHONE }));
    store.recurring.push(recurring({ recurring_id: 'REC-2', customer_phone: PHONE, items: 'Lilies' }));

    await handler.handleMessage(PHONE, 'cancel my subscription');
    expect(sender.lastMessage()).toContain('which one');
    expect(store.recurring.every(r => r.status === 'ACTIVE')).toBe(true);

    await handler.handleMessage(PHONE, 'cancel subscription REC-2');
    expect(store.recurring[1].status).toBe('CANCELLED');
    expect(store.recurring[0].status).toBe('ACTIVE');
  });

  it('list shows the customer their subscriptions', async () => {
    const { store, sender, handler } = setup();
    store.recurring.push(recurring({ recurring_id: 'REC-1', customer_phone: PHONE }));

    await handler.handleMessage(PHONE, 'what is my subscription status');

    expect(sender.lastMessage()).toContain('REC-1');
    expect(sender.lastMessage()).toContain('every Monday');
  });

  it('managing without any subscription explains how to start one', async () => {
    const { sender, handler } = setup();

    await handler.handleMessage(PHONE, 'cancel my subscription');

    expect(sender.lastMessage()).toContain("don't have an active subscription");
  });

  it('another customer cannot touch someone else\'s subscription', async () => {
    const { store, sender, handler } = setup();
    store.recurring.push(recurring({ recurring_id: 'REC-1', customer_phone: '+92200000000' }));

    await handler.handleMessage(PHONE, 'cancel my subscription REC-1');

    expect(store.recurring[0].status).toBe('ACTIVE');
    expect(sender.lastMessage()).toContain("don't have an active subscription");
  });
});
