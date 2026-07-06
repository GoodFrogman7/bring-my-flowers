import { describe, it, expect } from 'vitest';
import { parseInstruction, parseTargetDate } from '../src/business/instructions';

const TODAY = '2026-07-06'; // Monday

function parse(message: string) {
  return parseInstruction(message, TODAY);
}

describe('skip / hold family', () => {
  it.each([
    'no delivery today please',
    'hold today',
    'skip',
    "don't send today",
    'aaj mat bhejna'
  ])('%j → SKIP_TODAY', (message) => {
    expect(parse(message)).toEqual({ type: 'SKIP_TODAY' });
  });

  it.each([
    ['skip this week', 1],
    ['hold 2 weeks', 2],
    ['skip two weeks please', 2],
    ['no delivery for one week', 1],
    ['hold next week', 1]
  ])('%j → SKIP %d weeks', (message, weeks) => {
    expect(parse(message)).toEqual({ type: 'SKIP', weeks });
  });

  it('indefinite hold', () => {
    expect(parse('hold till further notice')).toEqual({ type: 'HOLD_INDEFINITE' });
    expect(parse('skip till i say')).toEqual({ type: 'HOLD_INDEFINITE' });
  });
});

describe('resume', () => {
  it.each(['resume delivery', 'please restart', 'start again from monday', 'chalu kar do'])('%j', (message) => {
    expect(parse(message)?.type).toBe('RESUME');
  });
});

describe('day change', () => {
  it('parses explicit day changes', () => {
    expect(parse('change my day to tuesday')).toEqual({ type: 'DAY_CHANGE', day: 2 });
    expect(parse('deliver on saturdays instead')).toEqual({ type: 'DAY_CHANGE', day: 6 });
  });
});

describe('reschedule next', () => {
  it('sends tomorrow', () => {
    expect(parse('send tomorrow instead')).toEqual({ type: 'RESCHEDULE_NEXT', date: '2026-07-07' });
    expect(parse('kal bhej dena')).toEqual({ type: 'RESCHEDULE_NEXT', date: '2026-07-07' });
  });

  it('sends on a day of month', () => {
    expect(parse('deliver on the 20th')).toEqual({ type: 'RESCHEDULE_NEXT', date: '2026-07-20' });
  });

  it('parseTargetDate rolls to next month when needed', () => {
    expect(parseTargetDate('on the 3rd', TODAY)).toBe('2026-08-03');
  });
});

describe('payment claims', () => {
  it.each([
    ['paid via paytm', 'paytm'],
    ['payment done by gpay', 'gpay'],
    ['sent on google pay', 'google pay'],
    ['cash de diya', 'cash']
  ])('%j → PAYMENT_CLAIM %s', (message, mode) => {
    expect(parse(message)).toEqual({ type: 'PAYMENT_CLAIM', mode });
  });

  it('bare "paid" claims default to online', () => {
    expect(parse('paid')).toEqual({ type: 'PAYMENT_CLAIM', mode: 'online' });
  });
});

describe('restrictions', () => {
  it.each([
    ['no gerbera', 'gerbera'],
    ['no more rajni please', 'rajni'],
    ["don't send sunflowers", 'sunflowers'],
    ['rose nahi bhejna', 'rose']
  ])('%j → RESTRICTION %s', (message, flower) => {
    expect(parse(message)).toEqual({ type: 'RESTRICTION', flower });
  });

  it('does not read "no delivery" as a flower', () => {
    expect(parse('no delivery')).toEqual({ type: 'SKIP_TODAY' });
  });
});

describe('address change', () => {
  it('captures the new address text', () => {
    const parsed = parse('new address: T-5/808, Pyramid Urban Homes, Sector 70A');
    expect(parsed?.type).toBe('ADDRESS_CHANGE');
    expect((parsed as { address: string }).address).toContain('Pyramid Urban Homes');
  });
});

describe('cancel vs skip precedence', () => {
  it('cancel my subscription is CANCEL, not skip', () => {
    expect(parse('please cancel my subscription')).toEqual({ type: 'CANCEL_SUBSCRIPTION' });
    expect(parse('stop the service permanently')).toEqual({ type: 'CANCEL_SUBSCRIPTION' });
  });
});

describe('renew and status', () => {
  it('renewal intent', () => {
    expect(parse('yes renew please')).toEqual({ type: 'RENEW' });
    expect(parse('continue with next cycle')).toEqual({ type: 'RENEW' });
  });

  it('status questions', () => {
    expect(parse('when is my next delivery?')?.type).toBe('STATUS');
    expect(parse('kitna balance hai')?.type).toBe('STATUS');
  });
});

describe('unparseable', () => {
  it('returns null for messages needing a human', () => {
    expect(parse('bhaiya wo kal wale flowers kharab the')).toBeNull();
    expect(parse('happy birthday to your team')).toBeNull();
  });
});
