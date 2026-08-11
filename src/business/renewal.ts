import { BusinessDb } from './db';
import { addDays, nextWeekdayAfter } from './dates';
import { appendRemark } from './actions';
import { DAY_LABELS } from '../utils/recurrence';
import logger from '../utils/logger';

/**
 * Create the next cycle for a customer's subscription: 4 weekly deliveries on
 * the fixed day, or 8 biweekly (paired: fixed day + 3 days later, the
 * Sun/Thu-style split the zones run on). Payment starts PENDING with the full
 * pack to collect. The renewal moment is the business's main revenue leak —
 * this makes saying "renew" enough to lock the next cycle in.
 */

export interface RenewalResult {
  ok: boolean;
  message: string;
  firstDelivery?: string;
}

export function createNextCycle(db: BusinessDb, customerId: string, today: string): RenewalResult {
  const subscription = db.prepare(`
    SELECT id, package_name, pack_amount, frequency, day, status
    FROM subscriptions WHERE customer_id = ? ORDER BY id DESC LIMIT 1
  `).get(customerId) as { id: number; package_name: string; pack_amount: number; frequency: string; day: string; status: string } | undefined;

  if (!subscription) {
    return { ok: false, message: `No subscription found for #${customerId}.` };
  }

  // Guard: don't stack cycles if one still has planned deliveries ahead
  const openDeliveries = db.prepare(`
    SELECT COUNT(*) AS n FROM deliveries d
    JOIN cycles cy ON d.cycle_id = cy.id
    WHERE cy.subscription_id = ? AND d.status = 'PLANNED'
      AND COALESCE(NULLIF(d.changed_date, ''), d.planned_date) >= ?
  `).get(subscription.id, today) as { n: number };
  if (openDeliveries.n > 0) {
    return { ok: false, message: `#${customerId} still has ${openDeliveries.n} planned deliveries — no new cycle created.` };
  }

  const biweekly = subscription.frequency === 'BIWEEKLY';
  const deliveriesPlanned = biweekly ? 8 : 4;
  const perDelivery = subscription.pack_amount / deliveriesPlanned;

  const fixedDay = DAY_LABELS.findIndex(d => d.toLowerCase() === subscription.day.toLowerCase());
  const firstDate = fixedDay >= 0 ? nextWeekdayAfter(today, fixedDay) : addDays(today, 1);

  const createCycle = db.transaction(() => {
    const cycleId = db.prepare(`
      INSERT INTO cycles (subscription_id, renewal_date, deliveries_planned, pack_amount,
                          per_delivery_revenue, payment_status, collect, remarks)
      VALUES (?, ?, ?, ?, ?, 'PENDING', ?, 'Auto-created on renewal')
    `).run(subscription.id, today, deliveriesPlanned, subscription.pack_amount, perDelivery, subscription.pack_amount)
      .lastInsertRowid as number;

    const insertDelivery = db.prepare(`
      INSERT INTO deliveries (cycle_id, seq, planned_date, status) VALUES (?, ?, ?, 'PLANNED')`);
    let weekStart = firstDate;
    let seq = 1;
    for (let week = 0; week < 4; week++) {
      insertDelivery.run(cycleId, seq++, weekStart);
      if (biweekly) insertDelivery.run(cycleId, seq++, addDays(weekStart, 3));
      weekStart = addDays(weekStart, 7);
    }

    db.prepare(`UPDATE subscriptions SET status = 'ACTIVE' WHERE id = ?`).run(subscription.id);
  });
  createCycle();

  appendRemark(db, customerId, `Renewed - ${deliveriesPlanned} del from ${firstDate}`, today);
  logger.info({ customer: customerId, firstDate, deliveriesPlanned }, 'Renewal cycle created');

  return {
    ok: true,
    firstDelivery: firstDate,
    message: `${subscription.package_name} ₹${subscription.pack_amount} renewed: ${deliveriesPlanned} deliveries starting ${firstDate}${biweekly ? ' (biweekly — check the second weekday!)' : ''}. Payment pending ₹${subscription.pack_amount}.`
  };
}

export interface AutoRenewSummary {
  renewed: Array<{ customerId: string; name: string; firstDelivery: string }>;
  /** Dormant longer than `withinDays` — left alone, surfaced for a human to check before resuming. */
  flagged: Array<{ customerId: string; name: string; lastDelivery: string; daysSince: number }>;
}

