/**
 * Phase 1 evidence harness: attribute each difference between Amit's
 * delivery sheet and the bot's sheet to exactly one cause, using the group
 * messages the bot received. Pure functions — no database or file access —
 * so the rules are unit-tested (tests/evidenceAttribution.test.ts).
 *
 * Causes (first rule that matches wins):
 *   STUCK_IN_REVIEW  a related message was escalated before the cutoff and
 *                    was still unresolved when the sheet was built
 *   MISPARSED        a related message was acted on before the cutoff, but
 *                    the sheet is still wrong
 *   UNPARSED         a related message arrived before the cutoff but was not
 *                    understood (never logged, or only appended as a note)
 *   LATE             related messages exist, but all arrived after the cutoff
 *   DATA             no related message; the customer/subscription/order
 *                    record itself is missing or wrong
 *   NO_MESSAGE       no related message; the bot's own scheduling logic
 *                    (renewal, cycles, rotation, biweekly) is wrong
 */
import { addDays } from '../../src/business/dates';

export type Attribution = 'STUCK_IN_REVIEW' | 'MISPARSED' | 'UNPARSED' | 'LATE' | 'DATA' | 'NO_MESSAGE';
export const ATTRIBUTIONS: Attribution[] = ['LATE', 'MISPARSED', 'UNPARSED', 'STUCK_IN_REVIEW', 'NO_MESSAGE', 'DATA'];

export interface EvidenceMessage {
  id: number;
  participant: string;
  text: string;
  /** ISO timestamp (UTC) the message arrived. */
  receivedAt: string;
  /** group_update_log classification, or null when the message was never processed/logged. */
  classification: string | null;
  actionTaken: string;
  escalated: boolean;
  /** ISO timestamp a human cleared the Review item, or null. */
  resolvedAt: string | null;
  matchedCustomerId: string | null;
}

export interface CustomerRef {
  id: string;
  name: string;
  phones: string[];
}

export interface SheetDiff {
  date: string;
  /** amitOnly = Amit delivered, bot missed; botOnly = bot listed, Amit did not deliver; field = both had it, a field differs. */
  kind: 'amitOnly' | 'botOnly' | 'field';
  customer: CustomerRef;
  /** Cause code from scripts/compare-del-sheets.ts (A_NOT_IN_DB, D_DAY_SHIFT, …) or `field:<name>`. */
  scheduleCause: string;
  field?: string;
  amitValue?: string;
  botValue?: string;
}

