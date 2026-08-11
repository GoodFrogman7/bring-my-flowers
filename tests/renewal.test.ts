import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, BusinessDb } from '../src/business/db';
import { autoRenewDueSubscriptions, flagDormantForReview } from '../src/business/renewal';

const TODAY = '2026-08-11'; // Tuesday

let db: BusinessDb;

interface SeedOptions {
  id: string;
  day: string;
  status?: 'ACTIVE' | 'HOLD' | 'CLOSED';
  isGift?: boolean;
  lastDeliveryDate: string;
  lastDeliveryStatus?: 'DELIVERED' | 'PLANNED';
}

/** One subscriber with a single 1-delivery "cycle" whose last date is `lastDeliveryDate`. */
function seedSubscriber(opts: SeedOptions) {
  const subId = Number(opts.id) + 1000;
  db.prepare(`INSERT INTO customers (id, name, phones, address, zone) VALUES (?, ?, '9876543210', 'H-1', 'Zone A')`)
    .run(opts.id, `Customer ${opts.id}`);
  db.prepare(`
    INSERT INTO subscriptions (id, customer_id, package_name, pack_amount, frequency, day, time_slot, status, is_gift)
    VALUES (?, ?, 'Bliss', 1450, 'WEEKLY', ?, '9 AM - 12 PM', ?, ?)
  `).run(subId, opts.id, opts.day, opts.status ?? 'ACTIVE', opts.isGift ? 1 : 0);
  const cycleId = db.prepare(`
    INSERT INTO cycles (subscription_id, renewal_date, deliveries_planned, pack_amount, per_delivery_revenue, payment_status, collect)
    VALUES (?, ?, 4, 1450, 362.5, 'COMPLETED', 0)
  `).run(subId, opts.lastDeliveryDate).lastInsertRowid as number;
  db.prepare(`INSERT INTO deliveries (cycle_id, seq, planned_date, status) VALUES (?, 1, ?, ?)`)
    .run(cycleId, opts.lastDeliveryDate, opts.lastDeliveryStatus ?? 'DELIVERED');
}

beforeEach(() => {
  db = openDb(':memory:');
});

describe('autoRenewDueSubscriptions', () => {
  it('renews an ACTIVE subscriber whose last delivery has already passed', () => {
    seedSubscriber({ id: '1', day: 'Friday', lastDeliveryDate: '2026-08-01' });
    const result = autoRenewDueSubscriptions(db, TODAY);

    expect(result.renewed.map(r => r.customerId)).toEqual(['1']);
    expect(result.flagged).toEqual([]);

    const newCycles = db.prepare(`
      SELECT COUNT(*) AS n FROM cycles cy
      JOIN subscriptions s ON s.id = cy.subscription_id
      WHERE s.customer_id = '1'
    `).get() as { n: number };
    expect(newCycles.n).toBe(2); // the original + the auto-created one

    const planned = db.prepare(`
      SELECT d.planned_date FROM deliveries d
      JOIN cycles cy ON cy.id = d.cycle_id
      JOIN subscriptions s ON s.id = cy.subscription_id
      WHERE s.customer_id = '1' AND d.status = 'PLANNED'
      ORDER BY d.planned_date
    `).all() as Array<{ planned_date: string }>;
    expect(planned.length).toBe(4);
    expect(planned[0].planned_date > TODAY).toBe(true);
  });

  it('does not renew a subscriber with a future PLANNED delivery already on the books', () => {
    seedSubscriber({ id: '2', day: 'Friday', lastDeliveryDate: '2026-08-14', lastDeliveryStatus: 'PLANNED' });
    const result = autoRenewDueSubscriptions(db, TODAY);
    expect(result.renewed).toEqual([]);
    expect(result.flagged).toEqual([]);
  });

  it('skips HOLD and CLOSED subscriptions', () => {
    seedSubscriber({ id: '3', day: 'Friday', status: 'HOLD', lastDeliveryDate: '2026-08-01' });
    seedSubscriber({ id: '4', day: 'Friday', status: 'CLOSED', lastDeliveryDate: '2026-08-01' });
    const result = autoRenewDueSubscriptions(db, TODAY);
    expect(result.renewed).toEqual([]);
    expect(result.flagged).toEqual([]);
  });

  it('skips gift subscriptions — bounded by design, needs an explicit renew', () => {
    seedSubscriber({ id: '5', day: 'Friday', isGift: true, lastDeliveryDate: '2026-08-01' });
    const result = autoRenewDueSubscriptions(db, TODAY);
    expect(result.renewed).toEqual([]);
    expect(result.flagged).toEqual([]);
  });

  it('flags (does not renew) a subscriber dormant beyond the window', () => {
    seedSubscriber({ id: '6', day: 'Friday', lastDeliveryDate: '2026-06-01' }); // 71 days dormant
    const result = autoRenewDueSubscriptions(db, TODAY, 21);
    expect(result.renewed).toEqual([]);
    expect(result.flagged).toHaveLength(1);
    expect(result.flagged[0]).toMatchObject({ customerId: '6', lastDelivery: '2026-06-01' });
    expect(result.flagged[0].daysSince).toBeGreaterThan(21);
  });

  it('is idempotent — calling twice does not double-book', () => {
    seedSubscriber({ id: '7', day: 'Friday', lastDeliveryDate: '2026-08-01' });
    autoRenewDueSubscriptions(db, TODAY);
    const second = autoRenewDueSubscriptions(db, TODAY);
    expect(second.renewed).toEqual([]);

    const plannedCount = db.prepare(`
      SELECT COUNT(*) AS n FROM deliveries d
      JOIN cycles cy ON cy.id = d.cycle_id
      JOIN subscriptions s ON s.id = cy.subscription_id
      WHERE s.customer_id = '7' AND d.status = 'PLANNED'
    `).get() as { n: number };
    expect(plannedCount.n).toBe(4); // not 8
  });
});

