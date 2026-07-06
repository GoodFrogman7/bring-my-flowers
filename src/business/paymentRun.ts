import { BusinessDb } from './db';
import { addDays, ordinal, todayIST } from './dates';
import { PaymentStatus } from './parse';

/**
 * The daily payment-message run — the job Pooja does by hand from the sheet.
 * For every delivery that went out on `date`, produce the owner's two fixed
 * templates (near-verbatim from the call):
 *   received:     "…we have received the payment."
 *   not received: "…we have not received the payment. Kindly pay ₹X…"
 * When the delivery completed the cycle, a renewal line is appended — the
 * revenue moment the owner currently chases from memory.
 */

export interface PaymentMessage {
  customerId: string;
  name: string;
  phone: string;
  kind: 'RECEIVED' | 'PAYMENT_DUE' | 'CYCLE_COMPLETE';
  message: string;
}

interface DueDelivery {
  customer_id: string;
  name: string;
  phones: string;
  seq: number;
  deliveries_planned: number;
  payment_status: PaymentStatus;
  collect: number;
  pack_amount: number;
  package_name: string;
}

export function buildPaymentMessages(db: BusinessDb, date: string): PaymentMessage[] {
  const rows = db.prepare(`
    SELECT c.id AS customer_id, c.name, c.phones,
           d.seq, cy.deliveries_planned, cy.payment_status, cy.collect,
           cy.pack_amount, s.package_name
    FROM deliveries d
    JOIN cycles cy ON d.cycle_id = cy.id
    JOIN subscriptions s ON cy.subscription_id = s.id
    JOIN customers c ON s.customer_id = c.id
    WHERE s.status != 'CLOSED'
      AND d.status IN ('PLANNED', 'DELIVERED')
      AND COALESCE(NULLIF(d.changed_date, ''), d.planned_date) = ?
    ORDER BY c.zone, c.name
  `).all(date) as DueDelivery[];

  const messages: PaymentMessage[] = [];

  for (const row of rows) {
    // Complimentary / in-process (corporates, gifts) are never chased
    if (row.payment_status === 'COMPLIMENTARY' || row.payment_status === 'IN_PROCESS' || row.payment_status === 'CANCELLED') {
      continue;
    }

    const isLast = row.seq >= row.deliveries_planned;
    const delivery = `${ordinal(row.seq)} of your ${row.deliveries_planned} deliveries`;

    let message: string;
    let kind: PaymentMessage['kind'];
    if (row.payment_status === 'COMPLETED') {
      message = `Dear ${row.name}, yesterday we had sent the ${delivery} and we have received the payment. Thank you! 🌸`;
      kind = 'RECEIVED';
    } else {
      const amount = row.collect > 0 ? row.collect : row.pack_amount;
      message = `Dear ${row.name}, yesterday we had sent the ${delivery} and we have not received the payment. Kindly pay ₹${amount} on this number. 🙏`;
      kind = 'PAYMENT_DUE';
    }

    if (isLast) {
      message += ` This completes your current ${row.package_name} cycle — shall we continue with your next cycle? Just reply "renew". 🌸`;
      kind = 'CYCLE_COMPLETE';
    }

    messages.push({
      customerId: row.customer_id,
      name: row.name,
      phone: row.phones.split('//')[0] ?? '',
      kind,
      message
    });
  }

  return messages;
}

export interface RenewalDue {
  customerId: string;
  name: string;
  phone: string;
  packageName: string;
  packAmount: number;
  lastDelivery: string;
  daysSince: number;
}

/**
 * Active subscriptions whose latest cycle is fully delivered with no newer
 * cycle behind it — the renewal chase list. Sorted most-recently-finished
 * first (freshest are most likely to renew).
 */
export function renewalsDue(db: BusinessDb, asOf: string = todayIST(), withinDays: number = 21): RenewalDue[] {
  const rows = db.prepare(`
    SELECT c.id AS customer_id, c.name, c.phones, s.package_name, s.pack_amount,
           MAX(COALESCE(NULLIF(d.changed_date, ''), d.planned_date)) AS last_delivery
    FROM subscriptions s
    JOIN customers c ON s.customer_id = c.id
    JOIN cycles cy ON cy.subscription_id = s.id
    JOIN deliveries d ON d.cycle_id = cy.id
    WHERE s.status = 'ACTIVE'
    GROUP BY s.id
    HAVING last_delivery < ? AND last_delivery >= ?
    ORDER BY last_delivery DESC
  `).all(asOf, addDays(asOf, -withinDays)) as Array<{
    customer_id: string; name: string; phones: string; package_name: string;
    pack_amount: number; last_delivery: string;
  }>;

  return rows.map(row => ({
    customerId: row.customer_id,
    name: row.name,
    phone: row.phones.split('//')[0] ?? '',
    packageName: row.package_name,
    packAmount: row.pack_amount,
    lastDelivery: row.last_delivery,
    daysSince: Math.round((new Date(`${asOf}T00:00:00Z`).getTime() - new Date(`${row.last_delivery}T00:00:00Z`).getTime()) / 86400000)
  }));
}
