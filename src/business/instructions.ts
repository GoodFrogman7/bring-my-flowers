import { parseDayOfWeek } from '../utils/recurrence';
import { addDays } from './dates';

/**
 * Deterministic parser for the ~16 fixed customer-instruction types the owner
 * described ("feedbacks are fixed, 15-16 types"). Money- and schedule-moving
 * messages must parse deterministically; the LLM only classifies what these
 * patterns miss, and anything still unclear escalates to a human.
 *
 * Language: Gurgaon customers write English/Hinglish — patterns include the
 * common transliterated tokens seen in the real remarks.
 */

export type Instruction =
  | { type: 'SKIP'; weeks: number }              // skip N weeks (this week = 1)
  | { type: 'SKIP_TODAY' }                       // hold just today's/next delivery
  | { type: 'HOLD_INDEFINITE' }                  // hold till further notice
  | { type: 'RESUME' }
  | { type: 'DAY_CHANGE'; day: number }          // 0=Sunday…6=Saturday
  | { type: 'RESCHEDULE_NEXT'; date: string }    // move next delivery to a date
  | { type: 'PAYMENT_CLAIM'; mode: string }
  | { type: 'RESTRICTION'; flower: string }
  | { type: 'ADDRESS_CHANGE'; address: string }
  | { type: 'STATUS' }
  | { type: 'CANCEL_SUBSCRIPTION' }
  | { type: 'RENEW' };

const WORD_NUMBERS: Record<string, number> = { one: 1, a: 1, two: 2, three: 3, four: 4 };

/** Phrases the restriction patterns must never read as a flower name. */
const NOT_A_FLOWER = /\b(delivery|deliver|need|thanks|thank you|problem|issue|worries|today|tomorrow|aaj|kal|this week|next week|it|anything|now|more)\b/;

function parseWeeks(text: string): number | null {
  const match = text.match(/(\d+|one|two|three|four|a)\s+weeks?/);
  if (match) {
    const n = WORD_NUMBERS[match[1]] ?? parseInt(match[1], 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  if (/\b(this|next|ek)\s+(week|hafta|hafte)\b/.test(text)) return 1;
  return null;
}

/** "tomorrow", "on the 20th" → YYYY-MM-DD relative to `today`; null if none. */
export function parseTargetDate(text: string, today: string): string | null {
  if (/\b(tomorrow|kal)\b/.test(text)) return addDays(today, 1);
  const dayOfMonth = text.match(/\bon\s+(?:the\s+)?([1-9]|[12]\d|3[01])(?:st|nd|rd|th)?\b/);
  if (dayOfMonth) {
    const target = parseInt(dayOfMonth[1], 10);
    // Next occurrence of that day-of-month
    let candidate = today;
    for (let i = 0; i < 62; i++) {
      candidate = addDays(candidate, 1);
      if (Number(candidate.split('-')[2]) === target) return candidate;
    }
  }
  return null;
}

export function parseInstruction(message: string, today: string): Instruction | null {
  const text = message.toLowerCase().trim();

  // Order matters: most specific / highest-stakes first.

  // Cancel the whole subscription (before generic "stop"/"band" skip patterns)
  if (/\b(cancel|stop|band|close|discontinue)\b.*\b(subscription|service|permanently|pack)\b/.test(text) ||
      /\bcancel my subscription\b/.test(text) ||
      /\bsubscription\s+(band|cancel|bandh)\b/.test(text)) {
    return { type: 'CANCEL_SUBSCRIPTION' };
  }

  // Renewal intent
  if (/\b(renew|renewal|next cycle|continue (with )?(the )?next)\b/.test(text)) {
    return { type: 'RENEW' };
  }

  // Payment claims
  const payment = text.match(/\b(paytm|gpay|google\s*pay|phonepe|upi|net\s*banking|bank transfer|cash)\b/);
  if (payment && /\b(paid|payment|sent|done|transferred|kar (diya|di)|bhej (diya|di)|de (diya|di))\b/.test(text)) {
    return { type: 'PAYMENT_CLAIM', mode: payment[1].replace(/\s+/g, ' ') };
  }
  if (/\bpayment\s+(done|made|sent|complete)|paisa\s+(bhej|de)\s*(diya|di)|\bpaid\b/.test(text)) {
    return { type: 'PAYMENT_CLAIM', mode: 'online' };
  }

  // Resume before skip: "please resume delivery"
  if (/\b(resume|restart|start (again|from)|chalu|shuru)\b/.test(text)) {
    return { type: 'RESUME' };
  }

  // Address change (before skip: "moved to new address, hold this week" → address wins? No —
  // combined messages are rare; address phrasing is distinctive)
  const address = text.match(/\b(?:new address|address (?:change[d]?|update)[:\s-]*|shifted to|moved to)\s*(.+)/);
  if (address && address[1].trim().length > 5) {
    return { type: 'ADDRESS_CHANGE', address: message.slice(message.toLowerCase().indexOf(address[1])).trim() };
  }

  // Flower restriction — must outrank the skip family: "don't send sunflowers"
  // is a restriction, "don't send today" is a skip.
  const restriction = text.match(/\bno (?:more )?([a-z][a-z ]{2,25}?)(?:\s+please|\s+from now|\s+onwards)?$/) ||
    text.match(/\bdon'?t (?:send|want)\s+([a-z][a-z ]{2,25}?)(?:\s+please)?$/) ||
    text.match(/^([a-z][a-z ]{2,25}?)\s+(?:nahi|mat)\s*(?:bhejna|bhejo|chahiye)?$/);
  if (restriction) {
    const flower = restriction[1].trim();
    if (!NOT_A_FLOWER.test(flower)) {
      return { type: 'RESTRICTION', flower };
    }
  }

  // Skip / hold family
  const skipIntent = /\b(hold|skip|no delivery|don'?t (send|deliver)|do not (send|deliver)|mat (bhejna|bhejo)|nahi? (chahiye|bhejna)|rok (do|dena))\b/.test(text);
  if (skipIntent) {
    if (/\b(till further notice|until further|next update|jab tak|indefinite|till i (say|tell))\b/.test(text)) {
      return { type: 'HOLD_INDEFINITE' };
    }
    const weeks = parseWeeks(text);
    if (weeks !== null) return { type: 'SKIP', weeks };
    // Bare "hold"/"skip"/"no delivery today" — just the next delivery,
    // the least destructive reading
    return { type: 'SKIP_TODAY' };
  }

  // Day change: "change day to tuesday", "deliver on mondays instead", "tuesday ko bhejo"
  if (/\b(change|shift|make it|instead|switch|badal)\b/.test(text) || /\bko\s+(bhej|kar)\b/.test(text)) {
    const day = parseDayOfWeek(text);
    if (day !== null && /\b(day|deliver|delivery|se|ko|every)\b/.test(text)) {
      return { type: 'DAY_CHANGE', day };
    }
  }

  // One-off reschedule: "send tomorrow instead", "deliver on the 20th"
  if (/\b(send|deliver|bhej)\b/.test(text)) {
    const target = parseTargetDate(text, today);
    if (target) return { type: 'RESCHEDULE_NEXT', date: target };
  }

  // Status inquiry
  if (/\b(when|kab|kitna|status|balance|next delivery|kaunsi delivery|how many)\b/.test(text) ||
      text.endsWith('?')) {
    return { type: 'STATUS' };
  }

  return null;
}
