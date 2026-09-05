/**
 * Date helpers pinned to the business timezone. The shop runs on IST; the
 * machine running the bot may not. Every "today" in business logic must come
 * from here, never from a bare `new Date()`.
 */

export const BUSINESS_TZ = 'Asia/Kolkata';

/** Today's date in IST, YYYY-MM-DD. */
export function todayIST(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: BUSINESS_TZ });
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

/** 0=Sunday … 6=Saturday for a YYYY-MM-DD date. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** Next occurrence of `weekday` strictly after `date`. */
export function nextWeekdayAfter(date: string, weekday: number): string {
  let candidate = addDays(date, 1);
  while (weekdayOf(candidate) !== weekday) candidate = addDays(candidate, 1);
  return candidate;
}

const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "Thursday" → 4; -1 when the label isn't a plain weekday name. */
export function weekdayIndex(label: string): number {
  const target = label.trim().toLowerCase();
  return WEEKDAY_LABELS.findIndex(d => d.toLowerCase() === target);
}

/** Every weekday name mentioned in free text ("Thu n Sun", "Thursday and Sunday"), in order, deduped. */
export function weekdaysMentioned(text: string): number[] {
  const found: number[] = [];
  for (const match of text.toLowerCase().matchAll(/\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/g)) {
    const index = WEEKDAY_LABELS.findIndex(d => d.toLowerCase().startsWith(match[1]));
    if (index >= 0 && !found.includes(index)) found.push(index);
  }
  return found;
}

export function weekdayLabel(index: number): string {
  return WEEKDAY_LABELS[index] ?? '';
}

/**
 * The delivery dates of one cycle, starting on `firstDate`: one per week for
 * WEEKLY; for BIWEEKLY each week also gets the customer's second visit day
 * (`day2`), falling back to +3 days when no second day is on record.
 */
export function cycleDates(firstDate: string, frequency: string, day2: string, weeks: number = 4): string[] {
  const biweekly = frequency === 'BIWEEKLY';
  const secondDay = weekdayIndex(day2);
  const dates: string[] = [];
  let weekStart = firstDate;
  for (let week = 0; week < weeks; week++) {
    dates.push(weekStart);
    if (biweekly) dates.push(secondDay >= 0 ? nextWeekdayAfter(weekStart, secondDay) : addDays(weekStart, 3));
    weekStart = addDays(weekStart, 7);
  }
  return dates;
}

/** dd/mm stamp the owner uses in remarks, e.g. "(06/07)". */
export function remarkStamp(date: string): string {
  const [, month, day] = date.split('-');
  return `(${day}/${month})`;
}

const ORDINALS = ['0th', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th'];

export function ordinal(n: number): string {
  return ORDINALS[n] ?? `${n}th`;
}
