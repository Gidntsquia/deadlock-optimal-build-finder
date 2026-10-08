# Build v2 (Infernus)

A second way to make a build. Written for any hero; `src/generator/pipeline.ts` switches it on for Infernus only (`V2_HEROES`). The other 37 heroes go through the old generator, and their builds are byte-identical to before (checked by diffing every hero's items, order, reasons and ability order against the last commit before v2).

Try it: `npm run generate 1 --v2 --explain` prints, for every candidate item, the standard lift, the Street Brawl lift and the rule that denied it. Refresh the data with `npm run fetch-data -- --v2-only` (about 2 minutes).

## Data

Everything v2 reads comes from games at or after the latest patch: `PATCH_NAME` 09-29-2026, unix `PATCH_SINCE` 1790712000 (`scripts/fetch-v2.mjs`). Every block in `public/data/v2/` carries `min_unix_timestamp`, and `npm run verify` fails if one does not match. Standard data is Phantom and above. Street Brawl data is all ranks, because the API returns an error for a rank filter in that mode.

## Rules in plain words

1. **Base score** is the old generator's: shrunk win rate and how often the item is bought, in standard games.
2. **Street Brawl term (direct score term).** score = base score (rule 1) + `brawlWeight` x brawl term (in percentage points) + role term. The brawl term is the item's Street Brawl win rate when held, shrunk by its brawl games, relative to the hero's brawl average, minus the game-mode effect (the same item's brawl-minus-standard gap over every other hero). It is a subtraction only: an item below the game-mode effect gets a negative term, not a denial, and a negative game-mode effect is never added back (it counts as 0). Win rate when held only; the Street Brawl buy rate is never used. An item that wins in standard (above average) and has a positive term may enter the candidate set below the old 12% usage floor.
3. **Gates (the term is zeroed, and the rule is shown in Details and in `--explain`)**: no Street Brawl games; bought in under 1% of the top item's standard games; standard win rate more than 2.0 pts below the hero's average (`minStdDelta`); a standard-only item (souls, creep and jungle clear, lane sustain); a spirit-scaling item (only spirit stat lines, e.g. the Expansions) whose standard delta is 0 or below. Removed in this pass: the 5% floor, "standard delta must be >= 0", "must beat the game-mode effect", "bought inside the farm window".
4. **Role curve.** From the top players' post-patch games, per 5 minutes: farm (creep souls, creep kills) and fight (hero damage, kills + assists), each divided by its own game-long mean. The fight window starts at the first 5-minute bucket after minute 5 where fight activity is above 1.0 (its game-long average); the farm window is everything before. Infernus: minute 20 (buckets printed by `npm run verify`: fight 0.44, 0.74, 0.88, 0.93, then 1.26 at 20 min). The rule gives 20, not hand set. The snapshot stores damage and kills+assists as two numbers, so kills and assists are one measure. The brawl term counts in full in the fight window and half (`farmBrawlScale`) in the farm window. With fewer than 20 panel games the curve uses all players and says so.
5. **Support scale (brawl-only guard).** The brawl term is multiplied by `min(1, popRel / supportFull)` where popRel is the item's standard games over the top item's and `supportFull` is 0.03: an item bought in 1% of games gets a third of its brawl say, 3% or more gets all of it. Not a hand list: Greater and Mystic Expansion stay out because their brawl term is negative after the game-mode effect, they are spirit-only items, and they are bought in about 1% of games. The role term (category fit by buy time) is unchanged.
6. **Colour spike.** For each colour (weapon, vitality, spirit) walk the build in buy order: add an item's cost when it is bought and take it away at its sell point (sold-later items count until they are sold, exactly what is held at that moment). The buy where the running total first reaches or passes 4,800 souls (reaching exactly 4,800 counts) is the spike tile and gets a bounded bonus; moving the leading colour toward it gets a small one. The selection step has no order yet, so its bonus uses the chosen items' summed cost, which is the same total before any sale. The game's own spike table is not in the API, so only 4.8k is used. The build screen draws a 2px border plus a soft outer ring in the colour's tint on the crossing tile (and in the share image); the numbers are in Details.
7. **Counters.** Details lists, for the 10 most-played enemies, up to three swaps: items that win more against that hero than overall, with at least 60 games and 1 point of gain, each showing the item it replaces.
8. **Zergggy** (account 35187362): his post-patch games and the items he and the build share, and only one of them has.
9. **Panel agreement** is still shown, labelled "not targeted", and does not fail `verify` for v2 heroes.
10. **Order.** An item is brawl-lifted if it is in the build but not in the build made with `brawlWeight` 0 (same data, same code); a displaced item is the reverse. Greedy from the costliest lifted item down, each lifted item takes the buy-time spot of a displaced item of the same colour and the nearest tier (then nearest cost), at most one tier apart; failing that, of any remaining displaced item at most one tier apart (nearest cost); failing that it goes before the first item of its own phase that costs more, else at the end of that phase. Every other item keeps average-buy-time order. Sell points are then recomputed with the old rule (sell the earliest sell-later item when a purchase would pass 12 held; never an item a later item upgrades from), then phases, running totals and the spike. The one-tier limit is the worker's addition: without it a 6,400-soul T4 landed where a T1 is bought at 8 minutes. `npm run generate 1 -- --v2 --explain` and `npm run verify` print the lifted/displaced sets and where each item went.

## Enhanced cards

Street Brawl rows are keyed by the base item, so enhanced cards cannot be separated from the API. The draft setup offers every card enhanced with the same chance, so no item is excluded for it. The standard-buy gate, the standard-direction gate and the game-mode effect do the filtering. This fallback is recorded in the report notes.

## Parameters (`V2_PARAMS`)

`brawlWeight` 2 (score per percentage point of brawl term), `roleWeight` 1.0, `spikeWeight` 0.35, `spikeMomentum` 0.1, `spikeThresholds` [4800], `minStandardShare` 0.01, `minStdDelta` -0.02, `supportFull` 0.03, `farmBrawlScale` 0.5, `brawlShrinkFrac` 0.2, `modeMinMatches` 200, `swapMinGames` 60, `swapMinLift` 0.01, `swapsPerEnemy` 3.

## Litmus items and the weight sweep

The user fixed these for Infernus: Mercurial Magnum, Titanic Magazine, Healbane, Mystic Vulnerability and Escalating Exposure in; Greater Expansion and Mystic Expansion out (`src/generator/v2/litmus.ts`). `npm run verify` checks them (a miss fails) and prints the deciding rule per item. `npm run generate 1 -- --v2 --sweep` runs weights 0.5, 1, 1.5, 2, 3, 4.

Sweep on 2026-10-08 (data refreshed that day), `supportFull` 0.03:

| weight | litmus met | missed |
|---|---|---|
| 0.5 | 6/7 | Mercurial Magnum |
| 1 | 6/7 | Mercurial Magnum |
| 1.5 | 6/7 | Mercurial Magnum |
| 2 | 7/7 | none |
| 3 | 7/7 | none |
| 4 | 7/7 | none |

Chosen: 2, the lowest weight that meets all seven. Magnum is bought in only 3% of games and its brawl term is small (+0.4 pts), so it needs the 12% usage floor lifted for items that win in standard and have a positive brawl term (`admit` hook; v2 only), a support scale that gives a 3% item its full say (`supportFull` 0.03, first tried 0.20: no weight reached Magnum), and a weight of 2. Without the "never add a negative game-mode effect" clamp, weight 4 was needed and the build filled with 1-4% items (Silencer, Ethereal Shift...). Healbane gets a negative brawl term (Street Brawl favours it on every hero more than it favours it here) and is in the build on its standard numbers.
