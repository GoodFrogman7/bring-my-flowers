import { Language } from '../i18n/languageDetector';
import { RecurrenceSpec } from '../utils/recurrence';
import logger from '../utils/logger';

/**
 * A partially-collected order. Slots fill across messages until the draft is
 * complete, then the customer confirms and the order is fulfilled.
 */
export interface OrderDraft {
  /** Flower name; once fuzzy-matched this holds the exact inventory name. */
  flowers: string | null;
  quantity: number | null;
  /** Delivery date, YYYY-MM-DD. Unused when the draft is a subscription. */
  date: string | null;
  /** Set when the customer asked for a subscription instead of a one-off order. */
  recurrence?: RecurrenceSpec;
  stage: 'COLLECTING' | 'AWAITING_CONFIRMATION';
  language: Language;
  updatedAt: number;
}

/**
 * Per-customer conversation state so follow-up answers ("10", "tomorrow")
 * continue the order they belong to instead of being classified from scratch.
 */
export class OrderSessionStore {
  private sessions: Map<string, OrderDraft> = new Map();
  private ttlMs: number;

  constructor(ttlMs: number = 10 * 60 * 1000) {
    this.ttlMs = ttlMs;
  }

  get(phone: string): OrderDraft | null {
    const draft = this.sessions.get(phone);
    if (!draft) return null;
    if (Date.now() - draft.updatedAt > this.ttlMs) {
      this.sessions.delete(phone);
      logger.info({ phone }, 'Order session expired');
      return null;
    }
    return draft;
  }

  set(phone: string, draft: OrderDraft): void {
    draft.updatedAt = Date.now();
    this.sessions.set(phone, draft);
    this.prune();
  }

  clear(phone: string): void {
    this.sessions.delete(phone);
  }

  private prune(): void {
    const now = Date.now();
    for (const [phone, draft] of this.sessions) {
      if (now - draft.updatedAt > this.ttlMs) {
        this.sessions.delete(phone);
      }
    }
  }
}

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, dozen: 12, fifteen: 15, twenty: 20
};

/**
 * Cheap local quantity parse for follow-up answers like "10", "ten stems" or
 * "a dozen" — avoids a full LLM round-trip for the common short reply.
 */
export function parseQuantity(message: string): number | null {
  const trimmed = message.trim().toLowerCase();

  const digits = trimmed.match(/^(\d+)(\s+(stems?|flowers?|pieces?|pcs))?$/);
  if (digits) {
    const n = parseInt(digits[1], 10);
    return n > 0 ? n : null;
  }

  const words = trimmed.match(/^(a\s+)?([a-z]+)(\s+(stems?|flowers?|pieces?|pcs))?$/);
  if (words && WORD_NUMBERS[words[2]] !== undefined) {
    return WORD_NUMBERS[words[2]];
  }

  return null;
}
