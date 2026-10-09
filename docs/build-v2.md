# Build v2 (Infernus)

A second way to make a build. Written for any hero; `src/generator/pipeline.ts` switches it on for Infernus only (`V2_HEROES`). The other 37 heroes go through the old generator, and their builds are byte-identical to before (checked by diffing every hero's items, order, reasons and ability order against the last commit before v2).

Try it: `npm run generate 1 --v2 --explain` prints, for every candidate item, the standard lift, the Street Brawl lift and the rule that denied it. Refresh the data with `npm run fetch-data -- --v2-only` (about 2 minutes).

## Data

Everything v2 reads comes from games at or after the latest patch: `PATCH_NAME` 09-29-2026, unix `PATCH_SINCE` 1790712000 (`scripts/fetch-v2.mjs`). Every block in `public/data/v2/` carries `min_unix_timestamp`, and `npm run verify` fails if one does not match. Standard data is Phantom and above. Street Brawl data is all ranks, because the API returns an error for a rank filter in that mode.

## Rules in plain words

1. **Base score** is the old generator's: shrunk win rate and how often the item is bought, in standard games.
2. **Street Brawl term (direct score term).** score = base score (rule 1) + `brawlWeight` x brawl term (in percentage points) + role term. The brawl term is the item's Street Brawl win rate when held, shrunk by its brawl games, relative to the hero's brawl average, minus the game-mode effect: the same item's Street Brawl result (shrunk, relative to each hero's brawl average) over every other hero, weighted by brawl games. So the term is how much more the item wins in Street Brawl on this hero than on anyone. It is a subtraction only: a negative game-mode effect is never added back (it counts as 0). Changed after pass 3: the effect used to be the item's brawl-minus-standard gap on other heroes, but standard win rates of late, rarely bought items are inflated (on Infernus, Phantom+ items bought after 31 min win 54.6% against 47.4% for those bought by 10 min; Street Brawl shows no such slope), which made the effect negative for late items and handed them their whole brawl result. That is how Indomitable got in. Win rate when held only; the Street Brawl buy rate is never used. An item that wins in standard (above average) and has a positive term may enter the candidate set below the old 12% usage floor.
3. **Gates (the term is zeroed, and the rule is shown in Details and in `--explain`)**: no Street Brawl games; bought in under 1% of the top item's standard games; standard win rate more than 2.0 pts below the hero's average (`minStdDelta`); a standard-only item (souls, creep and jungle clear, lane sustain); a spirit-scaling item (only spirit stat lines, e.g. the Expansions) whose standard delta is 0 or below; a negative term on an item that wins in standard (standard delta above 0), so Street Brawl can lift an item in but never pushes out one the standard games back (user, after pass 3: Ricochet, +2.0 pts in standard, had been pushed out by a -1.1 pts brawl term). Removed in this pass: the 5% floor, "standard delta must be >= 0", "must beat the game-mode effect", "bought inside the farm window".
4. **Role curve.** From the top players' post-patch games, per 5 minutes: farm (creep souls, creep kills) and fight (hero damage, kills + assists), each divided by its own game-long mean. The fight window starts at the first 5-minute bucket after minute 5 where fight activity is above 1.0 (its game-long average); the farm window is everything before. Infernus: minute 20 (buckets printed by `npm run verify`: fight 0.44, 0.74, 0.88, 0.93, then 1.26 at 20 min). The rule gives 20, not hand set. The snapshot stores damage and kills+assists as two numbers, so kills and assists are one measure. The brawl term counts in full in the fight window and half (`farmBrawlScale`) in the farm window. With fewer than 20 panel games the curve uses all players and says so.
5. **Support scale (brawl-only guard).** The brawl term is multiplied by `min(1, popRel / supportFull)` where popRel is the item's standard games over the top item's and `supportFull` is 0.03: an item bought in 1% of games gets a third of its brawl say, 3% or more gets all of it. Not a hand list: Greater and Mystic Expansion stay out because their brawl term is negative after the game-mode effect, they are spirit-only items, and they are bought in about 1% of games. The role term (category fit by buy time) is unchanged.
6. **Colour spike.** For each colour (weapon, vitality, spirit) walk the build in buy order: add an item's cost when it is bought and take it away at its sell point (sold-later items count until they are sold, exactly what is held at that moment). The buy where the running total first reaches or passes 4,800 souls (reaching exactly 4,800 counts) is the spike tile and gets a bounded bonus; moving the leading colour toward it gets a small one. The selection step has no order yet, so its bonus uses the chosen items' summed cost, which is the same total before any sale. The game's own spike table is not in the API, so only 4.8k is used. The build screen draws a 2px border plus a soft outer ring in the colour's tint on the crossing tile (and in the share image); the numbers are in Details.
7. **Counters.** Details lists, for the 10 most-played enemies, up to three swaps: items that win more against that hero than overall, with at least 60 games and 1 point of gain, each showing the item it replaces.
8. **Zergggy** (account 35187362): his post-patch games and the items he and the build share, and only one of them has.
9. **Panel agreement** is still shown, labelled "not targeted", and does not fail `verify` for v2 heroes.
10. **Order.** In six steps, in this order.
    1. *End state.* First pick the 12 items held when the build is finished: the items the selection kept (not a component of another item, not marked sell-later), best score first if there are more than 12. A must-have the user named (the litmus list) that the standard 12 holds keeps its place, so a lower-scored item is pushed out instead. `verify` prints these and the standard 12 (same step with `brawlWeight` 0) and fails if the items held at the end are not exactly the 12.
    2. *Brawl items are placed by their own tier and price.* A "lifted" item is in the 12 but not in the standard 12; a "pushed out" item is the reverse. Greedy from the costliest lifted item: a pushed-out item of the same colour and nearest tier, else any pushed-out item nearest in tier and price; that item is the one that leaves the build. The lifted item's buy time is the latest of three: the pushed-out item's standard time, just after the first item of the standard 12 of the same tier, and just after the standard build's running souls first cover the lifted item's price. So a tier 3 item is never bought before the standard build has its first tier 3 item (Spirit Resilience lands after Rapid Recharge, mid game, not in Early). Its own average buy time is never read (Street Brawl has no usable buy time). `--explain` prints "placed after <item>, <reason>" per lifted item; `verify` fails if a lifted item sits before the first standard item of its tier.
    3. *Spill.* Selected items outside the 12 (bought on the way and sold) stay only if bought before the first higher-tier item of their colour and before the last of the 12 is bought; otherwise they are dropped (a litmus must-have is never dropped for being late).
    4. *Components* are bought at their own standard time (Quicksilver Reload about 12 min, Sprint Boots about 14), never moved next to their upgrade. The one exception is a component whose time falls after its upgrade's, which goes just before it.
    5. *The 12-slot walk with sells.* Walk the order; when a buy would make 13 held, sell the lowest-scored held item that top players really sell (at least 10% of 20+ post-patch buyers), else the lowest-scored held item that is not in the 12 and not a component whose upgrade is unbought. Never sell one of the 12. If nothing can be sold, the lowest-scored spill item still unbought is cut (an item named in the litmus list last) and the walk runs again; only then does a held component wait until just before its upgrade. `verify` prints "most held N" and every sale with the buy it funds.
    6. *Then* phases (never stepping back; an over-full phase row, more than 11 tiles, hands its tail to the next one), running totals and the spike are recomputed on this order. `verify` fails if a T4 is bought before 18:00, a T1 after 25:00, or the three costliest lifted items fill the last three rows.
    `npm run generate 1 -- --v2 --explain` and `npm run verify` print the sets and where each item went.

