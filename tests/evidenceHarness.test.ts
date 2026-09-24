import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { openDb } from '../src/business/db';
import { insertGroupMessage } from '../src/business/groupUpdates';
import { assertNotLiveDb, loadCustomers, loadEvidenceMessages, openEvidenceCopy } from '../scripts/evidence/evidenceDb';
import { buildBaseline, CompareDetails, renderBaseline } from '../scripts/evidence/accuracy-baseline';
import { Corpus, probeMessage } from '../scripts/evidence/probe-corpus';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bmf-evidence-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** A small database copy: one customer, a late hold, an unresolved Review item, and a pasted update. */
function seedCopy(): string {
  const dbPath = path.join(dir, 'business-copy.db');
  const db = openDb(dbPath);
  db.prepare(`INSERT INTO customers (id, name, phones) VALUES ('9001', 'Meera Kapoor', '9000000001')`).run();
  db.prepare(`INSERT INTO customers (id, name, phones) VALUES ('9002', 'Anita Rao', '9000000002//9000000022')`).run();
  // 23:36 IST on the 23rd — after the 21:30 cutoff for the 24th's sheet.
  insertGroupMessage(db, '919812345678@s.whatsapp.net', 'HOld Meera Kapoor', '2026-09-23T18:06:00.000Z');
  const stuck = insertGroupMessage(db, '919812345678@s.whatsapp.net', 'Anita Rao pause 24th', '2026-09-23T09:00:00.000Z');
  db.prepare(`INSERT INTO group_update_log (message_id, classification, escalated, escalation_reason, created_at)
              VALUES (?, 'UNCLEAR', 1, 'No deterministic customer', '2026-09-23')`).run(stuck);
  insertGroupMessage(db, 'dashboard', 'Hold Anita Rao', '2026-09-23T09:30:00.000Z');
  db.close();
  return dbPath;
}

const details: CompareDetails = {
  results: [{
    date: '2026-09-24',
    amitSource: '24th Sept 26 Del Sheet.xlsx',
    regen: { amitRows: 0, botRows: 0, common: 0, amitOnly: [], botOnly: [], mismatches: [] },
    file: {
      amitRows: 4,
      botRows: 5,
      common: 3,
      amitOnly: [{ id: 'B-777', name: 'Walk-in Bouquet', cause: { code: 'F_BOUQUET_NOT_IN_DB', detail: '' } }],
      botOnly: [
        { id: '9001', name: 'Meera Kapoor', cause: { code: 'BOT_EXTRA_ACTIVE_WEEKLY', detail: '' } },
        { id: '9002', name: 'Anita Rao', cause: { code: 'BOT_EXTRA_ACTIVE_WEEKLY', detail: '' } }
      ],
      mismatches: [
        { id: '9003', name: 'Rohan Mehta', field: 'collect', amit: '600', bot: '0' },
        { id: '9004', name: 'Isha Malhotra', field: 'collect', amit: '0', bot: '1450' }
      ]
    }
  }]
};

describe('evidence database access', () => {
  it('refuses the live database, including via BUSINESS_DB', () => {
    expect(() => assertNotLiveDb('data/business.db', {}, dir)).toThrow(/Refusing/);
    expect(() => assertNotLiveDb('live/prod.db', { BUSINESS_DB: 'live/prod.db' }, dir)).toThrow(/Refusing/);
    expect(() => assertNotLiveDb('copies/business-copy.db', {}, dir)).not.toThrow();
  });

  it('loads group messages with their log rows, skipping pasted dashboard updates', () => {
    const db = openEvidenceCopy(seedCopy());
    const messages = loadEvidenceMessages(db);
    const customers = loadCustomers(db);
    db.close();

    expect(messages.map(m => m.text)).toEqual(['Anita Rao pause 24th', 'HOld Meera Kapoor']);
    expect(messages[0]).toMatchObject({ classification: 'UNCLEAR', escalated: true, resolvedAt: null });
    expect(messages[1]).toMatchObject({ classification: null, escalated: false });
    expect(customers.get('9002')?.phones).toEqual(['9000000002', '9000000022']);
  });

  it('opens the copy read-only', () => {
    const db = openEvidenceCopy(seedCopy());
    expect(() => db.prepare(`DELETE FROM customers`).run()).toThrow(/readonly/i);
    db.close();
  });
});

describe('accuracy baseline', () => {
  it('attributes each difference and scores the day', () => {
    const db = openEvidenceCopy(seedCopy());
    const messages = loadEvidenceMessages(db);
    const customers = loadCustomers(db);
    db.close();

    const baseline = buildBaseline(details, messages, customers);
    const [day] = baseline.days;
    expect(day.basis).toBe('bot file');
    const causes = Object.fromEntries(day.diffs.map(d => [d.customer.id, d.cause]));
    expect(causes).toEqual({
      'B-777': 'DATA',            // bouquet never entered, no message about it
      '9001': 'LATE',             // hold arrived 23:36 IST, after the 21:30 cutoff
      '9002': 'STUCK_IN_REVIEW',  // escalated at 14:30 IST, never resolved
      '9003': 'NO_MESSAGE'        // real collect difference, no message
    });
    // The Amit Payment=0 row is not a difference; the ₹600 one is a money error.
    expect(day.moneyErrors).toBe(1);
    // 3 common rows, one with a material mismatch → 2 identical of 4 Amit + 2 bot-only rows.
    expect(day.identical).toBe(2);
    expect(day.union).toBe(6);

    const report = renderBaseline(baseline, messages);
    expect(report).toContain('Row-level match: 33.3%');
    expect(report).toContain('Money errors: 1');
    expect(report).toContain('2026-09-23 23:36 IST');
    expect(report).not.toMatch(/9812345678/);
  });

  it('lists days without an Amit sheet instead of guessing them', () => {
    const twoDays: CompareDetails = {
      results: [
        { ...details.results[0], date: '2026-09-20' },
        { ...details.results[0], date: '2026-09-23' }
      ]
    };
    const baseline = buildBaseline(twoDays, [], new Map());
    expect(baseline.unscoredDates).toEqual(['2026-09-21', '2026-09-22']);
    expect(renderBaseline(baseline, [])).toContain('Not scored yet — no Amit sheet: 2026-09-21, 2026-09-22');
  });
});

describe('message corpus through the real pipeline', () => {
  const corpus = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/group-message-corpus.json'), 'utf8')) as Corpus;

  it('is anonymized: no real-looking phone numbers', () => {
    const text = JSON.stringify(corpus);
    const phones = text.match(/\b[6-9]\d{9}\b/g) ?? [];
    expect(phones.every(p => p.startsWith('9000000'))).toBe(true);
  });

  it('never lets a money or identity message change data without a human', async () => {
    for (const message of corpus.messages.filter(m => m.mustNotMutate)) {
      const result = await probeMessage(corpus, message);
      expect({ id: message.id, changes: result.changes }).toEqual({ id: message.id, changes: [] });
    }
  });
});
