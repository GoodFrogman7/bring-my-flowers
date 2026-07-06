import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import express from 'express';
import bodyParser from 'body-parser';
import crypto from 'crypto';
import { Server } from 'http';
import { AddressInfo } from 'net';
import { twilioSignatureValidator } from '../src/utils/twilioSignature';

const AUTH_TOKEN = 'test_auth_token_123';

/** Twilio's documented signing scheme: HMAC-SHA1 over URL + sorted params. */
function sign(url: string, params: Record<string, string>): string {
  const data = url + Object.keys(params).sort().map(key => key + params[key]).join('');
  return crypto.createHmac('sha1', AUTH_TOKEN).update(Buffer.from(data, 'utf-8')).digest('base64');
}

let server: Server;
let baseUrl: string;

function startApp(): Promise<void> {
  const app = express();
  app.use(bodyParser.urlencoded({ extended: false }));
  app.post('/webhook/whatsapp', twilioSignatureValidator(AUTH_TOKEN), (_req, res) => {
    res.status(200).send('OK');
  });
  return new Promise(resolve => {
    server = app.listen(0, () => {
      baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
}

function post(params: Record<string, string>, signature?: string) {
  return fetch(`${baseUrl}/webhook/whatsapp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(signature ? { 'X-Twilio-Signature': signature } : {})
    },
    body: new URLSearchParams(params).toString()
  });
}

beforeEach(async () => {
  delete process.env.WEBHOOK_BASE_URL;
  delete process.env.TWILIO_VALIDATE_WEBHOOK;
  await startApp();
});

afterEach(() => {
  server?.close();
});

afterAll(() => {
  delete process.env.WEBHOOK_BASE_URL;
  delete process.env.TWILIO_VALIDATE_WEBHOOK;
});

describe('twilioSignatureValidator', () => {
  const params = { From: 'whatsapp:+919876543210', Body: 'hello' };

  it('accepts a request signed with the auth token', async () => {
    const signature = sign(`${baseUrl}/webhook/whatsapp`, params);
    const res = await post(params, signature);
    expect(res.status).toBe(200);
  });

  it('rejects a request with no signature', async () => {
    const res = await post(params);
    expect(res.status).toBe(403);
  });

  it('rejects a request signed with the wrong token', async () => {
    const res = await post(params, 'aW52YWxpZCBzaWduYXR1cmU=');
    expect(res.status).toBe(403);
  });

  it('rejects when the params were tampered with after signing', async () => {
    const signature = sign(`${baseUrl}/webhook/whatsapp`, params);
    const res = await post({ ...params, Body: 'cancel my order' }, signature);
    expect(res.status).toBe(403);
  });

  it('validates against WEBHOOK_BASE_URL when set (ngrok case)', async () => {
    // Twilio signs the public URL, not the localhost one it is proxied to
    process.env.WEBHOOK_BASE_URL = 'https://example.ngrok-free.app';
    const signature = sign('https://example.ngrok-free.app/webhook/whatsapp', params);
    const res = await post(params, signature);
    expect(res.status).toBe(200);
  });

  it('can be disabled explicitly for local testing', async () => {
    process.env.TWILIO_VALIDATE_WEBHOOK = 'false';
    // Validator reads the flag at creation — rebuild the app
    server.close();
    await startApp();

    const res = await post(params);
    expect(res.status).toBe(200);
  });
});
