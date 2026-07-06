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

/** dd/mm stamp the owner uses in remarks, e.g. "(06/07)". */
export function remarkStamp(date: string): string {
  const [, month, day] = date.split('-');
  return `(${day}/${month})`;
}

const ORDINALS = ['0th', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th'];

export function ordinal(n: number): string {
  return ORDINALS[n] ?? `${n}th`;
}
