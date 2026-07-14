import { BusinessDb } from './db';
import { ChatTool } from '../llm/provider';
import { dueRows } from './delSheet';
import { buildProcurement, loadFlowers } from './assignment';
import { renewalsDue } from './paymentRun';
import { findCustomersByName } from './groupUpdates';
import { addDays } from './dates';

/**
 * Read-only query tools the cloud LLM may call to answer owner questions.
 * Every tool is SELECT-only by construction — the model has no path to
 * mutate orders, subscriptions, payments, or schedules.
 */

export interface QaToolContext {
  db: BusinessDb;
  today: string;
}

interface QaTool extends ChatTool {
  execute(context: QaToolContext, input: Record<string, unknown>): unknown;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asLimit(value: unknown, fallback: number, max: number): number {
  const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

function resolveDate(value: unknown, today: string): string {
  const raw = asString(value).trim().toLowerCase();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (raw === 'tomorrow') return addDays(today, 1);
  if (raw === 'yesterday') return addDays(today, -1);
  return today;
}

const TOOLS: QaTool[] = [
  {
    name: 'find_customer',
    description: 'Look up customers by (partial) name. Returns profile, subscription, next delivery, and any outstanding balance for each match.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Customer name or part of it' } },
      required: ['name']
    },
    execute({ db, today }, input) {
      const name = asString(input.name).trim();
      if (!name) return { error: 'name is required' };
      const matches = findCustomersByName(db, name).slice(0, 5);
      return matches.map(customer => {
        const subscription = db.prepare(`
          SELECT id, package_name, pack_amount, frequency, day, day2, time_slot, status
          FROM subscriptions WHERE customer_id = ? ORDER BY id DESC LIMIT 1
        `).get(customer.id) as Record<string, unknown> | undefined;
        const owed = db.prepare(`
          SELECT COALESCE(SUM(cy.collect), 0) AS owed FROM cycles cy
          JOIN subscriptions s ON cy.subscription_id = s.id
          WHERE s.customer_id = ? AND cy.payment_status = 'PENDING' AND cy.collect > 0
        `).get(customer.id) as { owed: number };
        const nextDelivery = db.prepare(`
          SELECT COALESCE(NULLIF(d.changed_date, ''), d.planned_date) AS date FROM deliveries d
          JOIN cycles cy ON d.cycle_id = cy.id JOIN subscriptions s ON cy.subscription_id = s.id
          WHERE s.customer_id = ? AND d.status = 'PLANNED' AND date >= ? ORDER BY date LIMIT 1
        `).get(customer.id, today) as { date: string } | undefined;
        return {
          id: customer.id,
          name: customer.name,
          address: customer.address,
          zone: customer.zone,
          subscription: subscription ?? null,
          amountOwed: owed.owed,
          nextDelivery: nextDelivery?.date ?? null,
          recentRemarks: (customer as { remarks?: string }).remarks?.slice(-300) ?? ''
        };
      });
    }
  },
  {
    name: 'get_deliveries',
    description: 'All deliveries due on a date (subscriptions plus one-off orders): customer, zone, time slot, package, revenue, and amount to collect.',
    parameters: {
      type: 'object',
      properties: { date: { type: 'string', description: 'YYYY-MM-DD, "today", or "tomorrow"' } },
      required: []
    },
    execute({ db, today }, input) {
      const date = resolveDate(input.date, today);
      const rows = dueRows(db, date);
      return {
        date,
        count: rows.length,
        totalRevenue: rows.reduce((sum, row) => sum + row.revenue, 0),
        totalToCollect: rows.reduce((sum, row) => sum + (row.collect === '' ? 0 : row.collect), 0),
        deliveries: rows.map(row => ({
          id: row.id,
          name: row.name,
          zone: row.zone,
          timeSlot: row.timeSlot,
          package: row.packageName,
          pack: row.pack,
          revenue: row.revenue,
          collect: row.collect === '' ? 0 : row.collect
        }))
      };
    }
  },
  {
    name: 'get_pending_collections',
    description: 'Customers with outstanding payments, sorted by amount owed (largest first), with the grand total.',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Max customers to list (default 10)' } },
      required: []
    },
    execute({ db }, input) {
      const limit = asLimit(input.limit, 10, 50);
      const rows = db.prepare(`
        SELECT c.id, c.name, c.zone, SUM(cy.collect) AS owed
        FROM cycles cy
        JOIN subscriptions s ON cy.subscription_id = s.id
        JOIN customers c ON s.customer_id = c.id
        WHERE cy.payment_status = 'PENDING' AND cy.collect > 0 AND s.status = 'ACTIVE'
        GROUP BY c.id ORDER BY owed DESC LIMIT ?
      `).all(limit) as Array<{ id: string; name: string; zone: string; owed: number }>;
      const total = (db.prepare(`
        SELECT COALESCE(SUM(cy.collect), 0) AS total FROM cycles cy
        JOIN subscriptions s ON cy.subscription_id = s.id
        WHERE cy.payment_status = 'PENDING' AND cy.collect > 0 AND s.status = 'ACTIVE'
      `).get() as { total: number }).total;
      return { totalPending: total, topDebtors: rows };
    }
  },
  {
    name: 'get_procurement',
    description: 'Flowers to buy for a date based on auto-assigned deliveries: sticks needed, bunches to buy, and estimated cost.',
    parameters: {
      type: 'object',
      properties: { date: { type: 'string', description: 'YYYY-MM-DD, "today", or "tomorrow" (default tomorrow)' } },
      required: []
    },
    execute({ db, today }, input) {
      const date = asString(input.date) ? resolveDate(input.date, today) : addDays(today, 1);
      const lines = buildProcurement(dueRows(db, date).map(row => row.assigned), loadFlowers(db));
      return {
        date,
        lines,
        estimatedTotal: lines.reduce((sum, line) => sum + line.estimatedCost, 0)
      };
    }
  },
  {
    name: 'get_renewals_due',
    description: 'Active subscriptions whose current cycle has finished with nothing renewed behind it — the renewal chase list.',
    parameters: { type: 'object', properties: {}, required: [] },
    execute({ db, today }) {
      return renewalsDue(db, today).map(renewal => ({
        customerId: renewal.customerId,
        name: renewal.name,
        package: renewal.packageName,
        packAmount: renewal.packAmount,
        lastDelivery: renewal.lastDelivery,
        daysSince: renewal.daysSince
      }));
    }
  },
  {
    name: 'get_review_queue',
    description: 'Group messages the parser could not apply safely and staged for human review, with the reason each needs attention.',
    parameters: { type: 'object', properties: {}, required: [] },
    execute({ db }) {
      const escalated = db.prepare(`
        SELECT l.id, m.message_text, l.action_taken, l.created_at
        FROM group_update_log l JOIN group_messages m ON m.id = l.message_id
        WHERE l.escalated = 1 AND l.resolved_at IS NULL
        ORDER BY l.id DESC LIMIT 30
      `).all() as Array<{ id: number; message_text: string; action_taken: string; created_at: string }>;
      const staged = (db.prepare(`
        SELECT COUNT(*) AS n FROM group_messages WHERE processed_at IS NULL
      `).get() as { n: number }).n;
      return { unresolvedReviewItems: escalated, unprocessedStagedMessages: staged };
    }
  },
  {
    name: 'get_business_overview',
    description: 'One-shot summary: delivery counts today and tomorrow by zone, pending collections total, renewals due, and staged group updates.',
    parameters: { type: 'object', properties: {}, required: [] },
    execute({ db, today }) {
      const summarize = (date: string) => {
        const rows = dueRows(db, date);
        const byZone: Record<string, number> = {};
        for (const row of rows) byZone[row.zone || '?'] = (byZone[row.zone || '?'] ?? 0) + 1;
        return {
          date,
          count: rows.length,
          revenue: rows.reduce((sum, row) => sum + row.revenue, 0),
          byZone
        };
      };
      const pendingTotal = (db.prepare(`
        SELECT COALESCE(SUM(cy.collect), 0) AS total FROM cycles cy
        JOIN subscriptions s ON cy.subscription_id = s.id
        WHERE cy.payment_status = 'PENDING' AND cy.collect > 0 AND s.status = 'ACTIVE'
      `).get() as { total: number }).total;
      const staged = (db.prepare(`
        SELECT COUNT(*) AS n FROM group_messages WHERE processed_at IS NULL
      `).get() as { n: number }).n;
      return {
        today: summarize(today),
        tomorrow: summarize(addDays(today, 1)),
        pendingCollectionsTotal: pendingTotal,
        renewalsDue: renewalsDue(db, today).length,
        stagedGroupUpdates: staged
      };
    }
  }
];

export function qaToolDefinitions(): ChatTool[] {
  return TOOLS.map(({ name, description, parameters }) => ({ name, description, parameters }));
}

/** Run one tool call; errors become structured messages, never throws. */
export function executeQaTool(context: QaToolContext, name: string, input: Record<string, unknown>): string {
  const tool = TOOLS.find(candidate => candidate.name === name);
  if (!tool) return JSON.stringify({ error: `Unknown tool "${name}"` });
  try {
    return JSON.stringify(tool.execute(context, input));
  } catch (error) {
    return JSON.stringify({ error: `Tool ${name} failed: ${(error as Error).message}` });
  }
}
