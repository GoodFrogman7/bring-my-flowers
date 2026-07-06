import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { Server } from 'http';
import { AddressInfo } from 'net';
import { createServer } from '../src/server';
import { RazorpayClient } from '../src/payment/razorpayClient';
import { MessageHandler } from '../src/handlers/messageHandler';
import { CalendarManager } from '../src/calendar/calendarManager';
import { InMemoryDataStore, FakeSender, order, rose } from './helpers';

const WEBHOOK_SECRET = 'whsec_test_secret';

function razorpaySign(body: string): string {
  return crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
}

let server: Server;
let baseUrl: string;
let store: InMemoryDataStore;
let sender: FakeSender;
let calendar: { createDeliveryEvent: ReturnType<typeof vi.fn> };
let handleMessage: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  store = new InMemoryDataStore();
  sender = new FakeSender();
  calendar = { createDeliveryEvent: vi.fn(async () => {}) };
  handleMessage = vi.fn(async () => {});

  const razorpayClient = new RazorpayClient('rzp_test_key', 'test_key_secret', WEBHOOK_SECRET);

  server = createServer({
    messageHandler: { handleMessage } as unknown as MessageHandler,
    voice: undefined,
    payment: {
      razorpayClient,
      dataStore: store,
      calendarManager: calendar as unknown as CalendarManager,
      whatsappBot: sender
    }
  }, 0);

  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterEach(() => {
  server.close();
});

function paymentEvent(event: string, orderId: string, paymentId?: string) {
  return JSON.stringify({
    event,
    payload: {
      payment_link: {
        entity: {
          notes: { order_id: orderId },
          ...(paymentId ? { payments: [{ payment_id: paymentId }] } : {})
        }
      }
    }
  });
}

function postPayment(body: string, signature: string = razorpaySign(body)) {
  return fetch(`${baseUrl}/webhook/payment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-razorpay-signature': signature
    },
    body
  });
}

describe('POST /webhook/payment', () => {
  it('rejects a body with an invalid signature and changes nothing', async () => {
    store.orders.push(order({ order_id: 'ORD-9', status: 'PENDING_PAYMENT' }));

    const res = await postPayment(paymentEvent('payment_link.paid', 'ORD-9', 'pay_1'), 'bad-signature');

    expect(res.status).toBe(400);
    expect(store.orders[0].status).toBe('PENDING_PAYMENT');
  });

  it('rejects a tampered body signed for different content', async () => {
    const original = paymentEvent('payment_link.paid', 'ORD-9', 'pay_1');
    const tampered = paymentEvent('payment_link.paid', 'ORD-OTHER', 'pay_1');

    const res = await postPayment(tampered, razorpaySign(original));

    expect(res.status).toBe(400);
  });

  it('confirms the order on payment_link.paid', async () => {
    store.orders.push(order({ order_id: 'ORD-9', status: 'PENDING_PAYMENT', amount: 500 }));

    const res = await postPayment(paymentEvent('payment_link.paid', 'ORD-9', 'pay_123'));

    expect(res.status).toBe(200);
    expect(store.orders[0].status).toBe('CONFIRMED');
    expect(store.orders[0].payment_id).toBe('pay_123');
    expect(store.orders[0].payment_status).toBe('PAID');
    expect(calendar.createDeliveryEvent).toHaveBeenCalledOnce();
    expect(sender.lastMessage()).toContain('Payment received');
    expect(sender.sent[0].to).toBe(store.orders[0].customer_phone);
  });

  it('cancels the order and returns stock on payment_link.expired', async () => {
    store.inventory.push(rose({ quantity: 90 }));
    store.orders.push(order({ order_id: 'ORD-9', status: 'PENDING_PAYMENT', items: 'Roses', quantity: 10 }));

    const res = await postPayment(paymentEvent('payment_link.expired', 'ORD-9'));

    expect(res.status).toBe(200);
    expect(store.orders[0].status).toBe('CANCELED');
    expect(store.inventory[0].quantity).toBe(100);
    expect(sender.lastMessage()).toContain('expired');
  });

  it('returns per-item stock for a multi-item order on expiry', async () => {
    store.inventory.push(rose({ quantity: 90 }));
    store.inventory.push(rose({ item_name: 'Lilies', quantity: 17 }));
    store.orders.push(order({
      order_id: 'ORD-9',
      status: 'PENDING_PAYMENT',
      items: '10 Roses, 3 Lilies',
      quantity: 13
    }));

    const res = await postPayment(paymentEvent('payment_link.expired', 'ORD-9'));

    expect(res.status).toBe(200);
    expect(store.inventory[0].quantity).toBe(100);
    expect(store.inventory[1].quantity).toBe(20);
  });

  it('ignores expiry for an order that is no longer pending payment', async () => {
    store.inventory.push(rose({ quantity: 90 }));
    store.orders.push(order({ order_id: 'ORD-9', status: 'CONFIRMED', items: 'Roses', quantity: 10 }));

    const res = await postPayment(paymentEvent('payment_link.expired', 'ORD-9'));

    expect(res.status).toBe(200);
    expect(store.orders[0].status).toBe('CONFIRMED');
    expect(store.inventory[0].quantity).toBe(90);
    expect(sender.sent).toHaveLength(0);
  });

  it('acknowledges but ignores events without an order_id note', async () => {
    const body = JSON.stringify({ event: 'payment_link.paid', payload: {} });

    const res = await postPayment(body);

    expect(res.status).toBe(200);
    expect(sender.sent).toHaveLength(0);
  });
});

describe('POST /webhook/whatsapp', () => {
  it('strips the whatsapp: prefix and dispatches to the message handler', async () => {
    const res = await fetch(`${baseUrl}/webhook/whatsapp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ From: 'whatsapp:+919876543210', Body: 'hello' }).toString()
    });

    expect(res.status).toBe(200);
    expect(handleMessage).toHaveBeenCalledWith('+919876543210', 'hello');
  });
});

describe('GET /health', () => {
  it('reports which features are enabled', async () => {
    const res = await fetch(`${baseUrl}/health`);
    const body = await res.json() as { status: string; features: Record<string, boolean> };

    expect(body.status).toBe('ok');
    expect(body.features).toEqual({ whatsapp: true, voice: false, payment: true });
  });
});

describe('RazorpayClient.verifyWebhookSignature', () => {
  it('accepts the correct HMAC and rejects a wrong one', () => {
    const client = new RazorpayClient('rzp_test_key', 'test_key_secret', WEBHOOK_SECRET);
    const body = Buffer.from('{"event":"payment_link.paid"}');

    expect(client.verifyWebhookSignature(body, razorpaySign(body.toString()))).toBe(true);
    expect(client.verifyWebhookSignature(body, 'deadbeef')).toBe(false);
    expect(client.verifyWebhookSignature(body, '')).toBe(false);
  });

  it('rejects everything when no webhook secret is configured', () => {
    const client = new RazorpayClient('rzp_test_key', 'test_key_secret');
    const body = Buffer.from('{"event":"payment_link.paid"}');

    expect(client.verifyWebhookSignature(body, razorpaySign(body.toString()))).toBe(false);
  });
});
