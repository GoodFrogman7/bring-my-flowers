import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, BusinessDb } from '../src/business/db';
import {
  assignFlowers,
  buildProcurement,
  matchFlowers,
  loadRecipes,
  loadFlowers,
  FlowerRow
} from '../src/business/assignment';
import { createNextCycle } from '../src/business/renewal';
import { writeDelSheetDetailed } from '../src/business/delSheet';
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let db: BusinessDb;

const FLOWERS: Array<[string, string, number, number, number]> = [
  // name, class, sticks/bunch, cost/bunch, wastage
  ['Rajni', 'SEASONAL', 22, 125, 0.1],       // ≈₹5.7/stem — cheapest seasonal
  ['Carnation', 'SEASONAL', 20, 260, 0.1],   // ₹13/stem
  ['Rose', 'SEASONAL', 20, 400, 0.1],        // ₹20/stem
  ['Gerbera', 'SEASONAL', 10, 0, 0.1],       // cost unknown — must never be picked
  ['Sunflower', 'PREMIUM', 5, 125, 0.1],     // ₹25/stem — cheapest premium
  ['Asiatic', 'PREMIUM', 10, 750, 0.1],      // ₹75/stem
  ['Spray Daisy', 'PREMIUM', 10, 600, 0.1],  // ₹60/stem
  ['Orchid', 'PREMIUM', 10, 450, 0.15]       // ₹45/stem
];

function seedReference() {
  for (const [name, cls, sticks, cost, wastage] of FLOWERS) {
    db.prepare(`INSERT INTO flowers (name, class, sticks_per_bunch, cost_per_bunch, wastage) VALUES (?, ?, ?, ?, ?)`)
      .run(name, cls, sticks, cost, wastage);
  }
  db.prepare(`INSERT INTO pack_recipes (package_name, seasonal_stems, premium_spec) VALUES ('bliss', 16, ?)`)
    .run(JSON.stringify({ mode: 'pick_one', groups: [
      { flowers: ['Asiatic', 'Sunflower'], stems: 3 },
      { flowers: ['Spray Daisy', 'Orchid'], stems: 5 }
    ] }));
}

function assign(context: { packageName?: string; restrictions?: string; preFlowers?: string[] }) {
  return assignFlowers(
    { packageName: context.packageName ?? 'Bliss', restrictions: context.restrictions ?? '', preFlowers: context.preFlowers ?? [] },
    loadRecipes(db),
    loadFlowers(db)
  );
}

beforeEach(() => {
  db = openDb(':memory:');
  seedReference();
});

describe('matchFlowers', () => {
  it('matches the owner’s abbreviations and decorated log strings', () => {
    expect(matchFlowers('Rajni ( 14 Inch ) 16     Grass')).toEqual(new Set(['Rajni']));
    expect(matchFlowers('O n P Car ( 14 Inch ) 11')).toEqual(new Set(['Carnation']));
    expect(matchFlowers('P n W Glad ( 14 Inch)')).toEqual(new Set(['Glad']));
    expect(matchFlowers('GULDAWARI n BOP')).toEqual(new Set(['Guldawari', 'BOP']));
    expect(matchFlowers('Sunflower ( 12 Incjh ) 3 P n W Glad 11')).toEqual(new Set(['Sunflower', 'Glad']));
  });

  it('lily-family restriction blocks both lily types', () => {
    expect(matchFlowers('No lilies please')).toEqual(new Set(['Lily', 'Asiatic', 'Oriental']));
  });
});

