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
