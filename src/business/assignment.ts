import { BusinessDb } from './db';
import logger from '../utils/logger';

/**
 * The flower-assignment engine — the decision the owner makes by hand for
 * every delivery-sheet row each morning. Rules, in priority order:
 *
 *   1. Restrictions are absolute (allergies) — never violated.
 *   2. Deliveries ALTERNATE seasonal ↔ premium weeks (the pack card's rule);
 *      the week's class is read from the customer's last logged delivery.
 *   3. Never repeat a flower from the customer's last 5 deliveries
 *      (relaxed to last-2 if it would leave no candidate; restrictions never relax).
 *   4. Among valid candidates, pick the CHEAPEST per stem (the owner's
 *      economics: gerbera sells at rose value but costs less).
 *
 * Packs without a recipe (Corporate, Customized, Delight/Bloom/… until the
 * owner supplies their counts) are left for manual assignment, exactly like
 * today — and reported, never silently guessed.
 */

export interface FlowerRow {
  name: string;
  class: 'SEASONAL' | 'PREMIUM';
  sticks_per_bunch: number;
  cost_per_bunch: number;
  wastage: number;
}

export interface AssignedItem {
  flower: string;
  sticks: number;
}

export interface Assignment {
  items: AssignedItem[];
  weekClass: 'SEASONAL' | 'PREMIUM';
  /** Present when the row was left manual, with the reason. */
  manualReason?: string;
}

interface PremiumGroup {
  flowers: string[];
  stems: number;
}

interface PremiumSpec {
  mode: 'pick_one' | 'combine';
  groups: PremiumGroup[];
}

interface PackRecipe {
  packageName: string;
  seasonalStems: number;
  premium: PremiumSpec;
}

/**
 * Canonical-name matching across the messy spellings in logs and
 * restrictions: "Car" ↔ Carnation, "Glad" ↔ Gladioli, "Rajni ( 14 Inch )" ↔
 * Rajni, "GULDAWARI" ↔ Guldawari, "Sunflowers" ↔ Sunflower.
 */
const ALIASES: Record<string, string[]> = {
  'Rajni': ['rajni', 'rajnigandha', 'tuberose'],
  'Rose': ['rose', 'roses'],
  'Carnation': ['carnation', 'car '],
  'Glad': ['glad', 'gladioli', 'gladiolus'],
  'Guldawari': ['guldawari', 'guldavari', 'chrysanthemum'],
  'Gerbera': ['gerbera', 'jerbera'],
  'Alstroemeria': ['alstroemeria', 'alstro'],
  'B Daisy': ['b daisy', 'button daisy', 'b.daisy'],
  'Spray Daisy': ['spray daisy', 'spray daisies'],
  'Sunflower': ['sunflower', 'sunflowers'],
  'Orchid': ['orchid', 'orchids'],
  'Asiatic': ['asiatic'],
  'Oriental': ['oriental'],
  'BOP': ['bop', 'bird of paradise'],
  'Eustoma': ['eustoma'],
  'Anthurium': ['anthurium'],
  'Heliconia': ['heliconia'],
  'Lily': ['lily', 'lilies', 'lili']
};

/** Which canonical flowers does this free-text mention? */
export function matchFlowers(text: string): Set<string> {
  const lower = ` ${text.toLowerCase()} `;
  const matched = new Set<string>();
  for (const [canonical, aliases] of Object.entries(ALIASES)) {
    if (aliases.some(alias => lower.includes(alias))) {
      matched.add(canonical);
      // "lily"-family restriction blocks both lily types
      if (canonical === 'Lily') {
        matched.add('Asiatic');
        matched.add('Oriental');
      }
    }
  }
  return matched;
}

export function loadRecipes(db: BusinessDb): Map<string, PackRecipe> {
  const rows = db.prepare(`SELECT package_name, seasonal_stems, premium_spec FROM pack_recipes`).all() as
    Array<{ package_name: string; seasonal_stems: number; premium_spec: string }>;
  const recipes = new Map<string, PackRecipe>();
  for (const row of rows) {
    try {
      recipes.set(row.package_name, {
        packageName: row.package_name,
        seasonalStems: row.seasonal_stems,
        premium: JSON.parse(row.premium_spec) as PremiumSpec
      });
    } catch (error) {
      logger.warn({ error, package: row.package_name }, 'Bad premium_spec JSON; recipe skipped');
    }
  }
  return recipes;
}

export function loadFlowers(db: BusinessDb): FlowerRow[] {
  return db.prepare(`SELECT name, class, sticks_per_bunch, cost_per_bunch, wastage FROM flowers`).all() as FlowerRow[];
}

function costPerStem(flower: FlowerRow): number {
  return flower.sticks_per_bunch > 0 ? flower.cost_per_bunch / flower.sticks_per_bunch : Infinity;
}

export interface AssignmentContext {
  packageName: string;
  restrictions: string;       // free text, "GULDAWARI n BOP"
  /** Last-5 flowers strings, oldest → newest (DelSheetRow.preFlowers). */
  preFlowers: string[];
}