describe('assignFlowers', () => {
  it('defaults new customers (no history) to a seasonal week, cheapest per stem', () => {
    const result = assign({});
    expect(result.weekClass).toBe('SEASONAL');
    expect(result.items).toEqual([{ flower: 'Rajni', sticks: 16 }]);
  });

  it('alternates: premium last week → seasonal now, and vice versa', () => {
    expect(assign({ preFlowers: ['O Asiatic ( 14 inch ) 3'] }).weekClass).toBe('SEASONAL');
    const premium = assign({ preFlowers: ['Rajni ( 14 Inch ) 16'] });
    expect(premium.weekClass).toBe('PREMIUM');
    // Cheapest premium arrangement: Sunflower ×3 (₹75) beats Orchid ×5 (₹225)
    expect(premium.items).toEqual([{ flower: 'Sunflower', sticks: 3 }]);
  });

  it('never repeats the last 5 flowers', () => {
    const result = assign({ preFlowers: ['O Asiatic 3', 'Rajni 16', 'Sunflower 3', 'Carnation 16', 'Spray Daisy 5'] });
    // Last was Spray Daisy (premium) → seasonal week; Rajni + Carnation used → Rose
    expect(result.weekClass).toBe('SEASONAL');
    expect(result.items).toEqual([{ flower: 'Rose', sticks: 16 }]);
  });

  it('relaxes to last-2 when the full history blocks everything, but keeps restrictions absolute', () => {
    const result = assign({
      restrictions: 'ROSE',
      // All seasonals used across 5, but Rajni/Carnation only in the older 3
      preFlowers: ['Rajni 16', 'Carnation 16', 'Rose 16', 'Asiatic 3', 'Spray Daisy 5']
    });
    expect(result.weekClass).toBe('SEASONAL');
    // last-2 = Asiatic/Spray Daisy → Rajni allowed again; Rose stays banned
    expect(result.items).toEqual([{ flower: 'Rajni', sticks: 16 }]);
  });

  it('never assigns a flower with unknown cost', () => {
    const result = assign({ restrictions: 'Rajni n Carnation n Rose' });
    // Only Gerbera (cost 0) remains seasonal → manual, not Gerbera
    expect(result.items).toEqual([]);
    expect(result.manualReason).toContain('no seasonal candidate');
  });

  it('respects restrictions in premium groups', () => {
    const result = assign({
      restrictions: 'Sunflower n lilies',
      preFlowers: ['Rajni 16'] // → premium week
    });
    // Group 1 (Asiatic/Sunflower) fully blocked → group 2, Orchid cheaper than Spray Daisy
    expect(result.items).toEqual([{ flower: 'Orchid', sticks: 5 }]);
  });

  it('leaves unknown packs manual with the reason', () => {
    const result = assign({ packageName: 'Delight' });
    expect(result.items).toEqual([]);
    expect(result.manualReason).toContain('no recipe for "Delight"');
  });
});

describe('buildProcurement', () => {
  it('aggregates sticks, applies wastage, rounds up to bunches, prices it', () => {
    const flowers = loadFlowers(db);
    const lines = buildProcurement(
      [
        [{ flower: 'Rajni', sticks: 16 }],
        [{ flower: 'Rajni', sticks: 22 }],
        [{ flower: 'Sunflower', sticks: 3 }]
      ],
      flowers
    );
    const rajni = lines.find(line => line.flower === 'Rajni')!;
    // 38 sticks × 1.1 wastage = 41.8 → ceil(41.8/22) = 2 bunches → ₹250
    expect(rajni).toEqual({ flower: 'Rajni', sticksNeeded: 38, bunchesToBuy: 2, estimatedCost: 250 });
    const sunflower = lines.find(line => line.flower === 'Sunflower')!;
    // 3 × 1.1 = 3.3 → ceil(3.3/5) = 1 bunch → ₹125
    expect(sunflower.bunchesToBuy).toBe(1);
    expect(sunflower.estimatedCost).toBe(125);
  });
});

