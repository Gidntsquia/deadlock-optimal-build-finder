# Item categories

Written by `npx tsx scripts/item-categories-doc.ts` from `public/data/items.json` (173 shopable items). The v2 generator (`src/generator/v2/categories.ts`) sorts each item by its own stat lines; the property with the largest weighted value decides the category. An item with no deciding stat line is "utility", and its farm/fight side follows when Infernus players buy it (`data` in the Source column).

Standard-only categories (souls, clear speed, lane sustain) never get a Street Brawl lift.

actives: 3, clearSpeed: 5, laneSustain: 4, mobility: 16, souls: 3, spiritDamage: 37, survivability: 57, utility: 5, weaponDamage: 43

| Item | Slot | Tier | Category | Also | Deciding properties | Source |
| --- | --- | --- | --- | --- | --- | --- |
| Cursed Relic | spirit | 4 | actives | - | is_active_item | stats |
| Mystical Piano | spirit | 5 | actives | - | is_active_item | stats |
| Prism Blast | spirit | 5 | actives | - | is_active_item | stats |
| Spirit Burn | spirit | 4 | clearSpeed | spiritDamage | DamagePctVsNonHeroes | stats |
| Lifestrike | vitality | 3 | clearSpeed | weaponDamage, survivability | NonHeroHealPct | stats |
| Melee Lifesteal | vitality | 1 | clearSpeed | weaponDamage | NonHeroHealPct | stats |
| Monster Rounds | weapon | 1 | clearSpeed | laneSustain | NonPlayerBonusWeaponPower, NonPlayerBulletResist | stats |
| Toxic Bullets | weapon | 3 | clearSpeed | - | DotMultiplerTroopers | stats |
| Extra Regen | vitality | 1 | laneSustain | - | BonusHealthRegen, OutOfCombatHealthRegen | stats |
| Healing Booster | vitality | 2 | laneSustain | - | BonusHealthRegen, OutOfCombatHealthRegen | stats |
| Healing Nova | vitality | 3 | laneSustain | spiritDamage, actives | TotalHealthRegen | stats |
| Healing Rite | vitality | 1 | laneSustain | mobility, actives | TotalHealthRegen | stats |
| Radiant Regeneration | spirit | 3 | mobility | laneSustain, survivability | BonusMoveSpeed | stats |
| Shrink Ray | spirit | 5 | mobility | weaponDamage, actives | BonusMoveSpeed | stats |
| Slowing Hex | spirit | 2 | mobility | actives | BonusSprintSpeed | stats |
| Surge of Power | spirit | 3 | mobility | spiritDamage | BonusMoveSpeed | stats |
| Celestial Blessing | vitality | 5 | mobility | actives | StaminaCooldownReduction | stats |
| Electric Slippers | vitality | 5 | mobility | - | SlideScale, Stamina | stats |
| Enduring Speed | vitality | 2 | mobility | survivability, laneSustain | BonusMoveSpeed | stats |
| Extra Stamina | vitality | 1 | mobility | - | Stamina, StaminaCooldownReduction | stats |
| Majestic Leap | vitality | 3 | mobility | survivability, actives | AirControlPercent | stats |
| Seraphim Wings | vitality | 5 | mobility | - | StaminaCooldownReduction, AirControlPercent | stats |
| Sprint Boots | vitality | 1 | mobility | laneSustain | BonusSprintSpeed | stats |
| Stamina Mastery | vitality | 3 | mobility | - | Stamina, StaminaCooldownReduction, AirMoveIncreasePercent | stats |
| Veil Walker | vitality | 3 | mobility | survivability, spiritDamage | BonusMoveSpeed | stats |
| Burst Fire | weapon | 3 | mobility | weaponDamage | SlideScale, BonusMoveSpeed | stats |
| Shadow Weave | weapon | 3 | mobility | laneSustain, actives | BonusSprintSpeed | stats |
| Stalker | weapon | 2 | mobility | survivability, weaponDamage | BonusMoveSpeed | stats |
| Golden Goose Egg | spirit | 1 | souls | mobility, laneSustain, actives | BonusGoldPerMinute, StartingGold, BonusBuffsPerGold | stats |
| Trophy Collector | vitality | 2 | souls | mobility, laneSustain, clearSpeed | StackingGoldPerMinute | stats |
| Cultist Sacrifice | weapon | 3 | souls | clearSpeed, laneSustain, survivability, weaponDamage, spiritDamage, actives | BonusSoulsPct | stats |
| Arcane Surge | spirit | 2 | spiritDamage | mobility | BonusAbilityDurationPercent, SpiritPower | stats |
| Boundless Spirit | spirit | 4 | spiritDamage | survivability, laneSustain | TechPower, TechPowerPercent | stats |
| Compress Cooldown | spirit | 2 | spiritDamage | - | CooldownReduction | stats |
| Decay | spirit | 3 | spiritDamage | survivability, actives | TechPower | stats |
| Duration Extender | spirit | 2 | spiritDamage | - | BonusAbilityDurationPercent | stats |
| Extra Charge | spirit | 1 | spiritDamage | - | BonusAbilityCharges | stats |
| Extra Spirit | spirit | 1 | spiritDamage | - | TechPower | stats |
| Focus Lens | spirit | 4 | spiritDamage | weaponDamage, actives | MagicResistReduction, TechPowerReduction | stats |
| Frostbite Charm | spirit | 5 | spiritDamage | - | ImbuedCooldownReduction, ImbuedTechPower | stats |
| Greater Expansion | spirit | 3 | spiritDamage | survivability | TechRangeMultiplier, TechRadiusMultiplier | stats |
| Improved Spirit | spirit | 2 | spiritDamage | mobility, survivability, laneSustain | TechPower | stats |
| Magic Carpet | spirit | 4 | spiritDamage | mobility, survivability, actives | TechPower, BonusAbilityDurationPercent | stats |
| Mystic Conduit | spirit | 5 | spiritDamage | - | TechPower, TechRangeMultiplier, TechRadiusMultiplier, CooldownReduction | stats |
| Mystic Expansion | spirit | 1 | spiritDamage | - | TechRangeMultiplier, TechRadiusMultiplier | stats |
| Mystic Reverb | spirit | 4 | spiritDamage | - | AbilityLifestealPercentHero | stats |
| Omnicharge Signet | spirit | 5 | spiritDamage | - | BonusAbilityCharges | stats |
| Rapid Recharge | spirit | 3 | spiritDamage | - | BonusAbilityCharges | stats |
| Spirit Sap | spirit | 2 | spiritDamage | survivability, actives | MagicResistReduction, TechPowerReduction | stats |
| Spirit Snatch | spirit | 3 | spiritDamage | survivability, weaponDamage | SpiritDamage, TechPowerReduction | stats |
| Spirit Strike | spirit | 1 | spiritDamage | survivability | SpiritDamage | stats |
| Superior Cooldown | spirit | 3 | spiritDamage | laneSustain | CooldownReduction | stats |
| Superior Duration | spirit | 3 | spiritDamage | survivability | BonusAbilityDurationPercent | stats |
| Transcendent Cooldown | spirit | 4 | spiritDamage | laneSustain | CooldownReduction | stats |
| Vortex Web | spirit | 4 | spiritDamage | mobility, actives | TechRangeMultiplier, TechRadiusMultiplier | stats |
| Counterspell | vitality | 3 | spiritDamage | mobility, survivability | SpiritPower, SpiritPowerInnate | stats |
| Enchanter's Emblem | vitality | 2 | spiritDamage | survivability, laneSustain | TechPower, CooldownReduction | stats |
| Infuser | vitality | 4 | spiritDamage | survivability, clearSpeed, actives | TechPower, BonusSpirit, AbilityLifestealPercentHero | stats |
| Leech | vitality | 4 | spiritDamage | weaponDamage, survivability | TechPower, AbilityLifestealPercentHero | stats |
| Rescue Beam | vitality | 3 | spiritDamage | mobility, actives | TechRangeMultiplier, TechRadiusMultiplier | stats |
| Spirit Lifesteal | vitality | 2 | spiritDamage | clearSpeed, survivability | TechPower, AbilityLifestealPercentHero | stats |
| Witchmail | vitality | 4 | spiritDamage | survivability | TechPower, CooldownReduction | stats |
| Alchemical Fire | weapon | 3 | spiritDamage | weaponDamage, actives | SpiritPower | stats |
| Ballistic Enchantment | weapon | 3 | spiritDamage | weaponDamage, clearSpeed | TechRangeMultiplier, TechRadiusMultiplier | stats |
| Mystic Shot | weapon | 2 | spiritDamage | - | ProcBonusMagicDamage, SpiritPower | stats |
| Spirit Rend | weapon | 3 | spiritDamage | survivability | AbilityLifestealPercentHero, MagicResistReduction | stats |
| Spirit Shredder | weapon | 2 | spiritDamage | survivability | AbilityLifestealPercentHero | stats |
| Spiritual Overflow | weapon | 4 | spiritDamage | clearSpeed, survivability, weaponDamage | TechPower, AbilityLifestealPercentHero, BonusSpirit, BonusSpiritLifesteal, BonusAbilityDurationPercent | stats |
| Arctic Blast | spirit | 4 | survivability | clearSpeed, actives | TechResist | stats |
| Cold Front | spirit | 2 | survivability | clearSpeed, actives | TechResist | stats |
| Echo Shard | spirit | 4 | survivability | actives | TechResist, BulletResist | stats |
| Escalating Exposure | spirit | 4 | survivability | spiritDamage | TechResist, TechArmorDamageReduction | stats |
| Ethereal Shift | spirit | 4 | survivability | spiritDamage, mobility, actives | TechResist | stats |
| Knockdown | spirit | 3 | survivability | spiritDamage, actives | BonusHealth | stats |
| Lightning Scroll | spirit | 4 | survivability | mobility | BonusHealth | stats |
| Mystic Regeneration | spirit | 1 | survivability | laneSustain | BonusHealth | stats |
| Mystic Slow | spirit | 2 | survivability | mobility | BonusHealth | stats |
| Mystic Vulnerability | spirit | 2 | survivability | - | TechArmorDamageReduction, TechResist | stats |
| Refresher | spirit | 4 | survivability | actives | TechResist, BulletResist | stats |
| Rusted Barrel | spirit | 1 | survivability | mobility, weaponDamage, actives | BonusHealth | stats |
| Scourge | spirit | 4 | survivability | actives | TechResist, BonusHealth, StatusResistancePercent | stats |
| Silence Wave | spirit | 3 | survivability | actives | BonusHealth | stats |
| Suppressor | spirit | 2 | survivability | spiritDamage | BulletResist | stats |
| Tankbuster | spirit | 3 | survivability | - | BonusHealth | stats |
| Torment Pulse | spirit | 3 | survivability | - | BonusHealth, MeleeResistPercent | stats |
| Unstable Concoction | spirit | 5 | survivability | spiritDamage, mobility, weaponDamage, actives | BonusHealth | stats |
| Bullet Resilience | vitality | 3 | survivability | laneSustain | BulletResist | stats |
| Cheat Death | vitality | 4 | survivability | - | DeathImmunityDuration, BonusHealth, BulletResist | stats |
| Cloak of Opportunity | vitality | 5 | survivability | mobility | CombatBarrier | stats |
| Debuff Reducer | vitality | 2 | survivability | - | StatusResistancePercent, BonusHealth | stats |
| Dispel Magic | vitality | 3 | survivability | mobility, actives | TechResist | stats |
| Divine Barrier | vitality | 4 | survivability | laneSustain, mobility, spiritDamage, actives | CombatBarrier | stats |
| Diviner's Kevlar | vitality | 4 | survivability | spiritDamage | CombatBarrier | stats |
| Extra Health | vitality | 1 | survivability | - | BonusHealth | stats |
| Fortitude | vitality | 3 | survivability | laneSustain, mobility | BonusHealth | stats |
| Fury Trance | vitality | 3 | survivability | weaponDamage, mobility, actives | TechResist, BonusHealth | stats |
| Grit | vitality | 1 | survivability | laneSustain, actives | CombatBarrier | stats |
| Guardian Ward | vitality | 2 | survivability | laneSustain, mobility, spiritDamage, actives | GuardianWardCombatBarrier | stats |
| Healbane | vitality | 2 | survivability | spiritDamage | HealOnKill | stats |
| Indomitable | vitality | 4 | survivability | laneSustain | BulletResist, TechResist, VexBarrierCombatBarrier | stats |
| Inhibitor | vitality | 4 | survivability | weaponDamage | BonusHealth | stats |
| Juggernaut | vitality | 4 | survivability | laneSustain, mobility | MeleeResistPercent, SlowResistancePercent | stats |
| Metal Skin | vitality | 3 | survivability | actives | BulletResist | stats |
| Nullification Burst | vitality | 5 | survivability | actives | BonusHealth, StatusResistancePercent | stats |
| Plated Armor | vitality | 4 | survivability | - | DeflectionPercent, BonusHealth | stats |
| Reactive Barrier | vitality | 2 | survivability | laneSustain | VexBarrierCombatBarrier | stats |
| Rebuttal | vitality | 1 | survivability | - | BonusHealth, MeleeResistPercent | stats |
| Restorative Locket | vitality | 2 | survivability | actives | TechResist | stats |
| Return Fire | vitality | 2 | survivability | actives | BulletResist | stats |
| Shadow Strike | vitality | 5 | survivability | mobility | BonusHealth | stats |
| Spellbreaker | vitality | 4 | survivability | - | TechResist, StatusResistancePercent, BonusHealth | stats |
| Spirit Resilience | vitality | 3 | survivability | laneSustain | TechResist | stats |
| Spirit Shielding | vitality | 2 | survivability | laneSustain | CombatBarrier, TechResist | stats |
| Unstoppable | vitality | 4 | survivability | actives | BonusHealth, StatusResistancePercent | stats |
| Vampiric Burst | vitality | 4 | survivability | weaponDamage, actives | BonusHealth, BulletResist | stats |
| Warp Stone | vitality | 3 | survivability | actives | BulletResist | stats |
| Weapon Shielding | vitality | 2 | survivability | laneSustain | CombatBarrier, BulletResist | stats |
| Berserker | weapon | 3 | survivability | weaponDamage | BulletResist | stats |
| Crippling Headshot | weapon | 4 | survivability | weaponDamage, spiritDamage | BonusHealth | stats |
| Fleetfoot | weapon | 2 | survivability | mobility, weaponDamage, actives | BulletResist, SlowResistancePercent | stats |
| Hunter's Aura | weapon | 3 | survivability | weaponDamage, mobility | BonusHealth | stats |
| Restorative Shot | weapon | 1 | survivability | clearSpeed, weaponDamage | HealFromHero | stats |
| Runed Gauntlets | weapon | 5 | survivability | weaponDamage | MeleeResistPercent | stats |
| Silencer | weapon | 4 | survivability | - | TechResist | stats |
| Weakening Headshot | weapon | 2 | survivability | weaponDamage | BonusHealth | stats |
| Mystic Burst | spirit | 1 | utility | - | no stat line; no games | data |
| Eternal Gift | vitality | 5 | utility | - | no stat line; no games | data |
| Haunting Shot | weapon | 5 | utility | - | no stat line; no games | data |
| Slowing Bullets | weapon | 2 | utility | - | no stat line; no games | data |
| Tesla Bullets | weapon | 3 | utility | - | no stat line; bought at 18 min, fight window | data |
| Bullet Resist Shredder | spirit | 2 | weaponDamage | survivability | BulletArmorReduction, BaseAttackDamagePercent | stats |
| Disarming Hex | spirit | 3 | weaponDamage | mobility, survivability, actives | BulletArmorReduction | stats |
| Mercurial Magnum | spirit | 4 | weaponDamage | spiritDamage | BonusFireRate, BulletsBonusMagicDamage, BonusClipSizePercent | stats |
| Quicksilver Reload | spirit | 2 | weaponDamage | - | BonusFireRate | stats |
| Battle Vest | vitality | 2 | weaponDamage | survivability, laneSustain | BaseAttackDamagePercent, BonusFireRate | stats |
| Bullet Lifesteal | vitality | 2 | weaponDamage | survivability | BulletLifestealPercent, BaseAttackDamagePercent | stats |
| Colossus | vitality | 4 | weaponDamage | survivability, actives | BaseAttackDamagePercent, BonusMeleeDamagePercent | stats |
| Healing Tempo | vitality | 4 | weaponDamage | mobility, survivability, laneSustain | BonusFireRate | stats |
| Phantom Strike | vitality | 4 | weaponDamage | spiritDamage, actives | BaseAttackDamagePercent | stats |
| Siphon Bullets | vitality | 4 | weaponDamage | survivability | BaseAttackDamagePercent | stats |
| Active Reload | weapon | 2 | weaponDamage | mobility | BulletLifestealPercent, BonusFireRate, BonusClipSizePercent | stats |
| Armor Piercer | weapon | 4 | weaponDamage | - | BonusBulletSpeedPercent, BaseAttackDamagePercent | stats |
| Blood Tribute | weapon | 3 | weaponDamage | survivability, mobility, laneSustain, actives | BonusFireRate | stats |
| Capacitor | weapon | 4 | weaponDamage | actives | BonusFireRate | stats |
| Close Quarters | weapon | 1 | weaponDamage | survivability | CloseRangeBonusWeaponPower | stats |
| Crushing Fists | weapon | 4 | weaponDamage | survivability | BonusMeleeDamagePercent, BonusHeavyMeleeDamage, BulletResistReduction | stats |
| Escalating Resilience | weapon | 3 | weaponDamage | survivability | BaseAttackDamagePercent, BonusClipSizePercent | stats |
| Express Shot | weapon | 3 | weaponDamage | - | BonusBulletSpeedPercent, BaseAttackDamagePercent, ProcBaseAttackDamagePercent | stats |
| Extended Magazine | weapon | 1 | weaponDamage | - | BonusClipSizePercent, BaseAttackDamagePercent | stats |
| Frenzy | weapon | 4 | weaponDamage | survivability | BonusFireRate, BulletLifestealPercent | stats |
| Glass Cannon | weapon | 4 | weaponDamage | - | BaseAttackDamagePercent, FireRatePerKill | stats |
| Headhunter | weapon | 3 | weaponDamage | survivability, mobility | HeadShotBonusDamage, BaseAttackDamagePercent | stats |
| Headshot Booster | weapon | 1 | weaponDamage | survivability | HeadShotBonusDamage | stats |
| Heroic Aura | weapon | 3 | weaponDamage | mobility, survivability, clearSpeed, actives | BonusFireRate | stats |
| High-Velocity Rounds | weapon | 1 | weaponDamage | - | BonusBulletSpeedPercent, BaseAttackDamagePercent | stats |
| Hollow Point | weapon | 3 | weaponDamage | laneSustain, survivability | BaseAttackDamagePercent, BulletArmorReduction | stats |
| Infinite Rounds | weapon | 5 | weaponDamage | - | BonusBulletSpeedPercent, BonusFireRate | stats |
| Intensifying Magazine | weapon | 2 | weaponDamage | - | BonusClipSizePercent | stats |
| Kinetic Dash | weapon | 2 | weaponDamage | mobility | BonusFireRate | stats |
| Long Range | weapon | 2 | weaponDamage | mobility | LongRangeBonusWeaponPower, BonusAttackRangePercent | stats |
| Lucky Shot | weapon | 4 | weaponDamage | - | CritDamagePercent, BonusClipSizePercent | stats |
| Melee Charge | weapon | 2 | weaponDamage | survivability | BonusMeleeDamagePercent, BonusHeavyMeleeDamage | stats |
| Opening Rounds | weapon | 2 | weaponDamage | spiritDamage | BonusBulletSpeedPercent, BaseAttackDamagePercent, BaseAttackDamagePercentBonus | stats |
| Point Blank | weapon | 3 | weaponDamage | survivability | CloseRangeBonusWeaponPower | stats |
| Rapid Rounds | weapon | 1 | weaponDamage | - | BonusFireRate | stats |
| Recharging Rush | weapon | 2 | weaponDamage | - | BonusClipSizePercent, BaseAttackDamagePercent | stats |
| Ricochet | weapon | 4 | weaponDamage | - | BonusFireRate | stats |
| Sharpshooter | weapon | 3 | weaponDamage | mobility | BaseAttackDamagePercent, LongRangeBonusWeaponPower, BonusAttackRangePercent, BonusBulletSpeedPercent | stats |
| Spellslinger | weapon | 4 | weaponDamage | spiritDamage | BonusFireRate | stats |
| Split Shot | weapon | 2 | weaponDamage | actives | BulletSplitShot | stats |
| Swift Striker | weapon | 2 | weaponDamage | mobility | BonusFireRate | stats |
| Titanic Magazine | weapon | 2 | weaponDamage | - | BonusClipSizePercent, BaseAttackDamagePercent | stats |
| Weighted Shots | weapon | 3 | weaponDamage | survivability, mobility | BaseAttackDamagePercent | stats |
