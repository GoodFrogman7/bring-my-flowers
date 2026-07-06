import { describe, it, expect, vi } from 'vitest';
import { MessageHandler } from '../src/handlers/messageHandler';
import { OrderFulfillment, FulfillmentContext } from '../src/handlers/orderFulfillment';
import { DeliveryNotifier } from '../src/notifications/deliveryNotifier';
import { OllamaClient } from '../src/llm/ollama';
import { MessageIntent } from '../src/types';
import { InMemoryDataStore, FakeSender, fakeOllama, rose, order } from './helpers';

const PHONE = '+919876543210';

function setup(options: { confirmationRequired?: boolean; rateLimitPerMinute?: number } = {}) {
  const store = new InMemoryDataStore();
  store.inventory.push(rose());
  store.inventory.push(rose({ item_name: 'Lilies', quantity: 5, unit_price: 80 }));

  const sender = new FakeSender();
  const notifier = new DeliveryNotifier(sender);
  const ollama = fakeOllama();

  const fulfilled: FulfillmentContext[] = [];
  const fulfillment: OrderFulfillment = {
    fulfill: async ctx => {
      fulfilled.push(ctx);
    }
  };

  const handler = new MessageHandler({
    ollamaClient: ollama as unknown as OllamaClient,
    dataStore: store,
    notifier,
    fulfillment,
    confirmationRequired: options.confirmationRequired ?? false,
    rateLimitPerMinute: options.rateLimitPerMinute
  });

  return { store, sender, ollama, fulfilled, handler };
}

function classifyAs(ollama: ReturnType<typeof fakeOllama>, intent: MessageIntent, extra: object = {}) {
  ollama.classifyMessage.mockResolvedValue({
    intent,
    customer_phone: PHONE,
    confidence: 0.9,
    ...extra
  });
}

describe('order conversation flow', () => {
  it('starts a draft from an ORDER message and asks for the missing quantity', async () => {
    const { sender, ollama, handler } = setup();
    classifyAs(ollama, MessageIntent.ORDER);
    ollama.extractOrderDetails.mockResolvedValue({ items: [{ flowers: 'roses', quantity: null }], quantity: null, date: null });

    await handler.handleMessage(PHONE, 'I want roses');

    expect(ollama.generateOrderResponse).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'missing_quantity', matchedFlower: 'Roses' })
    );
    expect(sender.lastMessage()).toBe('ask:missing_quantity');
  });

  it('fills quantity from a bare-number reply without calling the LLM extractor', async () => {
    const { sender, ollama, handler } = setup();
    classifyAs(ollama, MessageIntent.ORDER);
    ollama.extractOrderDetails.mockResolvedValue({ items: [{ flowers: 'roses', quantity: null }], quantity: null, date: null });

    await handler.handleMessage(PHONE, 'I want roses');
    ollama.extractOrderDetails.mockClear();

    await handler.handleMessage(PHONE, '10');

    expect(ollama.extractOrderDetails).not.toHaveBeenCalled();
    expect(sender.lastMessage()).toBe('ask:missing_date');
  });

  it('collects slots across messages and fulfills the completed order', async () => {
    const { ollama, fulfilled, handler } = setup();
    classifyAs(ollama, MessageIntent.ORDER);
    ollama.extractOrderDetails.mockResolvedValueOnce({ items: [{ flowers: 'roses', quantity: null }], quantity: null, date: null });

    await handler.handleMessage(PHONE, 'I want roses');
    await handler.handleMessage(PHONE, '10');

    ollama.extractOrderDetails.mockResolvedValueOnce({ items: [], quantity: null, date: '2099-07-06' });
    await handler.handleMessage(PHONE, 'tomorrow');

    expect(fulfilled).toHaveLength(1);
    expect(fulfilled[0]).toMatchObject({
      phone: PHONE,
      deliveryDate: '2099-07-06',
      totalPrice: 500
    });
    expect(fulfilled[0].items).toHaveLength(1);
    expect(fulfilled[0].items[0].flower.item_name).toBe('Roses');
    expect(fulfilled[0].items[0].quantity).toBe(10);
    expect(fulfilled[0].orderId).toMatch(/^ORD-/);
  });

  it('fulfills a one-shot message that contains every slot', async () => {
    const { ollama, fulfilled, handler } = setup();
    classifyAs(ollama, MessageIntent.ORDER);
    ollama.extractOrderDetails.mockResolvedValue({ items: [{ flowers: 'rozes', quantity: 5 }], quantity: null, date: '2099-07-06' });

    await handler.handleMessage(PHONE, 'I want 5 rozes for the 6th');

    expect(fulfilled).toHaveLength(1);
    // Fuzzy match resolved the typo to the inventory name
    expect(fulfilled[0].items[0].flower.item_name).toBe('Roses');
    expect(fulfilled[0].totalPrice).toBe(250);
  });

  it('re-asks with the flower list when nothing in inventory matches', async () => {
    const { sender, ollama, handler } = setup();
    classifyAs(ollama, MessageIntent.ORDER);
    ollama.extractOrderDetails.mockResolvedValue({ items: [{ flowers: 'sunflowers', quantity: 3 }], quantity: null, date: null });

    await handler.handleMessage(PHONE, 'I want 3 sunflowers');

    expect(ollama.generateOrderResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'no_match',
        availableFlowers: ['Roses', 'Lilies']
      })
    );
    expect(sender.lastMessage()).toBe('ask:no_match');
  });

  it('re-asks when the requested quantity exceeds stock', async () => {
    const { ollama, handler, fulfilled } = setup();
    classifyAs(ollama, MessageIntent.ORDER);
    ollama.extractOrderDetails.mockResolvedValue({ items: [{ flowers: 'lilies', quantity: 50 }], quantity: null, date: '2099-07-06' });

    await handler.handleMessage(PHONE, '50 lilies please');

    expect(ollama.generateOrderResponse).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'low_stock', flowerStock: 5, matchedFlower: 'Lilies' })
    );
    expect(fulfilled).toHaveLength(0);
  });

  it('aborts an in-flight draft on "never mind"', async () => {
    const { sender, ollama, handler } = setup();
    classifyAs(ollama, MessageIntent.ORDER);
    ollama.extractOrderDetails.mockResolvedValue({ items: [{ flowers: 'roses', quantity: null }], quantity: null, date: null });

    await handler.handleMessage(PHONE, 'I want roses');
    ollama.classifyMessage.mockClear();

    await handler.handleMessage(PHONE, 'never mind');
    expect(sender.lastMessage()).toContain("cleared that order request");

    // Next message is classified fresh — the session is gone
    classifyAs(ollama, MessageIntent.UNKNOWN);
    await handler.handleMessage(PHONE, 'hello');
    expect(ollama.classifyMessage).toHaveBeenCalledTimes(1);
  });
});