describe('flagDormantForReview', () => {
  it('surfaces a flagged dormant customer on the dashboard Review queue', () => {
    seedSubscriber({ id: '8', day: 'Friday', lastDeliveryDate: '2026-06-01' });
    const result = autoRenewDueSubscriptions(db, TODAY, 21);
    const created = flagDormantForReview(db, result.flagged, '2026-08-11T10:00:00.000Z');
    expect(created).toBe(1);

    const reviewRows = db.prepare(`
      SELECT classification, matched_customer_id, escalated, resolved_at, escalation_reason
      FROM group_update_log WHERE matched_customer_id = '8'
    `).all() as Array<{ classification: string; matched_customer_id: string; escalated: number; resolved_at: string | null; escalation_reason: string }>;
    expect(reviewRows).toHaveLength(1);
    expect(reviewRows[0].escalated).toBe(1);
    expect(reviewRows[0].resolved_at).toBeNull();
    expect(reviewRows[0].escalation_reason).toContain('dormant 71d');
  });

  it('does not create a duplicate flag for a customer already open in the review queue', () => {
    seedSubscriber({ id: '9', day: 'Friday', lastDeliveryDate: '2026-06-01' });
    const result = autoRenewDueSubscriptions(db, TODAY, 21);
    flagDormantForReview(db, result.flagged, '2026-08-11T10:00:00.000Z');
    const secondRun = flagDormantForReview(db, result.flagged, '2026-08-12T10:00:00.000Z');
    expect(secondRun).toBe(0);

    const count = (db.prepare(`SELECT COUNT(*) AS n FROM group_update_log WHERE matched_customer_id = '9'`).get() as { n: number }).n;
    expect(count).toBe(1);
  });

  it('re-flags after the earlier flag was resolved', () => {
    seedSubscriber({ id: '10', day: 'Friday', lastDeliveryDate: '2026-06-01' });
    const result = autoRenewDueSubscriptions(db, TODAY, 21);
    flagDormantForReview(db, result.flagged, '2026-08-11T10:00:00.000Z');
    db.prepare(`UPDATE group_update_log SET resolved_at = '2026-08-11T12:00:00.000Z' WHERE matched_customer_id = '10'`).run();

    const secondRun = flagDormantForReview(db, result.flagged, '2026-08-12T10:00:00.000Z');
    expect(secondRun).toBe(1);
  });
});
