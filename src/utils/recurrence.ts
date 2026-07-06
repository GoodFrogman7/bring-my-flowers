import { RecurringFrequency } from '../types';

/** Parsed recurrence request from a customer message. */
export interface RecurrenceSpec {
  frequency: RecurringFrequency;
  /** WEEKLY: 0-6 (Sunday=0), MONTHLY: 1-28, DAILY: 0. Null when still unknown. */
  day: number | null;
}

const DAY_NAMES: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6
};

export const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "monday", "on tuesdays", "wed" → day-of-week number; null if none found. */
export function parseDayOfWeek(message: string): number | null {
  const match = message.toLowerCase().match(/\b(sunday|sun|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thu|friday|fri|saturday|sat)s?\b/);
  return match ? DAY_NAMES[match[1]] : null;
}

/**
 * Detect a recurrence request in a message. Deterministic on purpose — money
 * flows depend on this, so regex beats an LLM guess. Returns null when the
 * message doesn't ask for recurrence at all.
 */
export function parseRecurrence(message: string): RecurrenceSpec | null {
  const text = message.toLowerCase();

  if (/\bevery\s*day\b|\bdaily\b|\beach\s+day\b/.test(text)) {
    return { frequency: 'DAILY', day: 0 };
  }

  const dayOfWeek = /\bevery\b|\beach\b|\bweekly\b|\bsubscri|\brecurring\b/.test(text) ? parseDayOfWeek(text) : null;
  if (dayOfWeek !== null) {
    return { frequency: 'WEEKLY', day: dayOfWeek };
  }

  if (/\bevery\s+week\b|\bweekly\b|\beach\s+week\b/.test(text)) {
    return { frequency: 'WEEKLY', day: null };
  }

  const monthly = text.match(/\bevery\s+month\b|\bmonthly\b|\beach\s+month\b/);
  if (monthly) {
    // Require "on the N" or an ordinal (5th) so a bare quantity never counts
    const dom = text.match(/\bon\s+the\s+([1-9]|1\d|2[0-8])(?:st|nd|rd|th)?\b/) ||
                text.match(/\b([1-9]|1\d|2[0-8])(?:st|nd|rd|th)\b/);
    return { frequency: 'MONTHLY', day: dom ? parseInt(dom[1], 10) : null };
  }

  if (/\bsubscri(be|ption)\b|\brecurring\b|\bstanding\s+order\b/.test(text)) {
    // Recurrence asked for but cadence unknown — caller must ask
    return { frequency: 'WEEKLY', day: null };
  }

  return null;
}

function toDateString(d: Date): string {
  return d.toISOString().split('T')[0];
}

function addDays(dateStr: string, days: number): Date {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/**
 * Next delivery date strictly after `fromDate` (YYYY-MM-DD) for the schedule.
 * MONTHLY days are restricted to 1-28 at creation so no clamping is needed.
 */
export function nextOccurrence(frequency: RecurringFrequency, day: number, fromDate: string): string {
  if (frequency === 'DAILY') {
    return toDateString(addDays(fromDate, 1));
  }

  if (frequency === 'WEEKLY') {
    let d = addDays(fromDate, 1);
    while (d.getUTCDay() !== day) {
      d = addDays(toDateString(d), 1);
    }
    return toDateString(d);
  }

  // MONTHLY
  const from = new Date(`${fromDate}T00:00:00Z`);
  const candidate = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), day));
  if (candidate <= from) {
    candidate.setUTCMonth(candidate.getUTCMonth() + 1);
  }
  return toDateString(candidate);
}

/** Human description of a schedule, e.g. "every Monday" / "daily" / "on the 5th of every month". */
export function describeSchedule(frequency: RecurringFrequency, day: number): string {
  if (frequency === 'DAILY') return 'every day';
  if (frequency === 'WEEKLY') return `every ${DAY_LABELS[day] ?? 'week'}`;
  const suffix = day === 1 || day === 21 ? 'st' : day === 2 || day === 22 ? 'nd' : day === 3 || day === 23 ? 'rd' : 'th';
  return `on the ${day}${suffix} of every month`;
}
