import { describe, it, expect } from 'vitest';
import {
  serialToDate,
  normalizePhones,
  classifyActiveValue,
  mapPaymentStatus,
  frequencyFromRevenue,
  parseRestrictions,
  normalizeCustomerId,
  deliveryStatusString
} from '../src/business/parse';
import { tabNameToDate, combineFlowers } from '../src/business/importFeedback';

describe('serialToDate', () => {
  it('converts Excel serials to YYYY-MM-DD', () => {
    expect(serialToDate(45809)).toBe('2025-06-01');
    expect(serialToDate(46209)).toBe('2026-07-06');
  });

  it('passes through date strings and rejects junk', () => {
    expect(serialToDate('2026-07-06')).toBe('2026-07-06');
    expect(serialToDate('')).toBe('');
    expect(serialToDate('Send Invoice')).toBe('');
    expect(serialToDate(123)).toBe('');       // implausible serial
    expect(serialToDate(null)).toBe('');
  });
});

describe('normalizePhones', () => {
  it('splits // lists and strips non-digits including unicode marks', () => {
    expect(normalizePhones('9802300072 // 99968601111')).toBe('9802300072//99968601111');
    expect(normalizePhones(' 81304 32211')).toBe('8130432211');
    expect(normalizePhones('‬ 95996 97063‬')).toBe('9599697063');
  });

  it('dedupes and drops fragments', () => {
    expect(normalizePhones('98101 30319, 9810130319')).toBe('9810130319');
    expect(normalizePhones('0124')).toBe('');
  });
});

describe('classifyActiveValue', () => {
  it('maps the real vocabulary including typos', () => {
    expect(classifyActiveValue('Active 1')).toEqual({ kind: 'SUBSCRIPTION', status: 'ACTIVE', isCurrent: true });
    expect(classifyActiveValue('Renewed')).toEqual({ kind: 'SUBSCRIPTION', status: 'ACTIVE', isCurrent: false });
    expect(classifyActiveValue('Hold').status).toBe('HOLD');
    expect(classifyActiveValue('Hole').status).toBe('HOLD'); // real typo in Master
    expect(classifyActiveValue('Closed').status).toBe('CLOSED');
    expect(classifyActiveValue('Bouquet').kind).toBe('ONE_TIME');
    expect(classifyActiveValue('Sample').kind).toBe('SKIP');
    expect(classifyActiveValue('').kind).toBe('SKIP');
  });
});

describe('mapPaymentStatus', () => {
  it.each([
    ['Completed', 'COMPLETED'],
    ['  Completed', 'COMPLETED'],
    ['Complimentary', 'COMPLIMENTARY'],
    ['In Process', 'IN_PROCESS'],
    ['Cancel', 'CANCELLED'],
    ['Pending', 'PENDING'],
    ['', 'PENDING']
  ])('%j → %s', (input, expected) => {
    expect(mapPaymentStatus(input)).toBe(expected);
  });
});

describe('frequencyFromRevenue', () => {
  it('reads the owner’s pack/revenue arithmetic', () => {
    expect(frequencyFromRevenue(1450, 362.5)).toEqual({ frequency: 'WEEKLY', deliveriesPerCycle: 4 });
    expect(frequencyFromRevenue(1600, 200)).toEqual({ frequency: 'BIWEEKLY', deliveriesPerCycle: 8 });
    expect(frequencyFromRevenue(1250, 156.25)).toEqual({ frequency: 'BIWEEKLY', deliveriesPerCycle: 8 });
    // Bouquet-like (revenue == pack) and unreadable default to weekly
    expect(frequencyFromRevenue(550, 550).frequency).toBe('WEEKLY');
    expect(frequencyFromRevenue('', '').frequency).toBe('WEEKLY');
  });
});

describe('parseRestrictions', () => {
  it('splits the “n” lists and strips date annotations', () => {
    expect(parseRestrictions('GULDAWARI n BOP n GERBERA')).toEqual(['GULDAWARI', 'BOP', 'GERBERA']);
    expect(parseRestrictions('Sunflower (30/04)')).toEqual(['Sunflower']);
    expect(parseRestrictions('Rose n Daisy n Sunflower')).toEqual(['Rose', 'Daisy', 'Sunflower']);
    expect(parseRestrictions('')).toEqual([]);
  });
});

describe('normalizeCustomerId', () => {
  it.each([
    ['588', '588'],
    [' 3269 ', '3269'],
    ['B56138', 'B56138'],
    ['G-00015', 'G-00015'],
    ['Send Invoice', ''],
    ['', '']
  ])('%j → %j', (input, expected) => {
    expect(normalizeCustomerId(input)).toBe(expected);
  });
});

describe('deliveryStatusString', () => {
  it('formats like the owner’s sheet', () => {
    expect(deliveryStatusString(3, 1, 'PENDING', 1450))
      .toBe('3  del of this cycle   -  1-cycles pmnt   Pending - Collect 1450');
    expect(deliveryStatusString(4, 0, 'COMPLETED', 0))
      .toBe('4  del of this cycle   -  0-cycles pmnt   Completed - Collect 0');
  });
});

describe('tabNameToDate', () => {
  it.each([
    ['01-06-26', '2026-06-01'],
    ['06-6-26', '2026-06-06'],
    [' 07-06-26', '2026-06-07'],
    ['Sheet2', null],
    ['13-13-26', null]
  ])('%j → %j', (input, expected) => {
    expect(tabNameToDate(input)).toBe(expected);
  });
});

describe('combineFlowers', () => {
  it('prefers the pre-combined formula column verbatim', () => {
    const headers = ['ID', 'Flower 1 Stick Flower 2 Stick Flower 3 Stick Consumables', 'Flower 1', 'Stick'];
    const cells = ['3353', 'P n W Glad ( 14 Inch ) 16     Grass', 'P n W Glad ( 14 Inch )', 16];
    expect(combineFlowers(cells, headers)).toBe('P n W Glad ( 14 Inch ) 16     Grass');
  });

  it('composes from individual columns in the owner’s format', () => {
    const headers = ['ID', 'Flower 1', 'stick', 'Flower 2', 'Stick', 'Consumables'];
    const cells = ['3353', 'Rajni ( 14 Inch )', 16, 'Asiatic', 1, 'Grass'];
    expect(combineFlowers(cells, headers)).toBe('Rajni ( 14 Inch ) 16 Asiatic 1     Grass');
  });

  it('returns empty for rows with no flowers', () => {
    expect(combineFlowers(['3353', '', '', ''], ['ID', 'Flower 1', 'Stick', 'Consumables'])).toBe('');
  });
});
