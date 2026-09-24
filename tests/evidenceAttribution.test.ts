import { describe, it, expect } from 'vitest';
import {
  attribute,
  CustomerRef,
  EvidenceMessage,
  isDataCause,
  isMoneyError,
  istTimestamp,
  maskPhones,
  mentionsCustomer,
  relatedMessages,
  SheetDiff,
  sheetCutoff
} from '../scripts/evidence/attribution';

const MEERA: CustomerRef = { id: '9001', name: 'Meera Kapoor', phones: ['9000000001'] };
// The sheet for 2026-09-24 is built at 21:30 IST on 2026-09-23 = 16:00 UTC.
const CUTOFF = '2026-09-23T16:00:00.000Z';

function message(overrides: Partial<EvidenceMessage>): EvidenceMessage {
  return {
    id: 1,
    participant: '910000000000',
    text: 'HOld Meera Kapoor',
    receivedAt: '2026-09-23T10:00:00.000Z',
    classification: null,
    actionTaken: '',
    escalated: false,
    resolvedAt: null,
    matchedCustomerId: null,
    ...overrides
  };
}

const missed: SheetDiff = { date: '2026-09-24', kind: 'botOnly', customer: MEERA, scheduleCause: 'BOT_EXTRA_ACTIVE_WEEKLY' };

describe('time handling', () => {
  it('builds the sheet cutoff the evening before, in IST', () => {
    expect(sheetCutoff('2026-09-24')).toBe(CUTOFF);
    expect(sheetCutoff('2026-09-24', '06:00')).toBe('2026-09-23T00:30:00.000Z');
  });

  it('formats UTC instants in IST', () => {
    expect(istTimestamp('2026-09-23T18:06:00.000Z')).toBe('2026-09-23 23:36 IST');
    expect(istTimestamp('2026-09-23T18:25:00.000Z')).toBe('2026-09-23 23:55 IST');
  });
});

describe('mentionsCustomer', () => {
  it('matches full names regardless of case and punctuation', () => {
    expect(mentionsCustomer(message({ text: 'HOld Meera Kapoor' }), MEERA)).toBe(true);
    expect(mentionsCustomer(message({ text: 'meera   KAPOOR - kal call mat uthana' }), MEERA)).toBe(true);
    expect(mentionsCustomer(message({ text: 'Meera S. Kapoor ko hold' }), MEERA)).toBe(true);
  });

  it('matches phone numbers and the bot\'s own customer match', () => {
    expect(mentionsCustomer(message({ text: 'call +91 90000 00001 first' }), MEERA)).toBe(true);
    expect(mentionsCustomer(message({ text: 'unrelated', matchedCustomerId: '9001' }), MEERA)).toBe(true);
  });

  it('never matches on a first name alone or another customer', () => {
    expect(mentionsCustomer(message({ text: 'Meera wants lilies' }), MEERA)).toBe(false);
    expect(mentionsCustomer(message({ text: 'Hold Meera Sharma' }), MEERA)).toBe(false);
  });

  it('ignores short numeric IDs that collide with dates and amounts', () => {
    const shortId: CustomerRef = { id: '12', name: 'Anita Rao', phones: [] };
    expect(mentionsCustomer(message({ text: 'pause 12 and 16' }), shortId)).toBe(false);
    const gift: CustomerRef = { id: 'G-00012', name: 'Gift One', phones: [] };
    expect(mentionsCustomer(message({ text: 'hold g-00012 today' }), gift)).toBe(true);
  });
});

describe('relatedMessages', () => {
  it('keeps messages from the lookback window through the end of the delivery day (IST)', () => {
    const messages = [
      message({ id: 1, receivedAt: '2026-09-16T18:29:00.000Z' }), // 2026-09-16 23:59 IST — outside 7-day window
      message({ id: 2, receivedAt: '2026-09-16T18:31:00.000Z' }), // 2026-09-17 00:01 IST — inside
      message({ id: 3, receivedAt: '2026-09-24T18:29:00.000Z' }), // 2026-09-24 23:59 IST — inside
      message({ id: 4, receivedAt: '2026-09-24T18:31:00.000Z' }), // 2026-09-25 IST — outside
      message({ id: 5, text: 'Hold Anita Rao' })
    ];
    expect(relatedMessages(messages, MEERA, '2026-09-24').map(m => m.id)).toEqual([2, 3]);
  });
});