11. **Upgrade chains.** When the build has an upgrade, its component is in the build too (added after selection if the selection did not pick it): it costs nothing extra in total and takes no slot at the end, since the upgrade replaces it. Grit -> Reactive Barrier -> Indomitable, Extra Charge -> Rapid Recharge, Sprint Boots -> Enduring Speed -> Juggernaut, Quicksilver Reload -> Mercurial Magnum. A component keeps its own standard buy time (rule 10); `verify` fails if an upgrade in the build has no component, or if a component is listed within one row before its upgrade while its own time is over 5 minutes earlier.

## Enhanced cards

Street Brawl rows are keyed by the base item, so enhanced cards cannot be separated from the API. The draft setup offers every card enhanced with the same chance, so no item is excluded for it. The standard-buy gate, the standard-direction gate and the game-mode effect do the filtering. This fallback is recorded in the report notes.

## Parameters (`V2_PARAMS`)

`brawlWeight` 5 (score per percentage point of brawl term), `roleWeight` 1.0, `spikeWeight` 0.35, `spikeMomentum` 0.1, `spikeThresholds` [4800], `minStandardShare` 0.01, `minStdDelta` -0.02, `supportFull` 0.03, `farmBrawlScale` 0.5, `brawlShrinkFrac` 0.2, `modeMinMatches` 200, `swapMinGames` 60, `swapMinLift` 0.01, `swapsPerEnemy` 3.

## Litmus items and the weight sweep

The user fixed these for Infernus: Mercurial Magnum, Titanic Magazine, Healbane, Mystic Vulnerability and Escalating Exposure in; Greater Expansion and Mystic Expansion out; after pass 3 the user added Ricochet in ("one of the best Infernus items") and Indomitable out ("neither good in standard or in street brawl") (`src/generator/v2/litmus.ts`). `npm run verify` checks them (a miss fails) and prints the deciding rule per item. `npm run generate 1 -- --v2 --sweep` runs weights 0.5, 1, 2, 3, 4, 5, 6 (`SWEEP=1,2,...` to change the list).

Sweep on 2026-10-08 after pass 3 (same data), with the game-mode effect, standard guard and chains above:

| weight | litmus met | missed |
|---|---|---|
| 0.5 | 8/9 | Mercurial Magnum |
| 1 | 8/9 | Mercurial Magnum |
| 2 | 8/9 | Mercurial Magnum |
| 3 | 8/9 | Mercurial Magnum |
| 4 | 8/9 | Mercurial Magnum |
| 5 | 9/9 | none |
| 6 | 7/9 | Ricochet, Indomitable |

Chosen: 5, the only weight that meets all nine. It is a narrow window: Magnum's term is +0.3 pts (Street Brawl +0.9 on Infernus, +0.6 on every other hero), and Indomitable's is the same +0.3 pts, so the data alone barely tells them apart. At 6 Indomitable comes back and Ricochet drops. Healbane gets a negative brawl term (Street Brawl favours it on every hero more than here) and is in the build on its standard numbers.
