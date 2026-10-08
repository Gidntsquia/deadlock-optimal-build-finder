export type SlotType = 'weapon' | 'vitality' | 'spirit';

export interface ItemProperty {
  value: string | number;
  label?: string;
  postfix?: string;
  prefix?: string;
  css_class?: string;
}

export interface Item {
  id: number;
  class_name: string;
  name: string;
  cost: number;
  item_tier: number;
  item_slot_type: SlotType;
  shopable: boolean;
  disabled: boolean;
  is_active_item: boolean;
  activation?: string;
  component_items: string[];
  shop_image_webp?: string;
  image_webp?: string;
  description: { desc?: string; active?: string; passive?: string; [k: string]: string | undefined };
  tooltip_sections: TooltipSection[];
  properties: Record<string, ItemProperty>;
}
export interface TooltipSection {
  section_type?: string;
  section_attributes?: { properties?: string[]; elevated_properties?: string[]; important_properties?: string[]; loc_string?: string }[];
}

export interface Hero {
  id: number;
  name: string;
  class_name: string;
  description?: { role?: string; playstyle?: string; lore?: string };
  images: { small?: string; card?: string };
  starting_stats: Record<string, number>;
  standard_level_up_upgrades: Record<string, number>;
  level_info: Record<string, { required_gold?: number; bonus_currencies?: string[] }>;
  abilities: string[]; // class names of signature1..4
  gun_tag?: string;
  tags?: string[];
}

export interface AbilityProperty {
  value: string | number;
  scale: string | string[] | null;
  stat_scale?: number; // spirit power multiplier when scale is ETechPower
  label?: string;
  prefix?: string;
  postfix?: string;
  css_class?: string;
  icon?: string; // app-relative, img/props/
  disable_value?: string;
}
/** The game's tooltip layout for an ability: text sections, each with blocks of headline stats and a list of minor stats. */
export interface AbilityTooltip {
  header?: string[];
  sections: {
    text?: string;
    requires?: string; // shown only once an upgrade that changes this property is bought
    blocks: { title?: string; props: { key: string; status?: string; status_value?: string; show_value?: boolean; icon?: string }[] }[];
    basic?: string[];
  }[];
}

export interface Ability {
  id: number;
  class_name: string;
  name: string;
  hero: number;
  image_webp?: string;
  ability_type?: string;
  description: string;
  quip?: string;
  tier_desc?: string[]; // upgrade text for tiers 1..3, '' where the game has none
  active?: string;
  passive?: string;
  upgrades: { name: string; bonus: string; type?: string }[][];
  properties: Record<string, AbilityProperty>;
  tooltip?: AbilityTooltip; // signature abilities only
}

export interface ItemStat {
  item_id: number;
  wins: number;
  losses: number;
  matches: number;
  players: number;
  avg_buy_time_s: number;
  avg_sell_time_s: number;
  avg_buy_time_relative: number;
  avg_sell_time_relative: number;
}
export interface AbilityOrderStat {
  abilities: number[];
  wins: number;
  losses: number;
  matches: number;
  players: number;
}
export interface PairStat {
  item_ids: number[];
  wins: number;
  losses: number;
  matches: number;
}
/** How often top players sell an item to make room, from a sample of recent high-rank games (fetchSellStats). */
export interface SellStat {
  item_id: number;
  buyers: number;
  sold: number; // sold without being upgraded
  upgraded: number; // turned into an upgrade (the game records this as a sale too)
  avg_sold_time_s: number; // over the `sold` games only
}
export interface AnalyticsPopulation {
  item_stats: ItemStat[];
  ability_order_stats: AbilityOrderStat[];
  permutation_stats: PairStat[];
}
/** Aggregate analytics for one hero: all ranks, plus (optionally) the high-rank population. */
export interface HeroAnalytics extends AnalyticsPopulation {
  hero_id: number;
  /** start of this hero's data window (unix s); set when it was refetched from a patch on (fetch-data --since) */
  min_unix_timestamp?: number;
  /** all-rank charge-item ability sequences, used when high-rank sequences are too thin */
  item_ability_order_stats?: ItemAbilityOrderStats;
  top?: AnalyticsPopulation & {
    min_average_badge: number;
    styles?: StylePopulation[];
    item_ability_order_stats?: ItemAbilityOrderStats;
    sell_stats?: { players: number; matches: number; items: SellStat[] };
  };
  /** v2 heroes only (src/generator/pipeline.ts): post-patch standard + Street Brawl data, loaded beside the analytics */
  v2?: { data: V2Data; modes: V2Modes };
  corrupted?: { since_unix_timestamp: number; min_duration_s: number; items: CorruptedStat[] };
  /** which ability the hero's most favorited published builds put each imbue item on (fetchImbueTargets) */
  imbue_targets?: { builds: number; items: { item_id: number; targets: { ability_id: number; builds: number }[] }[] };
}
/** Corrupted vs normal copies of one item for a hero, all ranks, games that lasted min_duration_s+ (fetchCorruptedStats). */
export interface CorruptedStat {
  item_id: number;
  corrupted: { wins: number; matches: number; avg_buy_time_s: number };
  normal: { wins: number; matches: number };
}
/**
 * One build style of the high-rank population (see scripts/styles.mjs). `main` is the population with every
 * alternative style's anchor items excluded; an alternative style is the population of games where its seed
 * item was bought. Item and ability stats are conditional on that filter; pair stats are shared.
 */
