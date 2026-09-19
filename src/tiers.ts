import type { Hero } from './types';

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