describe('multi-item orders', () => {
  it('fulfills an order with two flowers in one message', async () => {
    const { ollama, fulfilled, handler } = setup();
    classifyAs(ollama, MessageIntent.ORDER);
    ollama.extractOrderDetails.mockResolvedValue({
      items: [{ flowers: 'roses', quantity: 5 }, { flowers: 'lillies', quantity: 3 }],
      quantity: null,
      date: '2099-07-06'
    });

    await handler.handleMessage(PHONE, '5 roses and 3 lillies for the 6th');

    expect(fulfilled).toHaveLength(1);
    expect(fulfilled[0].items.map(i => `${i.quantity} ${i.flower.item_name}`)).toEqual(['5 Roses', '3 Lilies']);
    expect(fulfilled[0].totalPrice).toBe(5 * 50 + 3 * 80);
  });

  it('asks for the quantity of the specific flower that lacks one', async () => {
    const { sender, ollama, handler, fulfilled } = setup();
    classifyAs(ollama, MessageIntent.ORDER);
    ollama.extractOrderDetails.mockResolvedValueOnce({
      items: [{ flowers: 'roses', quantity: 5 }, { flowers: 'lilies', quantity: null }],
      quantity: null,
      date: '2099-07-06'
    });

    await handler.handleMessage(PHONE, '5 roses and some lilies for the 6th');

    expect(ollama.generateOrderResponse).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'missing_quantity', matchedFlower: 'Lilies' })
    );

    // Bare number fills the lily line, completing the order
    await handler.handleMessage(PHONE, '3');
    expect(fulfilled).toHaveLength(1);
    expect(fulfilled[0].items[1]).toMatchObject({ quantity: 3 });
  });

  it('blocks the whole order when one line is out of stock', async () => {
    const { ollama, handler, fulfilled } = setup();
    classifyAs(ollama, MessageIntent.ORDER);
    ollama.extractOrderDetails.mockResolvedValue({
      items: [{ flowers: 'roses', quantity: 5 }, { flowers: 'lilies', quantity: 50 }],
      quantity: null,
      date: '2099-07-06'
    });

    await handler.handleMessage(PHONE, '5 roses and 50 lilies');

    expect(ollama.generateOrderResponse).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'low_stock', matchedFlower: 'Lilies', flowerStock: 5 })
    );
    expect(fulfilled).toHaveLength(0);
  });

  it('merges duplicate mentions of the same flower', async () => {
    const { ollama, fulfilled, handler } = setup();
    classifyAs(ollama, MessageIntent.ORDER);
    ollama.extractOrderDetails.mockResolvedValue({
      items: [{ flowers: 'roses', quantity: 5 }, { flowers: 'rose', quantity: 3 }],
      quantity: null,
      date: '2099-07-06'
    });

    await handler.handleMessage(PHONE, '5 roses and 3 more roses');

    expect(fulfilled).toHaveLength(1);
    expect(fulfilled[0].items).toHaveLength(1);
    expect(fulfilled[0].items[0]).toMatchObject({ quantity: 8 });
  });

  it('shows every line in the confirmation summary', async () => {
    const { sender, ollama, handler } = setup({ confirmationRequired: true });
    classifyAs(ollama, MessageIntent.ORDER);
    ollama.extractOrderDetails.mockResolvedValue({
      items: [{ flowers: 'roses', quantity: 5 }, { flowers: 'lilies', quantity: 3 }],
      quantity: null,
      date: '2099-07-06'
    });

    await handler.handleMessage(PHONE, '5 roses and 3 lilies for the 6th');

    expect(sender.lastMessage()).toContain('5 Roses — ₹250');
    expect(sender.lastMessage()).toContain('3 Lilies — ₹240');
    expect(sender.lastMessage()).toContain('Total: ₹490');
  });
});