export interface StylePopulation {
  key: string;
  seed: number | null;
  anchors: number[];
  exclude: number[];
  matches: number;
  share: number;
  item_stats: ItemStat[];
  ability_order_stats: AbilityOrderStat[];
  item_ability_order_stats?: ItemAbilityOrderStats;
}
/**
 * Ability sequences from only the games where a charge item (an item that adds ability charges) was bought,
 * keyed by item id. Players who buy one level their charged abilities differently (fetchChargeOrders).
 */
export type ItemAbilityOrderStats = Record<string, AbilityOrderStat[]>;
/** Which aggregate population a build was generated from. */
export interface BuildPopulation {
  kind: 'top' | 'all';
  minBadge: number | null;
  matches: number;
  abilitySequenceKind: 'top' | 'all';
  /** set when the ability order comes from only the games where this charge item was bought */
  abilitySequenceItem?: Item;
  /** set when the hero has more than one established build style and this build is one of them */
  style?: { key: string; name: string; tagline: string; share: number; seed: Item | null; anchors: Item[]; exclude: Item[]; defining: Item[] };
}

/** Slimmed item-stats row used by the matchup (enemy-counter) experiment: see scripts/matchup-experiment.ts. */
export interface SlimStat {
  item_id: number;
  wins: number;
  matches: number;
}
/**
 * One hero's enemy-counter analytics snapshot, written by `scripts/fetch-data.mjs --matchups`.
 * `population` records the widening rung actually used (see plans/matchup-builds.md step 1).
 * `all` is the un-filtered item-stats for that same wide population; `vs[enemyId]` is the same
 * hero's item-stats filtered to games against that one enemy hero.
 */
export interface MatchupStats {
  hero_id: number;
  population: { min_badge: number | null; window_days: number };
  all: SlimStat[];
  vs: Record<string, SlimStat[]>;
}

export type Phase = 'early' | 'mid' | 'late';

import type { V2Data, V2Modes, V2Report } from './generator/v2/types';
export interface BuildItem {
  /** v2: this tile takes its colour's spend across a spike (docs/build-v2.md) */
  spike?: { slot: SlotType; threshold: number };
  item: Item;
  phase: Phase;
  order: number;
  runningTotal: number;
  paidCost: number; // cost after crediting a component already in the build
  upgradesFrom?: Item; // the component this item upgrades (if in the build)
  sellFor?: Item; // sell this item to make room when buying that one (it does not stay to the end)
  sellRate?: number; // share of sampled top players who sell it to make room
  corrupt?: { rank: number; gain: number; matches: number; normalWinRate: number; corruptedWinRate: number }; // swap for the corrupted copy at the Broker; rank 1 first
  imbueOn?: { ability: Ability; builds: number }; // put this imbue item on that ability; builds = published builds that do (0: fallback pick)
  score: number;
  reasons: string[];
  usageRate: number;
  winRate: number;
  avgBuyTimeS: number;
}
export interface AbilityStep {
  ability: Ability;
  kind: 'unlock' | 'tier1' | 'tier2' | 'tier3';
  index: number;
}
export interface Build {
  key: string;
  name: string;
  tagline: string;
  heroId: number;
  items: BuildItem[];
  totalCost: number;
  abilityOrder: AbilityStep[];
  abilityOrderSupport: { matches: number; winRate: number } | null;
  population: BuildPopulation;
  /** v2 builds only: the reasoning Details shows */
  v2?: V2Report;
}
