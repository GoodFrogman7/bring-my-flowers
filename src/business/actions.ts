import { BusinessDb } from './db';
import { Instruction } from './instructions';
import { addDays, nextWeekdayAfter, remarkStamp, weekdayOf, ordinal } from './dates';
import { DAY_LABELS } from '../utils/recurrence';
import logger from '../utils/logger';

/**
 * Apply a parsed customer instruction to the datastore. Every action appends
 * a date-stamped remark in the owner's own format ("Hold 1 week (06/07)") so
 * the generated sheets read exactly like the ones he writes by hand, and
 * returns the customer reply plus an optional owner alert. Money-moving
 * decisions (payment verification, cancellation) always alert a human.
 */

export interface CustomerRecord {
  id: string;
  name: string;
  phones: string;
  address: string;
  zone: string;
}

export interface ActionResult {
  reply: string;
  ownerAlert?: string;
}

interface SubscriptionRow {
  id: number;
  day: string;
  day2: string;
  frequency: string;
  status: string;
  package_name: string;
  pack_amount: number;
}

interface DeliveryRow {
  id: number;
  seq: number;
  planned_date: string;
  changed_date: string;
  cycle_id: number;
  deliveries_planned: number;
  payment_status: string;
  collect: number;
}

/** Last-10-digit phone match against the '//'-separated phones column. */
export function findCustomerByPhone(db: BusinessDb, rawPhone: string): CustomerRecord | null {
  const digits = rawPhone.replace(/\D/g, '');
  if (digits.length < 7) return null;
  const suffix = digits.slice(-10);
  const candidates = db.prepare(`
    SELECT id, name, phones, address, zone FROM customers WHERE phones LIKE ?
  `).all(`%${suffix}%`) as CustomerRecord[];
  if (candidates.length <= 1) return candidates[0] ?? null;
  // Multiple matches (shared family numbers): prefer one with a live subscription
  for (const candidate of candidates) {
    const live = db.prepare(`
      SELECT 1 FROM subscriptions WHERE customer_id = ? AND status IN ('ACTIVE','HOLD') LIMIT 1
    `).get(candidate.id);
    if (live) return candidate;
  }
  return candidates[0];
}

function currentSubscription(db: BusinessDb, customerId: string): SubscriptionRow | null {
  return (db.prepare(`
    SELECT id, day, day2, frequency, status, package_name, pack_amount
    FROM subscriptions WHERE customer_id = ? AND status IN ('ACTIVE','HOLD')
    ORDER BY id DESC LIMIT 1
  `).get(customerId) as SubscriptionRow | undefined) ?? null;
}

/** Remaining planned deliveries of the subscription's latest cycle, in date order. */
function upcomingDeliveries(db: BusinessDb, subscriptionId: number, fromDate: string): DeliveryRow[] {
  return db.prepare(`
    SELECT d.id, d.seq, d.planned_date, d.changed_date, d.cycle_id,
           cy.deliveries_planned, cy.payment_status, cy.collect
    FROM deliveries d
    JOIN cycles cy ON d.cycle_id = cy.id
    WHERE cy.subscription_id = ?
      AND d.status = 'PLANNED'
      AND COALESCE(NULLIF(d.changed_date, ''), d.planned_date) >= ?
    ORDER BY COALESCE(NULLIF(d.changed_date, ''), d.planned_date)
  `).all(subscriptionId, fromDate) as DeliveryRow[];
}

function effectiveDate(delivery: DeliveryRow): string {
  return delivery.changed_date || delivery.planned_date;
}

export function appendRemark(db: BusinessDb, customerId: string, note: string, today: string): void {
  const stamped = `${note} ${remarkStamp(today)}`;
  db.prepare(`
    UPDATE customers SET remarks = CASE WHEN remarks = '' THEN ? ELSE remarks || ' // ' || ? END
    WHERE id = ?
  `).run(stamped, stamped, customerId);
}

function setChangedDate(db: BusinessDb, deliveryId: number, date: string): void {
  db.prepare(`UPDATE deliveries SET changed_date = ? WHERE id = ?`).run(date, deliveryId);
}

const SIGNOFF = ' 🌸';

