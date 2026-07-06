import { describe, it, expect } from 'vitest';
import { serializeItems, parseItems, totalQuantity, displayItems } from '../src/utils/orderItems';

describe('serializeItems / parseItems', () => {
  it('round-trips multi-item orders', () => {
    const items = [
      { name: 'Roses', quantity: 5 },
      { name: 'Lilies', quantity: 3 }
    ];
    const encoded = serializeItems(items);

    expect(encoded).toBe('5 Roses, 3 Lilies');
    expect(parseItems(encoded)).toEqual(items);
  });

  it('parses legacy cells (bare name) using the quantity-column fallback', () => {
    expect(parseItems('Roses', 10)).toEqual([{ name: 'Roses', quantity: 10 }]);
  });

  it('handles mixed legacy comma lists', () => {
    // Pre-multi-item rows could hold "Roses, Lilies" with one shared quantity
    expect(parseItems('Roses, Lilies', 10)).toEqual([
      { name: 'Roses', quantity: 10 },
      { name: 'Lilies', quantity: 10 }
    ]);
  });

  it('keeps multi-word flower names intact', () => {
    expect(parseItems('2 Peace Lily')).toEqual([{ name: 'Peace Lily', quantity: 2 }]);
  });

  it('ignores empty segments and trims whitespace', () => {
    expect(parseItems(' 5 Roses ,, 3 Lilies , ')).toEqual([
      { name: 'Roses', quantity: 5 },
      { name: 'Lilies', quantity: 3 }
    ]);
  });
});

describe('totalQuantity', () => {
  it('sums units across line items', () => {
    expect(totalQuantity([{ name: 'Roses', quantity: 5 }, { name: 'Lilies', quantity: 3 }])).toBe(8);
    expect(totalQuantity([])).toBe(0);
  });
});

describe('displayItems', () => {
  it('renders new and legacy cells uniformly', () => {
    expect(displayItems('5 Roses, 3 Lilies', 8)).toBe('5 Roses, 3 Lilies');
    expect(displayItems('Roses', 10)).toBe('10 Roses');
  });
});