describe('order confirmation', () => {
  async function driveToConfirmation(ctx: ReturnType<typeof setup>) {
    classifyAs(ctx.ollama, MessageIntent.ORDER);
    ctx.ollama.extractOrderDetails.mockResolvedValue({ items: [{ flowers: 'roses', quantity: 10 }], quantity: null, date: '2099-07-06' });
    await ctx.handler.handleMessage(PHONE, 'I want 10 roses on the 6th');
  }

  it('summarizes the order and waits for YES when confirmation is required', async () => {
    const ctx = setup({ confirmationRequired: true });
    await driveToConfirmation(ctx);

    expect(ctx.sender.lastMessage()).toContain('10 Roses — ₹500');
    expect(ctx.sender.lastMessage()).toContain('Reply YES');
    expect(ctx.fulfilled).toHaveLength(0);

    await ctx.handler.handleMessage(PHONE, 'yes');
    expect(ctx.fulfilled).toHaveLength(1);
  });

  it('cancels the draft on NO', async () => {
    const ctx = setup({ confirmationRequired: true });
    await driveToConfirmation(ctx);

    await ctx.handler.handleMessage(PHONE, 'no');

    expect(ctx.fulfilled).toHaveLength(0);
    expect(ctx.sender.lastMessage()).toContain('cancelled that order request');
  });

  it('treats a non-yes/no reply as a correction to the draft', async () => {
    const ctx = setup({ confirmationRequired: true });
    await driveToConfirmation(ctx);

    // "make it 5" re-extracts and produces an updated confirmation
    ctx.ollama.extractOrderDetails.mockResolvedValue({ items: [], quantity: 5, date: null });
    await ctx.handler.handleMessage(PHONE, 'make it 5 instead');

    expect(ctx.sender.lastMessage()).toContain('5 Roses — ₹250');
    expect(ctx.fulfilled).toHaveLength(0);
  });
});