export function assignFlowers(
  context: AssignmentContext,
  recipes: Map<string, PackRecipe>,
  flowers: FlowerRow[]
): Assignment {
  const recipe = recipes.get(context.packageName.trim().toLowerCase());
  if (!recipe) {
    return { items: [], weekClass: 'SEASONAL', manualReason: `no recipe for "${context.packageName.trim() || '?'}"` };
  }

  const restricted = matchFlowers(context.restrictions);
  const recentAll = context.preFlowers.map(matchFlowers);
  const lastDelivery = recentAll[recentAll.length - 1] ?? new Set<string>();

  // Alternation: if the last delivery contained any premium flower → seasonal
  // week now; otherwise premium… unless there's no history (default seasonal).
  const byName = new Map(flowers.map(flower => [flower.name, flower]));
  const lastWasPremium = [...lastDelivery].some(name => byName.get(name)?.class === 'PREMIUM');
  const weekClass: 'SEASONAL' | 'PREMIUM' =
    recentAll.length === 0 ? 'SEASONAL' : lastWasPremium ? 'SEASONAL' : 'PREMIUM';

  const recentUnion = new Set(recentAll.flatMap(set => [...set]));
  const recentLast2 = new Set(recentAll.slice(-2).flatMap(set => [...set]));

  const usable = (flower: FlowerRow, avoid: Set<string>) =>
    flower.cost_per_bunch > 0 && !restricted.has(flower.name) && !avoid.has(flower.name);

  const pickCheapest = (candidates: FlowerRow[]): FlowerRow | null => {
    // Prefer avoiding all of the last 5; relax to last 2 before giving up.
    for (const avoid of [recentUnion, recentLast2]) {
      const valid = candidates.filter(flower => usable(flower, avoid));
      if (valid.length > 0) {
        return valid.sort((a, b) => costPerStem(a) - costPerStem(b))[0];
      }
    }
    return null;
  };

  if (weekClass === 'SEASONAL') {
    const choice = pickCheapest(flowers.filter(flower => flower.class === 'SEASONAL'));
    if (!choice) return { items: [], weekClass, manualReason: 'no seasonal candidate clears restrictions/history' };
    return { items: [{ flower: choice.name, sticks: recipe.seasonalStems }], weekClass };
  }

  // PREMIUM week
  const groupChoices: Array<{ item: AssignedItem; stemCost: number }> = [];
  for (const group of recipe.premium.groups) {
    const candidates = flowers.filter(flower => flower.class === 'PREMIUM' && group.flowers.includes(flower.name));
    const choice = pickCheapest(candidates);
    if (choice) {
      groupChoices.push({
        item: { flower: choice.name, sticks: group.stems },
        stemCost: costPerStem(choice) * group.stems
      });
    } else if (recipe.premium.mode === 'combine') {
      return { items: [], weekClass, manualReason: `premium group [${group.flowers.join('/')}] has no valid candidate` };
    }
  }

  if (groupChoices.length === 0) {
    return { items: [], weekClass, manualReason: 'no premium candidate clears restrictions/history' };
  }

  if (recipe.premium.mode === 'pick_one') {
    // The card's "OR": one group only — take the cheapest arrangement
    const cheapest = groupChoices.sort((a, b) => a.stemCost - b.stemCost)[0];
    return { items: [cheapest.item], weekClass };
  }

  // combine: every group, but the sheet only has three Flower columns
  if (groupChoices.length > 3) {
    return { items: [], weekClass, manualReason: 'premium combo needs more than 3 flower lines' };
  }
  return { items: groupChoices.map(choice => choice.item), weekClass };
}

// ---- Procurement (the owner's Sheet2 "TO BUY" math) ---------------------------

export interface ProcurementLine {
  flower: string;
  sticksNeeded: number;
  /** Sticks inflated by the wastage factor, rounded up to whole bunches. */
  bunchesToBuy: number;
  estimatedCost: number;
}

export function buildProcurement(assignments: AssignedItem[][], flowers: FlowerRow[]): ProcurementLine[] {
  const byName = new Map(flowers.map(flower => [flower.name, flower]));
  const sticksByFlower = new Map<string, number>();
  for (const items of assignments) {
    for (const item of items) {
      sticksByFlower.set(item.flower, (sticksByFlower.get(item.flower) ?? 0) + item.sticks);
    }
  }
  return [...sticksByFlower.entries()]
    .map(([name, sticks]) => {
      const flower = byName.get(name);
      const perBunch = flower?.sticks_per_bunch || 10;
      const bunches = Math.ceil((sticks * (1 + (flower?.wastage ?? 0.1))) / perBunch);
      return {
        flower: name,
        sticksNeeded: sticks,
        bunchesToBuy: bunches,
        estimatedCost: Math.round(bunches * (flower?.cost_per_bunch ?? 0))
      };
    })
    .sort((a, b) => b.estimatedCost - a.estimatedCost);
}