/**
 * The nightly safety net: real customers essentially never text "renew" —
 * the owner just keeps extending everyone by default. Without this, every
 * subscription silently stops appearing on the delivery sheet the moment its
 * current cycle's deliveries run out. Mirrors `renewalsDue` in
 * paymentRun.ts (same "ACTIVE subscription, last delivery date is in the
 * past" shape) but acts instead of just reporting, and excludes gift
 * subscriptions (G- prefixed IDs) — those are bounded by design and should
 * wait for an explicit renew, not auto-continue forever.
 *
 * Anything dormant longer than `withinDays` is left untouched and flagged
 * instead of renewed, so a subscription that actually lapsed (and was never
 * marked CLOSED) doesn't get silently resurrected.
 */
export function autoRenewDueSubscriptions(db: BusinessDb, today: string, withinDays: number = 21): AutoRenewSummary {
  const rows = db.prepare(`
    SELECT c.id AS customer_id, c.name,
           MAX(COALESCE(NULLIF(d.changed_date, ''), d.planned_date)) AS last_delivery
    FROM subscriptions s
    JOIN customers c ON s.customer_id = c.id
    JOIN cycles cy ON cy.subscription_id = s.id
    JOIN deliveries d ON d.cycle_id = cy.id
    WHERE s.status = 'ACTIVE' AND s.is_gift = 0
    GROUP BY s.id
    HAVING last_delivery < ?
    ORDER BY last_delivery DESC
  `).all(today) as Array<{ customer_id: string; name: string; last_delivery: string }>;

  const summary: AutoRenewSummary = { renewed: [], flagged: [] };

  for (const row of rows) {
    const daysSince = Math.round(
      (new Date(`${today}T00:00:00Z`).getTime() - new Date(`${row.last_delivery}T00:00:00Z`).getTime()) / 86400000
    );
    if (daysSince > withinDays) {
      summary.flagged.push({ customerId: row.customer_id, name: row.name, lastDelivery: row.last_delivery, daysSince });
      continue;
    }
    const result = createNextCycle(db, row.customer_id, today);
    if (result.ok && result.firstDelivery) {
      summary.renewed.push({ customerId: row.customer_id, name: row.name, firstDelivery: result.firstDelivery });
    }
  }

  if (summary.renewed.length > 0 || summary.flagged.length > 0) {
    logger.info(
      { renewed: summary.renewed.length, flagged: summary.flagged.length, withinDays },
      'Auto-renewal sweep complete'
    );
  }

  return summary;
}

const DORMANT_TAG = 'auto_renew_dormant';

/**
 * Surface `flagged` (dormant-beyond-window) customers on the owner dashboard's
 * existing Review queue (group_update_log, escalated=1) instead of only the
 * server log — otherwise nobody sees them. Reuses the message-driven
 * review/escalation machinery via a synthetic system "message", since
 * group_update_log requires one; dedupes against any still-open flag for the
 * same customer so a permanently-dormant subscriber doesn't reappear every
 * night the sweep runs.
 */
export function flagDormantForReview(db: BusinessDb, flagged: AutoRenewSummary['flagged'], now: string): number {
  const alreadyOpen = db.prepare(`
    SELECT 1 FROM group_update_log
    WHERE matched_customer_id = ? AND action_taken = ? AND resolved_at IS NULL
  `);
  const insertMessage = db.prepare(`
    INSERT INTO group_messages (participant, message_text, received_at, processed_at)
    VALUES ('system', ?, ?, ?)
  `);
  const insertLog = db.prepare(`
    INSERT INTO group_update_log (message_id, classification, matched_customer_id, action_taken, escalated, escalation_reason, created_at)
    VALUES (?, 'NOTE', ?, ?, 1, ?, ?)
  `);

  let created = 0;
  for (const item of flagged) {
    if (alreadyOpen.get(item.customerId, DORMANT_TAG)) continue;
    const text = `#${item.customerId} ${item.name} has had no delivery in ${item.daysSince} days (last: ${item.lastDelivery}) and wasn't auto-renewed.`;
    const messageId = insertMessage.run(text, now, now).lastInsertRowid as number;
    insertLog.run(
      messageId,
      item.customerId,
      DORMANT_TAG,
      `Subscription dormant ${item.daysSince}d — confirm still active (renew #${item.customerId}) or mark it closed.`,
      now
    );
    created++;
  }
  return created;
}