export function applyInstruction(
  db: BusinessDb,
  customer: CustomerRecord,
  instruction: Instruction,
  today: string
): ActionResult {
  const subscription = currentSubscription(db, customer.id);
  const label = `${customer.name} (#${customer.id})`;

  logger.info({ customer: customer.id, instruction }, 'Applying customer instruction');

  switch (instruction.type) {
    case 'SKIP_TODAY': {
      if (!subscription) return noSubscription(customer);
      const upcoming = upcomingDeliveries(db, subscription.id, today);
      if (upcoming.length === 0) {
        return { reply: `You have no upcoming delivery scheduled right now.${SIGNOFF}` };
      }
      const next = upcoming[0];
      const newDate = addDays(effectiveDate(next), 7);
      setChangedDate(db, next.id, newDate);
      appendRemark(db, customer.id, `Hold ${effectiveDate(next) === today ? 'today' : effectiveDate(next)} - moved to ${newDate}`, today);
      return {
        reply: `Done — we've held your delivery of ${effectiveDate(next)}. Next delivery: ${newDate}.${SIGNOFF}`,
        ownerAlert: `⏸ ${label}: delivery ${effectiveDate(next)} held → ${newDate}`
      };
    }

    case 'SKIP': {
      if (!subscription) return noSubscription(customer);
      const upcoming = upcomingDeliveries(db, subscription.id, today);
      if (upcoming.length === 0) {
        return { reply: `You have no upcoming deliveries scheduled right now.${SIGNOFF}` };
      }
      const shift = instruction.weeks * 7;
      for (const delivery of upcoming) {
        setChangedDate(db, delivery.id, addDays(effectiveDate(delivery), shift));
      }
      appendRemark(db, customer.id, `Skip ${instruction.weeks} week${instruction.weeks > 1 ? 's' : ''}`, today);
      const next = addDays(effectiveDate(upcoming[0]), shift);
      return {
        reply: `Done — we've skipped ${instruction.weeks} week${instruction.weeks > 1 ? 's' : ''}. Your next delivery: ${next}.${SIGNOFF}`,
        ownerAlert: `⏸ ${label}: skipped ${instruction.weeks} week(s), resumes ${next}`
      };
    }

    case 'HOLD_INDEFINITE': {
      if (!subscription) return noSubscription(customer);
      db.prepare(`UPDATE subscriptions SET status = 'HOLD' WHERE id = ?`).run(subscription.id);
      appendRemark(db, customer.id, 'Hold till further notice', today);
      return {
        reply: `Done — your subscription is on hold. Message us "resume" whenever you'd like deliveries again.${SIGNOFF}`,
        ownerAlert: `⏸ ${label}: subscription on HOLD (indefinite)`
      };
    }

    case 'RESUME': {
      if (!subscription) return noSubscription(customer);
      db.prepare(`UPDATE subscriptions SET status = 'ACTIVE' WHERE id = ?`).run(subscription.id);
      const upcoming = upcomingDeliveries(db, subscription.id, '0000-01-01');
      const fixedDay = DAY_LABELS.findIndex(d => d.toLowerCase() === subscription.day.toLowerCase());
      let cursor = fixedDay >= 0 ? nextWeekdayAfter(today, fixedDay) : addDays(today, 1);
      for (const delivery of upcoming) {
        if (effectiveDate(delivery) <= today) {
          setChangedDate(db, delivery.id, cursor);
          cursor = addDays(cursor, subscription.frequency === 'BIWEEKLY' ? 3 : 7);
        }
      }
      appendRemark(db, customer.id, 'Resumed', today);
      const next = upcomingDeliveries(db, subscription.id, today)[0];
      return {
        reply: `Welcome back! Your deliveries resume ${next ? `on ${effectiveDate(next)}` : 'with your next cycle'}.${SIGNOFF}`,
        ownerAlert: `▶️ ${label}: subscription resumed${next ? `, next delivery ${effectiveDate(next)}` : ''}`
      };
    }

    case 'DAY_CHANGE': {
      if (!subscription) return noSubscription(customer);
      const newDay = DAY_LABELS[instruction.day];
      db.prepare(`UPDATE subscriptions SET day = ? WHERE id = ?`).run(newDay, subscription.id);
      const upcoming = upcomingDeliveries(db, subscription.id, today);
      for (const delivery of upcoming) {
        const current = effectiveDate(delivery);
        // Move within the same week where possible, else the next occurrence
        const sameWeek = addDays(current, (instruction.day - weekdayOf(current) + 7) % 7);
        setChangedDate(db, delivery.id, sameWeek > today ? sameWeek : nextWeekdayAfter(current, instruction.day));
      }
      appendRemark(db, customer.id, `Day changed to ${newDay}`, today);
      const next = upcomingDeliveries(db, subscription.id, today)[0];
      return {
        reply: `Done — your delivery day is now ${newDay}.${next ? ` Next delivery: ${effectiveDate(next)}.` : ''}${SIGNOFF}`,
        ownerAlert: `📅 ${label}: day changed to ${newDay}`
      };
    }

    case 'RESCHEDULE_NEXT': {
      if (!subscription) return noSubscription(customer);
      const upcoming = upcomingDeliveries(db, subscription.id, today);
      if (upcoming.length === 0) {
        return { reply: `You have no upcoming delivery to move right now.${SIGNOFF}` };
      }
      const next = upcoming[0];
      const from = effectiveDate(next);
      setChangedDate(db, next.id, instruction.date);
      appendRemark(db, customer.id, `Delivery ${from} moved to ${instruction.date}`, today);
      return {
        reply: `Done — your delivery is moved from ${from} to ${instruction.date}.${SIGNOFF}`,
        ownerAlert: `📅 ${label}: delivery ${from} → ${instruction.date}`
      };
    }

    case 'PAYMENT_CLAIM': {
      appendRemark(db, customer.id, `Payment claimed via ${instruction.mode}`, today);
      return {
        reply: `Thank you! We've noted your payment via ${instruction.mode} and will confirm shortly.${SIGNOFF}`,
        ownerAlert: `💰 VERIFY: ${label} says they paid via ${instruction.mode}. Reply "paid ${customer.id}" once confirmed.`
      };
    }

    case 'RESTRICTION': {
      const flower = instruction.flower.trim();
      db.prepare(`INSERT OR IGNORE INTO restrictions (customer_id, flower) VALUES (?, ?)`).run(customer.id, flower);
      appendRemark(db, customer.id, `No ${flower}`, today);
      return {
        reply: `Noted — no ${flower} in your deliveries from now on.${SIGNOFF}`,
        ownerAlert: `🚫 ${label}: restriction added — no ${flower}`
      };
    }

    case 'ADDRESS_CHANGE': {
      const old = customer.address;
      db.prepare(`UPDATE customers SET address = ? WHERE id = ?`).run(instruction.address, customer.id);
      appendRemark(db, customer.id, `Address changed (was: ${old.slice(0, 60)})`, today);
      return {
        reply: `Got it — your delivery address is updated.${SIGNOFF}`,
        ownerAlert: `🏠 ${label}: address changed to "${instruction.address.slice(0, 80)}" — confirm zone "${customer.zone}" still applies.`
      };
    }

    case 'STATUS': {
      if (!subscription) return noSubscription(customer);
      const upcoming = upcomingDeliveries(db, subscription.id, today);
      if (upcoming.length === 0) {
        return {
          reply: `Your current cycle is complete. Would you like to renew your ${subscription.package_name} subscription (₹${subscription.pack_amount})? Just reply "renew".${SIGNOFF}`
        };
      }
      const next = upcoming[0];
      const paymentLine = next.payment_status === 'PENDING' && next.collect > 0
        ? ` Pending payment: ₹${next.collect}.`
        : '';
      return {
        reply: `Your next delivery (${ordinal(next.seq)} of ${next.deliveries_planned}) is on ${effectiveDate(next)}${subscription.status === 'HOLD' ? ' (currently on hold)' : ''}.${paymentLine}${SIGNOFF}`
      };
    }

    case 'CANCEL_SUBSCRIPTION': {
      if (!subscription) return noSubscription(customer);
      db.prepare(`UPDATE subscriptions SET status = 'HOLD' WHERE id = ?`).run(subscription.id);
      appendRemark(db, customer.id, 'Asked to cancel subscription — on hold, needs call', today);
      return {
        reply: `We're sorry to hear that! We've paused your deliveries right away, and our team will call you shortly to sort everything out.${SIGNOFF}`,
        ownerAlert: `🛑 CANCELLATION REQUEST: ${label} — deliveries paused, please call them (${customer.phones.split('//')[0]}).`
      };
    }

    case 'NEW_ORDER': {
      appendRemark(db, customer.id, `Order request: ${instruction.text.slice(0, 120)}`, today);
      return {
        reply: `Lovely! 🌸 We've passed your order to the team — they'll confirm the details, price and delivery time with you shortly.`,
        ownerAlert: `🛒 NEW ORDER from ${label} (${customer.phones.split('//')[0]}):\n"${instruction.text.slice(0, 250)}"\nReply to them to confirm details.`
      };
    }

    case 'RENEW': {
      // Lazily imported to avoid a module cycle (renewal.ts uses appendRemark)
      const { createNextCycle } = require('./renewal') as typeof import('./renewal');
      const renewal = createNextCycle(db, customer.id, today);
      if (!renewal.ok) {
        appendRemark(db, customer.id, 'Asked to renew', today);
        return {
          reply: `Wonderful! We'll set up your next cycle and send you the payment details shortly.${SIGNOFF}`,
          ownerAlert: `🔁 RENEWAL: ${label} wants to renew but auto-creation said: ${renewal.message}`
        };
      }
      return {
        reply: `Wonderful! Your subscription is renewed — first delivery on ${renewal.firstDelivery}. ${subscription ? `Kindly pay ₹${subscription.pack_amount} on this number.` : ''}${SIGNOFF}`,
        ownerAlert: `🔁 RENEWED: ${label} — ${renewal.message}`
      };
    }
  }
}

function noSubscription(customer: CustomerRecord): ActionResult {
  return {
    reply: `We couldn't find an active subscription for this number. Our team will get back to you shortly! 🌸`,
    ownerAlert: `❓ ${customer.name} (#${customer.id}) messaged but has no live subscription.`
  };
}
