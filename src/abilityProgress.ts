import type { AbilityStep, BuildItem, Hero, Item } from './types';

// Build progress for the ability card: the build's item buys and ability points on one souls line,
// and what the hero has at each moment (level, items held, the stats those give abilities).
// Souls are the build's running item cost; ability points come at the hero's level thresholds.

export type Moment =
  | { kind: 'start'; souls: 0 }
  | { kind: 'item'; souls: number; item: BuildItem }
  | { kind: 'point'; souls: number; point: number }
  | { kind: 'level'; souls: number; level: number };

export type HeroLevels = Pick<Hero, 'level_info' | 'standard_level_up_upgrades'>;

const levelsOf = (hero: HeroLevels) =>
  Object.entries(hero.level_info ?? {})
    .map(([lv, v]) => ({ level: Number(lv), souls: v.required_gold ?? 0, gives: v.bonus_currencies ?? [] }))
    .sort((a, b) => a.level - b.level);

const POINT_COST = { unlock: 0, tier1: 1, tier2: 2, tier3: 5 } as const;

/** Souls at which each step of the order can be bought: walk the levels until enough unlocks or points are saved up. */
export function pointSouls(order: AbilityStep[], hero: HeroLevels): number[] {
  const levels = levelsOf(hero);
  let li = 0;
  let unlocks = 0;
  let points = 0;
  let souls = 0;
  return order.map((s) => {
    const ok = () => (s.kind === 'unlock' ? unlocks > 0 : points >= POINT_COST[s.kind]);
    while (!ok() && li < levels.length) {
      const l = levels[li++];
      souls = l.souls;
      if (l.gives.includes('EAbilityUnlocks')) unlocks++;
      if (l.gives.includes('EAbilityPoints')) points++;
    }
    if (s.kind === 'unlock') unlocks--;
    else points -= POINT_COST[s.kind];
    return souls;
  });
}

/**
 * Start, then every item buy and ability point in souls order (an item before a point at the same souls), plus a stop
 * for each level reached where nothing else happens, so no level is skipped.
 */
export function timeline(items: BuildItem[], order: AbilityStep[], hero: HeroLevels): Moment[] {
  const at = pointSouls(order, hero);
  const rest: Moment[] = [
    ...items.map((item): Moment => ({ kind: 'item', souls: item.runningTotal, item })),
    ...order.map((_, point): Moment => ({ kind: 'point', souls: at[point], point })),
  ];
  const end = Math.max(0, ...rest.map((m) => m.souls));
  const taken = new Set(rest.map((m) => m.souls));
  for (const l of levelsOf(hero)) if (l.souls > 0 && l.souls <= end && !taken.has(l.souls)) rest.push({ kind: 'level', souls: l.souls, level: l.level });
  rest.sort((a, b) => a.souls - b.souls || (a.kind === b.kind ? 0 : a.kind === 'item' ? -1 : 1));
  return [{ kind: 'start', souls: 0 }, ...rest];
}

export function levelAt(hero: HeroLevels, souls: number): number {
  let level = 1;
  for (const l of levelsOf(hero)) if (l.souls <= souls) level = l.level;
  return level;
}

/** Items held after the first `upTo` moments: bought, not yet turned into an upgrade or sold to make room. */
export function heldItems(moments: Moment[], upTo: number): BuildItem[] {
  const bought = moments.slice(0, upTo + 1).flatMap((m) => (m.kind === 'item' ? [m.item] : []));
  const ids = new Set(bought.map((b) => b.item.id));
  return bought.filter((b) => !bought.some((o) => o.upgradesFrom?.id === b.item.id) && !(b.sellFor && ids.has(b.sellFor.id)));
}

// ---- what items give abilities ----
const n = (i: Item, k: string) => {
  const v = parseFloat(String(i.properties[k]?.value));
  return Number.isFinite(v) ? v : 0;
};
const SPIRIT = ['TechPower', 'SpiritPower', 'SpiritPowerInnate'];
const STATS = [
  ...SPIRIT,
  'TechPowerPercent',
  'CooldownReduction',
  'BonusAbilityDurationPercent',
  'TechRangeMultiplier',
  'TechRadiusMultiplier',
  'BonusAbilityCharges',
  'BonusAbilityChargesNonCharge',
  'BonusSpiritForChargedAbilities',
  'CooldownReductionOnChargedAbilities',
  'CooldownBetweenChargeReduction',
  'UltimateCooldownReduction',
  'ImbuedTechPower',
  'ImbuedCooldownReduction',
];