export interface AttributedDiff extends SheetDiff {
  cause: Attribution;
  messageIds: number[];
  detail: string;
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** "2026-09-23T18:06:00.000Z" → "2026-09-23 23:36 IST". */
export function istTimestamp(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t + IST_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ') + ' IST';
}

/** Start of an IST calendar day as a UTC instant. */
function istDayStartMs(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`) - IST_OFFSET_MS;
}

/**
 * The instant the sheet for `date` was built: the evening before at
 * `processTime` (HH:mm, IST) — UPDATES_PROCESS_TIME, 21:30 by default.
 */
export function sheetCutoff(date: string, processTime = '21:30'): string {
  const [hours, minutes] = processTime.split(':').map(Number);
  return new Date(istDayStartMs(addDays(date, -1)) + ((hours * 60) + minutes) * 60000).toISOString();
}

const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Does the message refer to this customer? Deliberately conservative: the
 * bot's own match, the customer ID as a word, a phone number, the full name,
 * or first + last name both present. First names alone never count.
 */
export function mentionsCustomer(message: Pick<EvidenceMessage, 'text' | 'matchedCustomerId'>, customer: CustomerRef): boolean {
  if (message.matchedCustomerId && message.matchedCustomerId.toUpperCase() === customer.id.toUpperCase()) return true;
  const text = ` ${normalize(message.text)} `;
  const digits = message.text.replace(/\D/g, '');
  if (customer.phones.some(phone => phone.length >= 10 && digits.includes(phone.slice(-10)))) return true;
  if (/^[a-z]*-?\d+$/i.test(customer.id) && text.includes(` ${normalize(customer.id)} `)) {
    // Bare numeric IDs ("12") collide with dates and amounts; require a prefix or 3+ digits.
    if (/[a-z]/i.test(customer.id) || customer.id.replace(/\D/g, '').length >= 3) return true;
  }
  const name = normalize(customer.name);
  if (!name) return false;
  if (text.includes(` ${name} `)) return true;
  const parts = name.split(' ').filter(part => part.length >= 3);
  return parts.length >= 2 && text.includes(` ${parts[0]} `) && text.includes(` ${parts[parts.length - 1]} `);
}

/** Messages about this customer from `lookbackDays` before the date until the end of the delivery day (IST). */
export function relatedMessages(
  messages: EvidenceMessage[],
  customer: CustomerRef,
  date: string,
  lookbackDays = 7
): EvidenceMessage[] {
  const from = istDayStartMs(addDays(date, -lookbackDays));
  const to = istDayStartMs(addDays(date, 1));
  return messages.filter(message => {
    const t = Date.parse(message.receivedAt);
    return t >= from && t < to && mentionsCustomer(message, customer);
  });
}

/** Schedule cause codes that mean the stored record, not the logic, is wrong. */
export function isDataCause(scheduleCause: string): boolean {
  return /^(A_NOT_IN_DB|B_NO_SUBSCRIPTION|B_SUB_|F_BOUQUET_NOT_IN_DB|F_ONE_TIME_OTHER_DATE|BOT_ONE_TIME|field:(zone|package|pack|revenue))/.test(scheduleCause);
}

const ACTED = new Set(['NEW_ORDER', 'CUSTOMER_UPDATE']);

export function attribute(diff: SheetDiff, related: EvidenceMessage[], cutoffIso: string): AttributedDiff {
  const cutoff = Date.parse(cutoffIso);
  const before = related.filter(m => Date.parse(m.receivedAt) <= cutoff);
  const after = related.filter(m => Date.parse(m.receivedAt) > cutoff);
  const ids = (list: EvidenceMessage[]) => list.map(m => m.id);

  const stuck = before.filter(m => m.escalated && (!m.resolvedAt || Date.parse(m.resolvedAt) > cutoff));
  if (stuck.length) {
    return { ...diff, cause: 'STUCK_IN_REVIEW', messageIds: ids(stuck), detail: 'escalated before the cutoff, unresolved when the sheet was built' };
  }
  const acted = before.filter(m => (m.classification && ACTED.has(m.classification) && !m.escalated) || (m.escalated && m.resolvedAt));
  if (acted.length) {
    return { ...diff, cause: 'MISPARSED', messageIds: ids(acted), detail: `acted on (${acted.map(m => m.actionTaken || 'resolved in Review').join('; ').slice(0, 160)}) but the sheet is still wrong` };
  }
  const unparsed = before.filter(m => m.classification === null || m.classification === 'NOTE');
  if (unparsed.length) {
    return { ...diff, cause: 'UNPARSED', messageIds: ids(unparsed), detail: 'arrived in time but was not understood (no log entry, or only a note)' };
  }
  if (after.length) {
    return { ...diff, cause: 'LATE', messageIds: ids(after), detail: `first related message ${istTimestamp(after[0].receivedAt)}, after the ${istTimestamp(cutoffIso)} cutoff` };
  }
  if (isDataCause(diff.scheduleCause)) {
    return { ...diff, cause: 'DATA', messageIds: [], detail: `no related message; record problem (${diff.scheduleCause})` };
  }
  return { ...diff, cause: 'NO_MESSAGE', messageIds: [], detail: `no related message; scheduling logic (${diff.scheduleCause})` };
}

/** Money errors: a wrong amount to collect, or a wrong paid/unpaid state. */
export function isMoneyError(diff: SheetDiff): boolean {
  if (diff.kind !== 'field' || diff.field !== 'collect') return false;
  // Amit's Payment column is filled in after the run; a blank/0 there is not evidence of an error.
  return Number(diff.amitValue ?? 0) !== 0 && Number(diff.amitValue) !== Number(diff.botValue);
}

/** Hide phone numbers in report text; the report may leave the machine. */
export function maskPhones(text: string): string {
  return text.replace(/(?:\+?91[\s-]*)?([6-9])(?:[\s-]*\d){5}((?:[\s-]*\d){4})\b/g, (_m, first, last) => `${first}xxxxx${last.replace(/\D/g, '')}`);
}
