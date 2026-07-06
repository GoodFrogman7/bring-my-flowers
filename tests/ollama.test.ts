import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';

vi.mock('node-fetch', () => ({ default: vi.fn() }));

import fetch from 'node-fetch';
import { OllamaClient } from '../src/llm/ollama';
import { MessageIntent } from '../src/types';

const mockFetch = fetch as unknown as Mock;

function ollamaReply(response: string) {
  return {
    ok: true,
    json: async () => ({ model: 'llama3', response, done: true })
  };
}

function client() {
  return new OllamaClient('http://localhost:11434', 'llama3', 5000);
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe('classifyMessage', () => {
  it('parses a clean JSON-mode response', async () => {
    mockFetch.mockResolvedValue(ollamaReply(
      '{"intent": "ORDER", "confidence": 0.92}'
    ));

    const parsed = await client().classifyMessage('I want 5 roses', '+911');

    expect(parsed.intent).toBe(MessageIntent.ORDER);
    expect(parsed.confidence).toBe(0.92);
    expect(parsed.customer_phone).toBe('+911');
  });

  it('extracts JSON embedded in prose when the model ignores JSON mode', async () => {
    mockFetch.mockResolvedValue(ollamaReply(
      'Sure! Here is the classification:\n{"intent": "RESCHEDULE", "date": "2026-07-10", "confidence": 0.8}\nHope that helps.'
    ));

    const parsed = await client().classifyMessage('deliver on friday instead', '+911');

    expect(parsed.intent).toBe(MessageIntent.RESCHEDULE);
    expect(parsed.date).toBe('2026-07-10');
  });

  it('falls back to regex intent detection when the model returns an unknown intent', async () => {
    mockFetch.mockResolvedValue(ollamaReply('{"intent": "GIBBERISH", "confidence": 0.9}'));

    const parsed = await client().classifyMessage('please cancel my order', '+911');

    expect(parsed.intent).toBe(MessageIntent.NO_DELIVERY);
  });

  it.each([
    ['no delivery today please', MessageIntent.NO_DELIVERY],
    ['cancel my order', MessageIntent.NO_DELIVERY],
    ['reschedule to monday', MessageIntent.RESCHEDULE],
    ['what is the status of my order', MessageIntent.INQUIRY],
    ['do you have tulips', MessageIntent.INQUIRY],
    ['I want 5 roses', MessageIntent.ORDER],
    ['send me lilies', MessageIntent.ORDER],
    ['asdf qwerty', MessageIntent.UNKNOWN]
  ])('classifies %j as %s offline when Ollama is unreachable', async (message, intent) => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    const parsed = await client().classifyMessage(message, '+911');

    expect(parsed.intent).toBe(intent);
    expect(parsed.confidence).toBe(0.3);
  });
});

describe('extractOrderDetails', () => {
  it('returns the extracted slots', async () => {
    mockFetch.mockResolvedValue(ollamaReply(
      '{"flowers": "lilies", "quantity": 5, "date": "2026-07-10"}'
    ));

    const extracted = await client().extractOrderDetails('5 lillies on july 10');

    expect(extracted).toEqual({ flowers: 'lilies', quantity: 5, date: '2026-07-10' });
  });

  it('normalizes missing fields to null', async () => {
    mockFetch.mockResolvedValue(ollamaReply('{"flowers": "roses"}'));

    const extracted = await client().extractOrderDetails('roses please');

    expect(extracted).toEqual({ flowers: 'roses', quantity: null, date: null });
  });

  it('rejects when the response contains no JSON', async () => {
    mockFetch.mockResolvedValue(ollamaReply('I could not understand that message.'));

    await expect(client().extractOrderDetails('???')).rejects.toThrow('No JSON found');
  });
});

describe('generation fallbacks when Ollama is down', () => {
  beforeEach(() => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
  });

  it('generateOrderConfirmation returns a template with the order details', async () => {
    const confirmation = await client().generateOrderConfirmation({
      orderId: 'ORD-1',
      flowers: 'Roses',
      quantity: 10,
      price: 500,
      deliveryDate: '2026-07-10'
    });

    expect(confirmation).toContain('ORD-1');
    expect(confirmation).toContain('₹500');
  });

  it('generateOrderResponse returns a usable question per error type', async () => {
    const c = client();
    await expect(c.generateOrderResponse({
      customerMessage: 'roses', extractedDetails: {}, error: 'missing_quantity'
    })).resolves.toBe('How many would you like?');
    await expect(c.generateOrderResponse({
      customerMessage: '10 roses', extractedDetails: {}, error: 'missing_date'
    })).resolves.toBe('When would you like delivery?');
  });

  it('checkHealth returns false instead of throwing', async () => {
    await expect(client().checkHealth()).resolves.toBe(false);
  });
});
