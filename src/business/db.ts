import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

/**
 * The business datastore. Replaces the 10GB Master workbook as the source of
 * truth; the team's sheets (Master view, daily delivery sheet, feedback) are
 * GENERATED from here — the sheet remains the UI, the DB holds the facts.
 *
 * Model (see docs/BUSINESS.md):
 *   customers ─ subscriptions ─ cycles ─ deliveries
 *   one_time_orders (B-prefix bouquets) ─ deliveries
 *   restrictions (per customer), flowers + price history (procurement)
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,                -- stable numeric ID ('588'), or G-/CP- prefixed
  name TEXT NOT NULL DEFAULT '',
  phones TEXT NOT NULL DEFAULT '',    -- '//'-separated, digits only
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  zone TEXT NOT NULL DEFAULT '',
  remarks TEXT NOT NULL DEFAULT '',   -- date-stamped instruction history
  extra_instruction TEXT NOT NULL DEFAULT ''  -- applies to the next delivery
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  package_name TEXT NOT NULL DEFAULT '',      -- Delight, Bliss, Joy, Corporate…
  pack_amount REAL NOT NULL DEFAULT 0,
  frequency TEXT NOT NULL DEFAULT 'WEEKLY' CHECK (frequency IN ('WEEKLY','BIWEEKLY')),
  day TEXT NOT NULL DEFAULT '',               -- fixed weekday
  day2 TEXT NOT NULL DEFAULT '',              -- second weekday (biweekly)
  time_slot TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','HOLD','CLOSED')),
  is_corporate INTEGER NOT NULL DEFAULT 0,
  is_gift INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_customer ON subscriptions(customer_id);

CREATE TABLE IF NOT EXISTS restrictions (
  customer_id TEXT NOT NULL REFERENCES customers(id),
  flower TEXT NOT NULL,
  PRIMARY KEY (customer_id, flower)
);

-- One row per paid (or owed) block of deliveries. A Master row = a cycle.
CREATE TABLE IF NOT EXISTS cycles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id INTEGER NOT NULL REFERENCES subscriptions(id),
  renewal_date TEXT NOT NULL DEFAULT '',      -- YYYY-MM-DD
  deliveries_planned INTEGER NOT NULL DEFAULT 4,
  pack_amount REAL NOT NULL DEFAULT 0,
  per_delivery_revenue REAL NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (payment_status IN ('COMPLETED','PENDING','IN_PROCESS','COMPLIMENTARY','CANCELLED')),
  payment_mode TEXT NOT NULL DEFAULT '',
  payment_date TEXT NOT NULL DEFAULT '',
  amount_received REAL,
  collect REAL NOT NULL DEFAULT 0,            -- ₹ still to collect
  remarks TEXT NOT NULL DEFAULT '',
  source_row INTEGER                          -- Master row number, for traceability
);
CREATE INDEX IF NOT EXISTS idx_cycles_subscription ON cycles(subscription_id);

CREATE TABLE IF NOT EXISTS deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cycle_id INTEGER REFERENCES cycles(id),
  one_time_order_id TEXT REFERENCES one_time_orders(id),
  seq INTEGER NOT NULL DEFAULT 1,             -- 1..4 weekly, 1..8 biweekly
  planned_date TEXT NOT NULL DEFAULT '',
  changed_date TEXT NOT NULL DEFAULT '',      -- reschedule override (weekly)
  status TEXT NOT NULL DEFAULT 'PLANNED'
    CHECK (status IN ('PLANNED','DELIVERED','HELD','SKIPPED','RETURNED')),
  flowers TEXT NOT NULL DEFAULT '',           -- what actually went: "8 Rajni, 1 Asiatic"
  consumables TEXT NOT NULL DEFAULT '',
  delivered_by TEXT NOT NULL DEFAULT '',
  feedback TEXT NOT NULL DEFAULT '',
  cash_collected REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_deliveries_cycle ON deliveries(cycle_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_planned ON deliveries(planned_date);
CREATE INDEX IF NOT EXISTS idx_deliveries_changed ON deliveries(changed_date);

-- B-prefix bouquets and other one-off sales (a new ID per purchase, by design)
CREATE TABLE IF NOT EXISTS one_time_orders (
  id TEXT PRIMARY KEY,
  customer_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  zone TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL DEFAULT '',
  time_slot TEXT NOT NULL DEFAULT '',
  amount REAL NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  payment_status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (payment_status IN ('COMPLETED','PENDING','IN_PROCESS','COMPLIMENTARY','CANCELLED')),
  remarks TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_one_time_date ON one_time_orders(date);

-- What actually went out, imported from the daily Feedback sheets. This is
-- the history behind the "never repeat the customer's last 5 flowers" rule.
CREATE TABLE IF NOT EXISTS delivery_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id TEXT NOT NULL,          -- subscriber ID or B-prefix bouquet ID
  date TEXT NOT NULL,
  flowers TEXT NOT NULL DEFAULT '',   -- "8 Rajni, 1 Asiatic"
  consumables TEXT NOT NULL DEFAULT '',
  delivered_by TEXT NOT NULL DEFAULT '',
  feedback TEXT NOT NULL DEFAULT '',
  cash_collected REAL NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT ''     -- workbook/tab it came from
);
CREATE INDEX IF NOT EXISTS idx_delivery_log_customer ON delivery_log(customer_id, date);
CREATE UNIQUE INDEX IF NOT EXISTS uq_delivery_log ON delivery_log(customer_id, date, source);

CREATE TABLE IF NOT EXISTS flowers (
  name TEXT PRIMARY KEY,
  sticks_per_bunch INTEGER NOT NULL DEFAULT 10,
  cost_per_bunch REAL NOT NULL DEFAULT 0,
  wastage REAL NOT NULL DEFAULT 0.1,
  class TEXT NOT NULL DEFAULT 'SEASONAL'  -- SEASONAL | PREMIUM (pack card)
);

CREATE TABLE IF NOT EXISTS flower_price_history (
  flower TEXT NOT NULL,
  date TEXT NOT NULL,
  cost_per_bunch REAL NOT NULL,
  PRIMARY KEY (flower, date)
);
`;

/** Additive migrations for databases created before a column existed. */
const MIGRATIONS = [
  // SEASONAL | PREMIUM — from the official pack card (docs/assets/pack-card.jpeg)
  `ALTER TABLE flowers ADD COLUMN class TEXT NOT NULL DEFAULT 'SEASONAL'`
];

export function openDb(filePath: string): Database.Database {
  if (filePath !== ':memory:') {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }
  const db = new Database(filePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  for (const migration of MIGRATIONS) {
    try {
      db.exec(migration);
    } catch {
      // column already exists
    }
  }
  return db;
}

export type BusinessDb = Database.Database;
