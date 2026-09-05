/**
 * Seed the flowers reference table.
 *
 *   npx ts-node scripts/seed-flowers.ts [db-path]
 *
 * Sources:
 *  - sticks/bunch, current cost/bunch, wastage: the procurement tab (Sheet2)
 *    of the owner's 06-July delivery sheet
 *  - SEASONAL/PREMIUM class: the official pack card (docs/assets/pack-card.jpeg)
 *
 * Costs move with the market ("you can't predict — demand and supply", the
 * owner). These are point-in-time values; the multi-year price-history sheet
 * (still awaited) will feed flower_price_history for real procurement math.
 */
import { openDb } from '../src/business/db';

interface FlowerSeed {
  name: string;
  class: 'SEASONAL' | 'PREMIUM';
  sticksPerBunch: number;
  costPerBunch: number;
  wastage: number;
}

const FLOWERS: FlowerSeed[] = [
  // From del-sheet Sheet2 (06 July 2026)
  { name: 'Rajni', class: 'SEASONAL', sticksPerBunch: 22, costPerBunch: 125, wastage: 0.1 },
  { name: 'Rose', class: 'SEASONAL', sticksPerBunch: 20, costPerBunch: 400, wastage: 0.1 },
  { name: 'Carnation', class: 'SEASONAL', sticksPerBunch: 20, costPerBunch: 260, wastage: 0.1 },
  { name: 'Glad', class: 'SEASONAL', sticksPerBunch: 20, costPerBunch: 325, wastage: 0.1 },
  { name: 'Alstroemeria', class: 'SEASONAL', sticksPerBunch: 10, costPerBunch: 160, wastage: 0.1 },
  { name: 'B Daisy', class: 'SEASONAL', sticksPerBunch: 10, costPerBunch: 190, wastage: 0.15 },
  { name: 'Spray Daisy', class: 'PREMIUM', sticksPerBunch: 10, costPerBunch: 600, wastage: 0.1 },
  { name: 'Sunflower', class: 'PREMIUM', sticksPerBunch: 5, costPerBunch: 125, wastage: 0.1 },
  { name: 'Orchid', class: 'PREMIUM', sticksPerBunch: 10, costPerBunch: 450, wastage: 0.15 },
  { name: 'Asiatic', class: 'PREMIUM', sticksPerBunch: 10, costPerBunch: 750, wastage: 0.1 },
  { name: 'Oriental', class: 'PREMIUM', sticksPerBunch: 10, costPerBunch: 1500, wastage: 0.05 },
  { name: 'BOP', class: 'PREMIUM', sticksPerBunch: 1, costPerBunch: 100, wastage: 0.1 },
  { name: 'Eustoma', class: 'PREMIUM', sticksPerBunch: 10, costPerBunch: 725, wastage: 0.1 },
  // On the pack card but not in that day's procurement — cost unknown (0);
  // the assignment engine must skip zero-cost flowers until priced.
  { name: 'Guldawari', class: 'SEASONAL', sticksPerBunch: 10, costPerBunch: 0, wastage: 0.1 },
  { name: 'Gerbera', class: 'SEASONAL', sticksPerBunch: 10, costPerBunch: 0, wastage: 0.1 },
  { name: 'Anthurium', class: 'PREMIUM', sticksPerBunch: 10, costPerBunch: 0, wastage: 0.1 },
  { name: 'Heliconia', class: 'PREMIUM', sticksPerBunch: 10, costPerBunch: 0, wastage: 0.1 }
];

/**
 * Pack recipes from the card. premium_spec mode 'pick_one' = the card's "OR"
 * lines; 'combine' = Enchantment's single mixed premium arrangement. Packs
 * not on the card (Delight, Bloom, Felicity, Charm…) stay manual until the
 * owner supplies their counts — add them here when he does.
 */
const RECIPES: Array<{ name: string; seasonalStems: number; premium: object }> = [
  {
    name: 'bliss', seasonalStems: 16,
    premium: { mode: 'pick_one', groups: [
      { flowers: ['Asiatic', 'Sunflower'], stems: 3 },
      { flowers: ['Spray Daisy', 'Orchid'], stems: 5 }
    ] }
  },
  {
    name: 'joy', seasonalStems: 22,
    premium: { mode: 'pick_one', groups: [
      { flowers: ['Asiatic', 'Sunflower', 'Eustoma', 'BOP'], stems: 4 },
      { flowers: ['Spray Daisy', 'Orchid'], stems: 7 }
    ] }
  },
  {
    name: 'elation', seasonalStems: 32,
    premium: { mode: 'pick_one', groups: [
      { flowers: ['Asiatic', 'Sunflower', 'Eustoma', 'BOP'], stems: 6 },
      { flowers: ['Spray Daisy', 'Orchid'], stems: 10 }
    ] }
  },
  {
    name: 'enchantment', seasonalStems: 60,
    premium: { mode: 'combine', groups: [
      { flowers: ['Asiatic', 'Sunflower', 'Eustoma', 'BOP'], stems: 11 },
      { flowers: ['Anthurium', 'Heliconia'], stems: 6 },
      { flowers: ['Oriental'], stems: 5 }
      // 4th card line (Spray Daisy/Orchid ×18) omitted: the sheet has three
      // Flower columns; Enchantment rows keep a manual touch until Phase D
    ] }
  }
];

const [dbPath = './data/business.db'] = process.argv.slice(2);
const db = openDb(dbPath);

const insert = db.prepare(`
  INSERT OR REPLACE INTO flowers (name, sticks_per_bunch, cost_per_bunch, wastage, class)
  VALUES (?, ?, ?, ?, ?)`);
for (const flower of FLOWERS) {
  insert.run(flower.name, flower.sticksPerBunch, flower.costPerBunch, flower.wastage, flower.class);
}

const insertRecipe = db.prepare(`
  INSERT OR REPLACE INTO pack_recipes (package_name, seasonal_stems, premium_spec) VALUES (?, ?, ?)`);
for (const recipe of RECIPES) {
  insertRecipe.run(recipe.name, recipe.seasonalStems, JSON.stringify(recipe.premium));
}
console.log(`Seeded ${RECIPES.length} pack recipes: ${RECIPES.map(r => r.name).join(', ')}`);

const rows = db.prepare(`SELECT name, class, cost_per_bunch FROM flowers ORDER BY class, name`).all() as
  Array<{ name: string; class: string; cost_per_bunch: number }>;
console.log(`Seeded ${rows.length} flowers:`);
for (const row of rows) {
  console.log(`  ${row.class.padEnd(8)} ${row.name}${row.cost_per_bunch === 0 ? '  (cost unknown)' : ` — ₹${row.cost_per_bunch}/bunch`}`);
}