describe('attribute', () => {
  it('LATE when every related message arrived after the cutoff', () => {
    const late = message({ id: 7, receivedAt: '2026-09-23T18:06:00.000Z' });
    const result = attribute(missed, [late], CUTOFF);
    expect(result.cause).toBe('LATE');
    expect(result.messageIds).toEqual([7]);
    expect(result.detail).toContain('2026-09-23 23:36 IST');
  });

  it('STUCK_IN_REVIEW when escalated before the cutoff and still unresolved', () => {
    expect(attribute(missed, [message({ escalated: true, classification: 'UNCLEAR' })], CUTOFF).cause).toBe('STUCK_IN_REVIEW');
    // Resolved only after the sheet was built still counts as stuck.
    expect(attribute(missed, [message({ escalated: true, classification: 'UNCLEAR', resolvedAt: '2026-09-23T20:00:00.000Z' })], CUTOFF).cause)
      .toBe('STUCK_IN_REVIEW');
  });

  it('MISPARSED when a message was acted on in time but the sheet is still wrong', () => {
    const acted = message({ classification: 'CUSTOMER_UPDATE', actionTaken: 'SKIP_TODAY applied' });
    expect(attribute(missed, [acted], CUTOFF).cause).toBe('MISPARSED');
    const resolved = message({ escalated: true, classification: 'UNCLEAR', resolvedAt: '2026-09-23T12:00:00.000Z' });
    expect(attribute(missed, [resolved], CUTOFF).cause).toBe('MISPARSED');
  });

  it('UNPARSED when an in-time message was never logged or only kept as a note', () => {
    expect(attribute(missed, [message({ classification: null })], CUTOFF).cause).toBe('UNPARSED');
    expect(attribute(missed, [message({ classification: 'NOTE', actionTaken: 'Note appended' })], CUTOFF).cause).toBe('UNPARSED');
  });

  it('prefers in-time evidence over a late follow-up', () => {
    const early = message({ id: 1, escalated: true, classification: 'UNCLEAR' });
    const late = message({ id: 2, receivedAt: '2026-09-23T18:06:00.000Z' });
    expect(attribute(missed, [early, late], CUTOFF).cause).toBe('STUCK_IN_REVIEW');
  });

  it('DATA vs NO_MESSAGE when there is no related message', () => {
    expect(attribute({ ...missed, kind: 'amitOnly', scheduleCause: 'A_NOT_IN_DB' }, [], CUTOFF).cause).toBe('DATA');
    expect(attribute({ ...missed, kind: 'amitOnly', scheduleCause: 'B_SUB_HOLD' }, [], CUTOFF).cause).toBe('DATA');
    expect(attribute({ ...missed, kind: 'amitOnly', scheduleCause: 'D_DAY_SHIFT_BIWEEKLY' }, [], CUTOFF).cause).toBe('NO_MESSAGE');
    expect(attribute({ ...missed, kind: 'amitOnly', scheduleCause: 'C_NO_CYCLE_COVERAGE' }, [], CUTOFF).cause).toBe('NO_MESSAGE');
  });
});

describe('helpers', () => {
  it('classifies record-level cause codes as DATA', () => {
    expect(isDataCause('F_BOUQUET_NOT_IN_DB')).toBe(true);
    expect(isDataCause('field:zone')).toBe(true);
    expect(isDataCause('field:timeSlot')).toBe(false);
    expect(isDataCause('E_ON_DATE_HELD')).toBe(false);
  });

  it('counts only real collect differences as money errors', () => {
    const base: SheetDiff = { date: '2026-09-24', kind: 'field', customer: MEERA, scheduleCause: 'field:collect', field: 'collect' };
    expect(isMoneyError({ ...base, amitValue: '600', botValue: '0' })).toBe(true);
    expect(isMoneyError({ ...base, amitValue: '0', botValue: '1450' })).toBe(false); // filled in after the run
    expect(isMoneyError({ ...base, field: 'timeSlot', amitValue: 'AM', botValue: 'PM' })).toBe(false);
  });

  it('masks Indian mobile numbers in report text', () => {
    expect(maskPhones('call 9876543210 or +91 98765 43210')).toBe('call 9xxxxx3210 or 9xxxxx3210');
    expect(maskPhones('collect 600 on 2026-09-24')).toBe('collect 600 on 2026-09-24');
  });
});
