import { describe, it, expect } from 'vitest';
import { findBestFlowerMatch, areFlowerNamesSimilar } from '../src/utils/fuzzyMatch';

const INVENTORY = ['Roses', 'Lilies', 'Tulips', 'Orchids'];

describe('findBestFlowerMatch', () => {
  it('matches exact names case-insensitively with full confidence', () => {
    expect(findBestFlowerMatch('roses', INVENTORY)).toEqual({ match: 'Roses', confidence: 1.0 });
  });

  it('matches singular against plural inventory names', () => {
    expect(findBestFlowerMatch('rose', INVENTORY)?.match).toBe('Roses');
    expect(findBestFlowerMatch('lily', INVENTORY)?.match).toBe('Lilies');
  });

  it('matches common typos above the confidence threshold', () => {
    const rozes = findBestFlowerMatch('rozes', INVENTORY);
    expect(rozes?.match).toBe('Roses');
    expect(rozes!.confidence).toBeGreaterThanOrEqual(0.7);

    expect(findBestFlowerMatch('lillies', INVENTORY)?.match).toBe('Lilies');
    expect(findBestFlowerMatch('tulps', INVENTORY)?.match).toBe('Tulips');
  });

  it('returns null when nothing is close enough', () => {
    expect(findBestFlowerMatch('sunflowers', INVENTORY)).toBeNull();
    expect(findBestFlowerMatch('chocolate cake', INVENTORY)).toBeNull();
  });

  it('returns null for empty input or empty inventory', () => {
    expect(findBestFlowerMatch('', INVENTORY)).toBeNull();
    expect(findBestFlowerMatch('roses', [])).toBeNull();
  });
});

describe('areFlowerNamesSimilar', () => {
  it('treats plural variants as the same flower', () => {
    expect(areFlowerNamesSimilar('rose', 'Roses')).toBe(true);
  });

  it('rejects unrelated names', () => {
    expect(areFlowerNamesSimilar('rose', 'Tulips')).toBe(false);
  });
});
