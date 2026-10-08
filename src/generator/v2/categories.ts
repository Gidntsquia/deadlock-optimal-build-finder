// Item categories from the item's own stat lines first (items.json properties); items with no deciding stat are
// classed from when they are bought (data fills the gaps). Table: docs/item-categories.md.
import type { Item } from '../../types';
import { UNIT_VALUE } from '../stats';
import type { Category, ItemCategory } from './types';

/** property -> category. A stat line that is zero or missing does not count. */
export const PROPERTY_CATEGORY: Record<string, Category> = {
  // clear speed: damage and healing against creeps and neutrals
  NonPlayerBonusWeaponPower: 'clearSpeed', NPCDamageMult: 'clearSpeed', WeaponPowerPerStackNonHero: 'clearSpeed', NonHeroStackLimit: 'clearSpeed',
  DamagePctVsNonHeroes: 'clearSpeed', NonHeroMult: 'clearSpeed', NonHeroHealPct: 'clearSpeed', NonHeroAbilityLifestealTooltipOnly: 'clearSpeed',
  HealFromNPC: 'clearSpeed', DotMultiplerTroopers: 'clearSpeed', NonPlayerBulletResist: 'clearSpeed',
  // souls
  BonusSoulsPct: 'souls', StackingGoldPerMinute: 'souls', BonusGoldPerMinute: 'souls', StartingGold: 'souls', BonusBuffsPerGold: 'souls',
  // lane sustain: health back out of combat
  OutOfCombatHealthRegen: 'laneSustain', BonusHealthRegen: 'laneSustain', HealLifePercentOutOfCombat: 'laneSustain', Regeneration: 'laneSustain', TotalHealthRegen: 'laneSustain',
  // weapon damage
  BaseAttackDamagePercent: 'weaponDamage', BaseAttackDamagePercentBonus: 'weaponDamage', BonusFireRate: 'weaponDamage', BonusClipSizePercent: 'weaponDamage', BulletLifestealPercent: 'weaponDamage',
  BonusBulletSpeedPercent: 'weaponDamage', BulletArmorReduction: 'weaponDamage', BulletResistReduction: 'weaponDamage', CloseRangeBonusWeaponPower: 'weaponDamage', LongRangeBonusWeaponPower: 'weaponDamage',
  WeaponPowerPerStack: 'weaponDamage', CritDamagePercent: 'weaponDamage', HeadShotBonusDamage: 'weaponDamage', BonusAttackRangePercent: 'weaponDamage', FireRatePerKill: 'weaponDamage',
  ProcBaseAttackDamagePercent: 'weaponDamage', BulletSplitShot: 'weaponDamage', BonusMeleeDamagePercent: 'weaponDamage', BonusHeavyMeleeDamage: 'weaponDamage', BulletsBonusMagicDamage: 'weaponDamage',
  // spirit damage
  TechPower: 'spiritDamage', SpiritPower: 'spiritDamage', BonusSpirit: 'spiritDamage', TechPowerPercent: 'spiritDamage', SpiritDamage: 'spiritDamage', CooldownReduction: 'spiritDamage',
  TechRangeMultiplier: 'spiritDamage', TechRadiusMultiplier: 'spiritDamage', BonusAbilityDurationPercent: 'spiritDamage', MagicResistReduction: 'spiritDamage', AbilityLifestealPercentHero: 'spiritDamage',
  BonusAbilityCharges: 'spiritDamage', ProcBonusMagicDamage: 'spiritDamage', ImbuedTechPower: 'spiritDamage', MagicIncreasePerStack: 'spiritDamage', UltimateCooldownReduction: 'spiritDamage',
  SpiritPowerInnate: 'spiritDamage', BonusSpiritLifesteal: 'spiritDamage', ImbuedCooldownReduction: 'spiritDamage', TechPowerReduction: 'spiritDamage',
  // survivability
  BonusHealth: 'survivability', BulletResist: 'survivability', TechResist: 'survivability', CombatBarrier: 'survivability', StatusResistancePercent: 'survivability', MeleeResistPercent: 'survivability',
  SlowResistancePercent: 'survivability', TechArmorDamageReduction: 'survivability', DeathImmunityDuration: 'survivability', DeflectionPercent: 'survivability', BonusBaseHealth: 'survivability',
  VexBarrierCombatBarrier: 'survivability', GuardianWardCombatBarrier: 'survivability', InnateStatusResistancePercent: 'survivability', HealOnKill: 'survivability', HealFromHero: 'survivability',
  // mobility
  BonusMoveSpeed: 'mobility', BonusSprintSpeed: 'mobility', Stamina: 'mobility', StaminaCooldownReduction: 'mobility', AirControlPercent: 'mobility', SlideScale: 'mobility', FlyMoveSpeed: 'mobility',
  ActiveBonusMoveSpeed: 'mobility', StackingBonusSprintSpeed: 'mobility', AirMoveIncreasePercent: 'mobility',
};
/** Categories whose value is a standard-game mechanic (souls, creep and jungle clear, objectives, lane sustain). Street Brawl has none of it. */
export const STANDARD_ONLY: Category[] = ['souls', 'clearSpeed', 'laneSustain'];
/** (farm fit, fight fit): how much each category helps while farming and while fighting, 0..1. Used by the role term. */
export const ROLE_FIT: Record<Category, [number, number]> = {
  clearSpeed: [1, 0], souls: [1, 0.1], laneSustain: [0.7, 0.2], weaponDamage: [0.6, 0.8], spiritDamage: [0.6, 0.8],
  survivability: [0.4, 0.7], mobility: [0.4, 0.6], actives: [0.2, 0.8], utility: [0.5, 0.5],
};

const num = (v: unknown) => { const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[^-\d.]/g, '')); return Number.isFinite(n) ? n : 0; };

export function categorize(item: Item, avgBuyTimeS: number | null, farmEndS: number): ItemCategory {
  const weight = new Map<Category, number>(); const deciding = new Map<Category, string[]>();
  for (const [k, p] of Object.entries(item.properties)) {
    const cat = PROPERTY_CATEGORY[k];
    if (!cat || !num(p.value)) continue;
    weight.set(cat, (weight.get(cat) ?? 0) + Math.abs(num(p.value)) * (UNIT_VALUE[k] ?? 20));
    deciding.set(cat, [...(deciding.get(cat) ?? []), k]);
  }
  if (item.is_active_item) { weight.set('actives', (weight.get('actives') ?? 0) + 1); deciding.set('actives', [...(deciding.get('actives') ?? []), 'is_active_item']); }
  if (!weight.size) {
    // no deciding stat: class from the data. It is utility, and the farm/fight side follows when the item is bought
    const when = avgBuyTimeS === null ? 'no games' : `bought at ${Math.round(avgBuyTimeS / 60)} min, ${avgBuyTimeS < farmEndS ? 'farm' : 'fight'} window`;
    return { itemId: item.id, primary: 'utility', all: ['utility'], deciding: [`no stat line; ${when}`], source: 'data' };
  }
  // an active only decides the class when no stat line does (its stats are usually the real value)
  const stat = [...weight].filter(([c]) => c !== 'actives');
  const ranked = (stat.length ? stat : [...weight]).sort((a, b) => b[1] - a[1]);
  const primary = ranked[0][0];
  return { itemId: item.id, primary, all: [...weight.keys()], deciding: deciding.get(primary) ?? [], source: 'stats' };
}
