import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';
import { Server } from 'http';
import { AddressInfo } from 'net';
import { createServer } from '../src/server';

const VERIFY_TOKEN = 'verify-token';
const APP_SECRET = 'app-secret';

let server: Server;
let baseUrl: string;
let handleMessage: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  handleMessage = vi.fn(async () => {});
  server = createServer({
    messageHandler: { handleMessage },
    cloudApi: { verifyToken: VERIFY_TOKEN, appSecret: APP_SECRET }
  }, 0);
  await new Promise<void>(resolve => server.once('listening', resolve));
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

function sign(body: string): string {
  return `sha256=${crypto.createHmac('sha256', APP_SECRET).update(body).digest('hex')}`;
}

function cloudMessage(body: string, signature: string = sign(body)): Promise<Response> {
  return fetch(`${baseUrl}/webhook/whatsapp/cloud`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hub-signature-256': signature
    },
    body
  });
}

describe('WhatsApp Cloud API webhook', () => {
  it('returns Meta’s challenge only for the configured verification token', async () => {
    const accepted = await fetch(
      `${baseUrl}/webhook/whatsapp/cloud?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=challenge-value`
    );
    const rejected = await fetch(
      `${baseUrl}/webhook/whatsapp/cloud?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=challenge-value`
    );

    expect(accepted.status).toBe(200);
    expect(await accepted.text()).toBe('challenge-value');
    expect(rejected.status).toBe(403);
  });

  it('validates the Meta signature and forwards inbound text messages', async () => {
    const body = JSON.stringify({
      entry: [{
        changes: [{
          value: {
            messages: [{
              from: '919876543210',
              type: 'text',
              text: { body: 'I need roses tomorrow' }
            }]
          }
        }]
      }]
    });

    const response = await cloudMessage(body);

    expect(response.status).toBe(200);
    expect(handleMessage).toHaveBeenCalledWith('919876543210', 'I need roses tomorrow');
  });

  it('rejects an unsigned or tampered payload', async () => {
    const body = JSON.stringify({ entry: [] });

    const response = await cloudMessage(body, 'sha256=not-a-valid-signature');

    expect(response.status).toBe(403);
    expect(handleMessage).not.toHaveBeenCalled();
  });
});