/**
 * The stats an item gives every ability all the time: its always-on stats, plus passive lines the game shows as headline
 * stats with no condition. Lines behind a condition ("while above 65% health") or an active do not count. Imbue lines go
 * to `imbue`: they count only for the one ability the item is put on.
 */
export function itemBoosts(i: Item): { always: Record<string, number>; imbue: Record<string, number> | null } {
  const always: Record<string, number> = {};
  let imbue: Record<string, number> | null = null;
  const add = (to: Record<string, number>, k: string) => {
    const v = n(i, k);
    if (!v || !STATS.includes(k)) return;
    to[k] = (to[k] ?? 0) + v;
    // range items carry the matching radius line hidden; count it with the range line
    if (k === 'TechRangeMultiplier' && !('TechRadiusMultiplier' in to)) to.TechRadiusMultiplier = n(i, 'TechRadiusMultiplier') || v;
  };
  for (const s of i.tooltip_sections ?? [])
    for (const a of s.section_attributes ?? []) {
      if (/imbue/i.test(a.loc_string ?? '')) {
        imbue ??= {};
        for (const k of [...(a.elevated_properties ?? []), ...(a.important_properties ?? [])]) add(imbue, k);
      } else if (s.section_type === 'innate') {
        for (const k of [...(a.properties ?? []), ...(a.elevated_properties ?? []), ...(a.important_properties ?? [])]) add(always, k);
      } else if (s.section_type === 'passive') {
        for (const k of a.elevated_properties ?? []) add(always, k);
      }
    }
  return { always, imbue: imbue && Object.keys(imbue).length ? imbue : null };
}

export type Boosts = {
  level: number;
  spirit: number; // spirit power from levels and items
  spiritPct: number;
  cdr: number[]; // each cooldown reduction, as a share (they stack one after another)
  duration: number; // %
  range: number; // %
  radius: number; // %
  charges: number; // more charges for an ability that has them
  newCharges: number; // charges for an ability that has none (Omnicharge imbue)
  chargedSpirit: number;
  chargedCdr: number;
  betweenChargeCdr: number;
  ultCdr: number;
};

/** Sum what the held items (and the imbues put on this ability) give, plus spirit power from levels. */
export function boostsAt(hero: HeroLevels, souls: number, held: Item[], imbued: Item[]): Boosts {
  const level = levelAt(hero, souls);
  const perLevel = hero.standard_level_up_upgrades?.MODIFIER_VALUE_TECH_POWER ?? 0;
  const b: Boosts = {
    level,
    spirit: perLevel * (level - 1),
    spiritPct: 0,
    cdr: [],
    duration: 0,
    range: 0,
    radius: 0,
    charges: 0,
    newCharges: 0,
    chargedSpirit: 0,
    chargedCdr: 0,
    betweenChargeCdr: 0,
    ultCdr: 0,
  };
  const take = (s: Record<string, number>) => {
    for (const k of SPIRIT) b.spirit += s[k] ?? 0;
    b.spirit += s.ImbuedTechPower ?? 0;
    b.spiritPct += s.TechPowerPercent ?? 0;
    for (const k of ['CooldownReduction', 'ImbuedCooldownReduction']) if (s[k]) b.cdr.push(s[k] / 100);
    b.duration += s.BonusAbilityDurationPercent ?? 0;
    b.range += s.TechRangeMultiplier ?? 0;
    b.radius += s.TechRadiusMultiplier ?? 0;
    b.charges += s.BonusAbilityCharges ?? 0;
    b.newCharges += s.BonusAbilityChargesNonCharge ?? 0;
    b.chargedSpirit += s.BonusSpiritForChargedAbilities ?? 0;
    b.chargedCdr += s.CooldownReductionOnChargedAbilities ?? 0;
    b.betweenChargeCdr += s.CooldownBetweenChargeReduction ?? 0;
    b.ultCdr += s.UltimateCooldownReduction ?? 0;
  };
  for (const i of held) take(itemBoosts(i).always);
  for (const i of imbued) take(itemBoosts(i).imbue ?? {});
  return b;
}
