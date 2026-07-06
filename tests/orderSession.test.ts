import { describe, it, expect, vi, afterEach } from 'vitest';
import { OrderSessionStore, OrderDraft, parseQuantity } from '../src/conversation/orderSession';

function draft(overrides: Partial<OrderDraft> = {}): OrderDraft {
  return {
    flowers: 'Roses',
    quantity: null,
    date: null,
    stage: 'COLLECTING',
    language: 'en',
    updatedAt: Date.now(),
    ...overrides
  };
}

describe('parseQuantity', () => {
  it.each([
    ['10', 10],
    ['  10 ', 10],
    ['10 stems', 10],
    ['5 flowers', 5],
    ['3 pcs', 3],
    ['ten', 10],
    ['a dozen', 12],
    ['dozen', 12],
    ['two pieces', 2],
    ['twenty', 20]
  ])('parses %j as %d', (input, expected) => {
    expect(parseQuantity(input)).toBe(expected);
  });

  it.each([
    ['0'],
    ['ten roses for tomorrow'],
    ['I want 10 roses'],
    ['tomorrow'],
    ['yes'],
    ['']
  ])('returns null for %j', (input) => {
    expect(parseQuantity(input)).toBeNull();
  });
});

describe('OrderSessionStore', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stores and returns a draft per phone number', () => {
    const store = new OrderSessionStore();
    store.set('+911', draft({ flowers: 'Lilies' }));

    expect(store.get('+911')?.flowers).toBe('Lilies');
    expect(store.get('+922')).toBeNull();
  });

  it('clear removes the draft', () => {
    const store = new OrderSessionStore();
    store.set('+911', draft());
    store.clear('+911');

    expect(store.get('+911')).toBeNull();
  });

  it('expires drafts after the TTL', () => {
    vi.useFakeTimers();
    const store = new OrderSessionStore(10 * 60 * 1000);
    store.set('+911', draft());

    vi.advanceTimersByTime(9 * 60 * 1000);
    expect(store.get('+911')).not.toBeNull();

    vi.advanceTimersByTime(2 * 60 * 1000);
    expect(store.get('+911')).toBeNull();
  });

  it('set refreshes updatedAt so activity keeps the session alive', () => {
    vi.useFakeTimers();
    const store = new OrderSessionStore(10 * 60 * 1000);
    const d = draft();
    store.set('+911', d);

    vi.advanceTimersByTime(8 * 60 * 1000);
    store.set('+911', d);

    vi.advanceTimersByTime(8 * 60 * 1000);
    expect(store.get('+911')).not.toBeNull();
  });
});