describe('createNextCycle', () => {
  function seedSubscriber(frequency: 'WEEKLY' | 'BIWEEKLY') {
    db.prepare(`INSERT INTO customers (id, name, phones) VALUES ('100', 'Renewer', '9876543210')`).run();
    db.prepare(`INSERT INTO subscriptions (id, customer_id, package_name, pack_amount, frequency, day, status)
                VALUES (1, '100', 'Bliss', 1450, ?, 'Monday', 'ACTIVE')`).run(frequency);
    db.prepare(`INSERT INTO cycles (id, subscription_id, renewal_date, deliveries_planned, pack_amount, payment_status)
                VALUES (1, 1, '2026-06-01', 4, 1450, 'COMPLETED')`).run();
    db.prepare(`INSERT INTO deliveries (cycle_id, seq, planned_date, status) VALUES (1, 4, '2026-06-29', 'DELIVERED')`).run();
  }

  it('creates 4 weekly deliveries on the fixed day, payment pending', () => {
    seedSubscriber('WEEKLY');
    const result = createNextCycle(db, '100', '2026-07-06'); // a Monday

    expect(result.ok).toBe(true);
    expect(result.firstDelivery).toBe('2026-07-13'); // next Monday, strictly after
    const deliveries = db.prepare(`
      SELECT planned_date FROM deliveries d JOIN cycles cy ON d.cycle_id = cy.id
      WHERE cy.renewal_date = '2026-07-06' ORDER BY seq`).all() as Array<{ planned_date: string }>;
    expect(deliveries.map(d => d.planned_date)).toEqual(['2026-07-13', '2026-07-20', '2026-07-27', '2026-08-03']);
    const cycle = db.prepare(`SELECT payment_status, collect FROM cycles WHERE renewal_date = '2026-07-06'`).get() as { payment_status: string; collect: number };
    expect(cycle).toEqual({ payment_status: 'PENDING', collect: 1450 });
  });

  it('creates 8 paired biweekly deliveries', () => {
    seedSubscriber('BIWEEKLY');
    const result = createNextCycle(db, '100', '2026-07-06');

    expect(result.ok).toBe(true);
    const deliveries = db.prepare(`
      SELECT planned_date FROM deliveries d JOIN cycles cy ON d.cycle_id = cy.id
      WHERE cy.renewal_date = '2026-07-06' ORDER BY seq`).all() as Array<{ planned_date: string }>;
    expect(deliveries).toHaveLength(8);
    expect(deliveries[0].planned_date).toBe('2026-07-13'); // Monday
    expect(deliveries[1].planned_date).toBe('2026-07-16'); // +3 days (Thursday)
    expect(deliveries[2].planned_date).toBe('2026-07-20'); // next Monday
  });

  it('refuses to stack cycles while deliveries remain planned', () => {
    seedSubscriber('WEEKLY');
    db.prepare(`INSERT INTO deliveries (cycle_id, seq, planned_date, status) VALUES (1, 3, '2026-07-20', 'PLANNED')`).run();

    const result = createNextCycle(db, '100', '2026-07-06');
    expect(result.ok).toBe(false);
    expect(result.message).toContain('still has 1 planned deliveries');
  });
});

describe('writeDelSheetDetailed', () => {
  it('fills Flower/Stick columns for recipe packs and reports manual rows', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bmf-assign-'));
    try {
      // One Bliss (auto) + one Delight (manual) due the same day
      for (const [id, pack, amount] of [['1', 'Bliss', 1450], ['2', 'Delight', 999]] as Array<[string, string, number]>) {
        db.prepare(`INSERT INTO customers (id, name, phones, zone) VALUES (?, ?, '98765432${id}0', 'Z')`).run(id, `Cust${id}`);
        db.prepare(`INSERT INTO subscriptions (customer_id, package_name, pack_amount, frequency, day, status)
                    VALUES (?, ?, ?, 'WEEKLY', 'Monday', 'ACTIVE')`).run(id, pack, amount);
        const subId = (db.prepare(`SELECT id FROM subscriptions WHERE customer_id = ?`).get(id) as { id: number }).id;
        db.prepare(`INSERT INTO cycles (subscription_id, renewal_date, deliveries_planned, pack_amount, payment_status)
                    VALUES (?, '2026-07-01', 4, ?, 'COMPLETED')`).run(subId, amount);
        const cycleId = (db.prepare(`SELECT id FROM cycles WHERE subscription_id = ?`).get(subId) as { id: number }).id;
        db.prepare(`INSERT INTO deliveries (cycle_id, seq, planned_date, status) VALUES (?, 1, '2026-07-06', 'PLANNED')`).run(cycleId);
      }

      const outPath = path.join(dir, 'del.xlsx');
      const result = writeDelSheetDetailed(db, '2026-07-06', outPath);

      expect(result.rows).toBe(2);
      expect(result.autoAssigned).toBe(1);
      expect(result.manual).toEqual([{ id: '2', name: 'Cust2', reason: 'no recipe for "Delight"' }]);

      const workbook = XLSX.readFile(outPath);
      const grid = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets['Sheet1'], { header: 1, defval: '' });
      const blissRow = grid.find(row => row[0] === '1')!;
      expect(blissRow[19]).toBe('Rajni'); // Flower 1
      expect(blissRow[20]).toBe(16);      // Stick
      const delightRow = grid.find(row => row[0] === '2')!;
      expect(delightRow[19]).toBe('');    // left manual

      const procurement = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets['Procurement'], { header: 1, defval: '' });
      expect(procurement[1]).toEqual(['Rajni', 16, 1, 125]);
      expect(procurement.some(row => String(row[0]).includes('#2'))).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
