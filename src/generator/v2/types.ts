import type { SlotType } from '../../types';

/** public/data/v2/<hero>.json, written by scripts/fetch-v2.mjs. Every block carries the patch start it was fetched from. */
export interface SlimStat { item_id: number; wins: number; matches: number; avg_buy_time_s: number }
export interface V2Data {
  hero_id: number;
  patch: { name: string; min_unix_timestamp: number };
  standard: { min_unix_timestamp: number; min_average_badge: number; item_stats: SlimStat[] };
  brawl: { min_unix_timestamp: number; min_average_badge: number | null; item_stats: SlimStat[] };
  enemies: { hero_id: number; games: number; wins: number }[];
  standard_vs: { min_unix_timestamp: number; rows: Record<string, SlimStat[]> };
  brawl_vs: { min_unix_timestamp: number; rows: Record<string, SlimStat[]> };
  ability_order_stats: { min_unix_timestamp: number; rows: { abilities: number[]; wins: number; losses: number; matches: number }[] };
  timelines: { min_unix_timestamp: number; source: 'panel' | 'aggregate'; games: { match_id: number; account_id: number; duration_s: number; snaps: number[][] }[] };
  sell_stats: { min_unix_timestamp: number; players: number; matches: number; items: { item_id: number; buyers: number; sold: number; upgraded: number; avg_sold_time_s: number }[] };
  zergggy: { account_id: number; since: number; hero_games_total_since_patch: number; games: { match_id: number; start_time: number; won: boolean; items: { item_id: number; game_time_s: number; sold_time_s: number }[] }[] };
}
/** public/data/v2/modes.json: every hero's standard (Phantom+) and brawl rows, for the game-mode effect. */
export interface V2Modes { min_unix_timestamp: number; heroes: Record<string, { standard: SlimStat[]; brawl: SlimStat[] }> }

export type Category = 'clearSpeed' | 'souls' | 'laneSustain' | 'weaponDamage' | 'spiritDamage' | 'survivability' | 'mobility' | 'actives' | 'utility';
export interface ItemCategory { itemId: number; primary: Category; all: Category[]; deciding: string[]; source: 'stats' | 'data' }

export interface RoleBucket { startS: number; farm: number; fight: number; farmShare: number; intervals: number }
export interface RoleCurve { source: 'panel' | 'aggregate'; games: number; buckets: RoleBucket[]; farmEndS: number }

export interface ExplainRow {
  itemId: number; name: string; slot: SlotType; category: Category; categorySource: 'stats' | 'data';
  stdMatches: number; popRel: number; stdDelta: number; brawlMatches: number; brawlRel: number | null;
  heroModeLift: number | null; globalModeLift: number | null; brawlLift: number; brawlRaw: number; supportScale: number; roleScale: number; spiritRule: string | null; denied: string | null;
  buyTimeS: number; farmShareAtBuy: number; roleTerm: number; roleNote: string;
}
export interface Swap { itemId: number; name: string; replaces: string | null; source: 'standard' | 'brawl'; games: number; lift: number; reason: string }
export interface EnemyReport { heroId: number; name: string; games: number; swaps: Swap[] }
export interface ColourTotal { slot: SlotType; total: number; crossing: { itemId: number; name: string; threshold: number } | null }
export interface ZergggyReport { games: number; sinceTotal: number; shared: string[]; onlyHis: { name: string; reason: string }[]; onlyBuild: { name: string; reason: string }[] }
export interface V2Report {
  patch: { name: string; since: number };
  counts: { standard: number; brawl: number };
  curve: RoleCurve;
  rows: ExplainRow[];
  colours: ColourTotal[];
  spikeThresholds: number[];
  spikeSource: string;
  enemies: EnemyReport[];
  zergggy: ZergggyReport;
  notes: string[];
}
