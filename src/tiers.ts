import type { Hero, Item } from './types';

/** Phantom+ (average lobby badge >= 90) totals per hero over the snapshot window; written by `npm run fetch-data`. */
export interface HeroStats {
  fetched_at: string;
  min_average_badge: number;
  window_days: number;
  heroes: { hero_id: number; wins: number; matches: number }[];
}

/**
 * The rule (also written in docs/tier-list.md): win rate = wins / matches in Phantom+ games. A hero's tier is
 * the first row below whose `min` its win rate reaches (win rate in percent). Bands are 2 points wide around
 * the 50% every hero pool averages to, with S+ kept for the clear outliers.
 */
export const TIERS = [
  { key: 'S+', name: 'Top pick', min: 54 },
  { key: 'S', name: 'Strong', min: 52 },
  { key: 'A', name: 'Good', min: 50 },
  { key: 'B', name: 'Even', min: 48 },
  { key: 'C', name: 'Weak', min: 46 },
  { key: 'D', name: 'Struggling', min: -Infinity },
] as const;
export type TierKey = (typeof TIERS)[number]['key'];

export const winRate = (s: { wins: number; matches: number }) => (s.matches ? (100 * s.wins) / s.matches : 0);
export const tierOf = (rate: number) => TIERS.find((t) => rate >= t.min)!;

export interface TierRow {
  tier: (typeof TIERS)[number];
  heroes: { hero: Hero; rate: number }[];
}

/** Every hero exactly once, best tier first, best win rate first inside a tier. Heroes with no stats are left out. */
export function buildTierRows(heroes: Hero[], stats: HeroStats): TierRow[] {
  const byId = new Map(stats.heroes.map((s) => [s.hero_id, s]));
  const rows: TierRow[] = TIERS.map((tier) => ({ tier, heroes: [] }));
  for (const hero of heroes) {
    const s = byId.get(hero.id);
    if (!s) continue;
    const rate = winRate(s);
    rows.find((r) => r.tier === tierOf(rate))!.heroes.push({ hero, rate });
  }
  for (const r of rows) r.heroes.sort((a, b) => b.rate - a.rate || a.hero.name.localeCompare(b.hero.name));
  return rows;
}

/** Per-item totals over every hero; written by `npm run fetch-data`. `items` are normal copies (Phantom+, snapshot
 * window), `corrupted` are corrupted copies (all ranks, games of `corrupted_min_duration_s` or longer, since release). */
export interface ItemStats {
  fetched_at: string;
  min_average_badge: number;
  window_days: number;
  corrupted_since_unix_timestamp: number;
  corrupted_min_duration_s: number;
  items: { item_id: number; wins: number; matches: number }[];
  corrupted: { item_id: number; wins: number; matches: number }[];
}

/** Items with fewer games than this are left off the item tier lists: too few to rank. */
export const MIN_ITEM_MATCHES = 300;

export interface ItemTierRow {
  tier: (typeof TIERS)[number];
  items: { item: Item; rate: number; edge: number }[];
}

/**
 * Items rank against items of the same price, since dearer items are bought later, in games already being won.
 * edge = an item's win rate minus the pooled win rate of every listed item at its price (in points). The tier is
 * the hero rule applied to 50 + edge, so the bands are the same 2-point steps: S+ at +4 or more, D below -4.
 */
export function buildItemTierRows(items: Item[], stats: ItemStats['items']): ItemTierRow[] {
  const byId = new Map(items.filter((i) => i.shopable && !i.disabled && i.cost > 0).map((i) => [i.id, i]));
  const listed = stats.filter((s) => byId.has(s.item_id) && s.matches >= MIN_ITEM_MATCHES).map((s) => ({ s, item: byId.get(s.item_id)! }));
  const pool = new Map<number, { wins: number; matches: number }>();
  for (const { s, item } of listed) {
    const p = pool.get(item.cost) ?? { wins: 0, matches: 0 };
    pool.set(item.cost, { wins: p.wins + s.wins, matches: p.matches + s.matches });
  }
  const rows: ItemTierRow[] = TIERS.map((tier) => ({ tier, items: [] }));
  for (const { s, item } of listed) {
    const rate = winRate(s);
    const edge = rate - winRate(pool.get(item.cost)!);
    rows.find((r) => r.tier === tierOf(50 + edge))!.items.push({ item, rate, edge });
  }
  for (const r of rows) r.items.sort((a, b) => b.edge - a.edge || a.item.name.localeCompare(b.item.name));
  return rows;
}
