import { describe, it, expect } from 'vitest';
import { parseRecurrence, parseDayOfWeek, nextOccurrence, describeSchedule } from '../src/utils/recurrence';

describe('parseDayOfWeek', () => {
  it.each([
    ['monday', 1],
    ['on Mondays please', 1],
    ['every tue', 2],
    ['WEDNESDAY', 3],
    ['thu', 4],
    ['fridays', 5],
    ['sat', 6],
    ['sunday', 0]
  ])('parses %j as %d', (input, expected) => {
    expect(parseDayOfWeek(input)).toBe(expected);
  });

  it('returns null when no day is present', () => {
    expect(parseDayOfWeek('10 roses please')).toBeNull();
    expect(parseDayOfWeek('tomorrow')).toBeNull();
  });
});

describe('parseRecurrence', () => {
  it('detects daily cadence', () => {
    expect(parseRecurrence('roses every day')).toEqual({ frequency: 'DAILY', day: 0 });
    expect(parseRecurrence('daily tulips')).toEqual({ frequency: 'DAILY', day: 0 });
  });

  it('detects weekly cadence with a day', () => {
    expect(parseRecurrence('10 roses every monday')).toEqual({ frequency: 'WEEKLY', day: 1 });
    expect(parseRecurrence('subscribe me for lilies on fridays')).toEqual({ frequency: 'WEEKLY', day: 5 });
  });

  it('detects weekly cadence without a day (day must be asked)', () => {
    expect(parseRecurrence('roses every week')).toEqual({ frequency: 'WEEKLY', day: null });
    expect(parseRecurrence('weekly roses')).toEqual({ frequency: 'WEEKLY', day: null });
  });

  it('detects monthly cadence with and without a day of month', () => {
    expect(parseRecurrence('20 lilies every month on the 5th')).toEqual({ frequency: 'MONTHLY', day: 5 });
    expect(parseRecurrence('monthly bouquet on the 15')).toEqual({ frequency: 'MONTHLY', day: 15 });
    expect(parseRecurrence('roses every month')).toEqual({ frequency: 'MONTHLY', day: null });
  });

  it('does not read a quantity as a day of month', () => {
    expect(parseRecurrence('10 roses monthly')).toEqual({ frequency: 'MONTHLY', day: null });
  });

  it('treats bare subscription words as weekly-with-unknown-day', () => {
    expect(parseRecurrence('I want a subscription')).toEqual({ frequency: 'WEEKLY', day: null });
  });

  it('returns null for one-off orders', () => {
    expect(parseRecurrence('10 roses for tomorrow')).toBeNull();
    expect(parseRecurrence('deliver on monday')).toBeNull();
  });
});

describe('nextOccurrence', () => {
  // 2026-07-06 is a Monday
  it('DAILY advances one day', () => {
    expect(nextOccurrence('DAILY', 0, '2026-07-06')).toBe('2026-07-07');
  });

  it('WEEKLY returns the next matching weekday, never the same day', () => {
    expect(nextOccurrence('WEEKLY', 1, '2026-07-06')).toBe('2026-07-13'); // Mon → next Mon
    expect(nextOccurrence('WEEKLY', 3, '2026-07-06')).toBe('2026-07-08'); // Mon → Wed
    expect(nextOccurrence('WEEKLY', 0, '2026-07-06')).toBe('2026-07-12'); // Mon → Sun
  });

  it('MONTHLY returns this month when still ahead, else next month', () => {
    expect(nextOccurrence('MONTHLY', 15, '2026-07-06')).toBe('2026-07-15');
    expect(nextOccurrence('MONTHLY', 5, '2026-07-06')).toBe('2026-08-05');
    expect(nextOccurrence('MONTHLY', 6, '2026-07-06')).toBe('2026-08-06'); // same day → next month
  });

  it('MONTHLY rolls over the year end', () => {
    expect(nextOccurrence('MONTHLY', 10, '2026-12-20')).toBe('2027-01-10');
  });
});

describe('describeSchedule', () => {
  it('describes each cadence', () => {
    expect(describeSchedule('DAILY', 0)).toBe('every day');
    expect(describeSchedule('WEEKLY', 1)).toBe('every Monday');
    expect(describeSchedule('MONTHLY', 1)).toBe('on the 1st of every month');
    expect(describeSchedule('MONTHLY', 2)).toBe('on the 2nd of every month');
    expect(describeSchedule('MONTHLY', 3)).toBe('on the 3rd of every month');
    expect(describeSchedule('MONTHLY', 15)).toBe('on the 15th of every month');
  });
});
