import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import { AddressInfo } from 'net';
import { openDb, BusinessDb } from '../src/business/db';
import { insertGroupMessage, processGroupMessages } from '../src/business/groupUpdates';
import { startDashboard } from '../src/dashboard/dashboard';

const TODAY = '2026-07-14';

let db: BusinessDb;
let server: http.Server;
let base: string;

async function request(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  const text = await response.text();
  return { status: response.status, json: text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text };
}

beforeEach(async () => {
  db = openDb(':memory:');
  db.prepare(`INSERT INTO customers (id, name, phones, address, zone)
              VALUES ('500', 'Dash Customer', '9811110000', 'C-1', 'Zone A')`).run();
  db.prepare(`INSERT INTO subscriptions (id, customer_id, package_name, pack_amount, frequency, day, status)
              VALUES (1, '500', 'Joy', 1950, 'WEEKLY', 'Tuesday', 'ACTIVE')`).run();
  db.prepare(`INSERT INTO cycles (id, subscription_id, deliveries_planned, pack_amount, per_delivery_revenue, payment_status, collect)
              VALUES (1, 1, 4, 1950, 487.5, 'PENDING', 1950)`).run();
  db.prepare(`INSERT INTO deliveries (cycle_id, seq, planned_date, status) VALUES (1, 1, ?, 'PLANNED')`).run(TODAY);

  server = startDashboard({
    db,
    answer: async question => `echo: ${question}`,
    port: 0, // ephemeral
    today: () => TODAY
  });
  await new Promise<void>(resolve => server.on('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  db.close();
});

describe('owner dashboard', () => {
  it('serves the page and the overview numbers', async () => {
    const page = await request('GET', '/');
    expect(page.status).toBe(200);
    expect(String(page.json)).toContain('Bring My Flowers');
    expect(String(page.json)).toContain('Pending payments');

    const manifest = await request('GET', '/manifest.webmanifest');
    expect(manifest.status).toBe(200);
    expect(manifest.json.name).toBe('Bring My Flowers');
    expect(manifest.json.display).toBe('standalone');

    const overview = await request('GET', '/api/overview');
    expect(overview.status).toBe(200);
    expect(overview.json.today).toMatchObject({ date: TODAY, count: 1 });
    expect(overview.json.pendingCollections).toBe(1950);
  });

  it('lists deliveries and collections', async () => {
    const deliveries = await request('GET', `/api/deliveries?date=${TODAY}`);
    expect(deliveries.json.deliveries[0]).toMatchObject({ id: '500', name: 'Dash Customer', collect: 1950 });

    const collections = await request('GET', '/api/collections');
    expect(collections.json.total).toBe(1950);
    expect(collections.json.debtors[0].name).toBe('Dash Customer');
  });

  it('shows escalated messages in review and resolves them once', async () => {
    insertGroupMessage(db, 'staff', 'Pink lilies', '2026-07-14T10:00:00.000Z');
    await processGroupMessages(db, TODAY);

    const review = await request('GET', '/api/review');
    expect(review.json.items).toHaveLength(1);
    const id = review.json.items[0].id;

    expect((await request('POST', `/api/review/${id}/resolve`)).json.resolved).toBe(true);
    expect((await request('POST', `/api/review/${id}/resolve`)).json.resolved).toBe(false);
    expect((await request('GET', '/api/review')).json.items).toHaveLength(0);
  });

  it('answers chat through the provided chain and validates input', async () => {
    const chat = await request('POST', '/api/chat', { question: 'how are sales?' });
    expect(chat.json.answer).toBe('echo: how are sales?');
    expect((await request('POST', '/api/chat', {})).status).toBe(400);
  });

  it('exposes health and review escalation fields', async () => {
    const health = await request('GET', '/api/health');
    expect(health.status).toBe(200);
    expect(health.json).toHaveProperty('whatsappConnected');
    expect(health.json).toHaveProperty('linked');
    expect(String(await request('GET', '/').then(r => r.json))).toContain('status-banner');
  });
});