describe('intent routing', () => {
  it('cancels the upcoming order and returns stock on NO_DELIVERY', async () => {
    const { store, sender, ollama, handler } = setup();
    store.orders.push(order({ order_id: 'ORD-42', quantity: 10 }));
    classifyAs(ollama, MessageIntent.NO_DELIVERY, { reason: 'travelling' });

    await handler.handleMessage(PHONE, 'no delivery today');

    expect(store.orders[0].status).toBe('CANCELED');
    expect(store.orders[0].notes).toBe('travelling');
    expect(store.inventory.find(i => i.item_name === 'Roses')?.quantity).toBe(110);
    expect(sender.lastMessage()).toContain('Delivery Canceled');
  });

  it('apologizes when there is no upcoming order to cancel', async () => {
    const { sender, ollama, handler } = setup();
    classifyAs(ollama, MessageIntent.NO_DELIVERY);

    await handler.handleMessage(PHONE, 'cancel my order');

    expect(sender.lastMessage()).toContain("couldn't find any upcoming delivery");
  });

  it('asks for a date when RESCHEDULE comes without one', async () => {
    const { sender, ollama, handler } = setup();
    classifyAs(ollama, MessageIntent.RESCHEDULE);

    await handler.handleMessage(PHONE, 'change my delivery');

    expect(sender.lastMessage()).toContain('specify the new date');
  });

  it('reschedules the upcoming order when a date is given', async () => {
    const { store, ollama, handler } = setup();
    store.orders.push(order({ order_id: 'ORD-42', date: '2099-01-01' }));
    classifyAs(ollama, MessageIntent.RESCHEDULE, { date: '2099-02-02' });

    await handler.handleMessage(PHONE, 'deliver on feb 2 instead');

    expect(store.orders[0].date).toBe('2099-02-02');
  });

  it('answers inquiries with inventory context via the LLM', async () => {
    const { sender, ollama, handler } = setup();
    classifyAs(ollama, MessageIntent.INQUIRY);
    ollama.generate.mockResolvedValue('Yes, we have roses at ₹50 per stem!');

    await handler.handleMessage(PHONE, 'do you have roses?');

    const prompt = ollama.generate.mock.calls[0][0] as string;
    expect(prompt).toContain('Roses');
    expect(sender.lastMessage()).toBe('Yes, we have roses at ₹50 per stem!');
  });

  it('falls back to a friendly reply for UNKNOWN intent', async () => {
    const { sender, ollama, handler } = setup();
    classifyAs(ollama, MessageIntent.UNKNOWN);
    ollama.generate.mockResolvedValue('Hi! How can I help?');

    await handler.handleMessage(PHONE, 'hi');

    expect(sender.lastMessage()).toBe('Hi! How can I help?');
  });
});

describe('robustness', () => {
  it('rate-limits a customer after the configured number of messages', async () => {
    const { sender, ollama, handler } = setup({ rateLimitPerMinute: 2 });
    classifyAs(ollama, MessageIntent.UNKNOWN);

    await handler.handleMessage(PHONE, 'one');
    await handler.handleMessage(PHONE, 'two');
    await handler.handleMessage(PHONE, 'three');

    expect(ollama.classifyMessage).toHaveBeenCalledTimes(2);
    expect(sender.lastMessage()).toContain('too quickly');
  });

  it('keeps the draft when LLM extraction fails and re-asks', async () => {
    const { sender, ollama, handler, fulfilled } = setup();
    classifyAs(ollama, MessageIntent.ORDER);
    ollama.extractOrderDetails.mockResolvedValueOnce({ items: [{ flowers: 'roses', quantity: null }], quantity: null, date: null });

    await handler.handleMessage(PHONE, 'I want roses');

    ollama.extractOrderDetails.mockRejectedValueOnce(new Error('ollama down'));
    await handler.handleMessage(PHONE, 'some day next week maybe');

    // Draft survived: flower is still known, so it re-asks for quantity
    expect(sender.lastMessage()).toBe('ask:missing_quantity');
    expect(fulfilled).toHaveLength(0);
  });

  it('clears the session and apologizes when handling blows up', async () => {
    const { store, sender, ollama, handler } = setup();
    classifyAs(ollama, MessageIntent.ORDER);
    ollama.extractOrderDetails.mockResolvedValue({ items: [{ flowers: 'roses', quantity: null }], quantity: null, date: null });
    await handler.handleMessage(PHONE, 'I want roses');

    vi.spyOn(store, 'getAllInventory').mockRejectedValueOnce(new Error('sheet unreachable'));
    await handler.handleMessage(PHONE, '10');

    expect(sender.lastMessage()).toContain('encountered an error');

    // Session was dropped: the next message goes through classification again
    ollama.classifyMessage.mockClear();
    classifyAs(ollama, MessageIntent.UNKNOWN);
    await handler.handleMessage(PHONE, 'hello');
    expect(ollama.classifyMessage).toHaveBeenCalledTimes(1);
  });
});
