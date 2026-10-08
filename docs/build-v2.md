# Build v2 (Infernus)

A second way to make a build. Written for any hero; `src/generator/pipeline.ts` switches it on for Infernus only (`V2_HEROES`). The other 37 heroes go through the old generator, and their builds are byte-identical to before (checked by diffing every hero's items, order, reasons and ability order against the last commit before v2).

Try it: `npm run generate 1 --v2 --explain` prints, for every candidate item, the standard lift, the Street Brawl lift and the rule that denied it. Refresh the data with `npm run fetch-data -- --v2-only` (about 2 minutes).

## Data

Everything v2 reads comes from games at or after the latest patch: `PATCH_NAME` 09-29-2026, unix `PATCH_SINCE` 1790712000 (`scripts/fetch-v2.mjs`). Every block in `public/data/v2/` carries `min_unix_timestamp`, and `npm run verify` fails if one does not match. Standard data is Phantom and above. Street Brawl data is all ranks, because the API returns an error for a rank filter in that mode.

## Rules in plain words

1. **Base score** is the old generator's: shrunk win rate and how often the item is bought, in standard games.
2. **Street Brawl lift** is how much better the item wins when held in Street Brawl than in standard, for this hero, minus how much better it wins in Street Brawl for every other hero (the game-mode effect). An item has to beat the game-mode effect to count. Win rate when held only; the Street Brawl buy rate is never used.
3. **Lift is denied** (and the rule is shown in Details and in `--explain`) when: there are no Street Brawl games; the item is bought in under 5% of the top item's standard games; its standard win-rate change is negative; its Street Brawl rate is negative; it is a standard-only item (souls, creep and jungle clear, lane sustain); it is bought inside the farm window; there are fewer than 200 games for the game-mode effect; or the hero's lift is not above the game-mode effect.
4. **Role curve.** From the top players' post-patch games, per 5 minutes: farm (creep souls, creep kills) against fight (hero damage, kills and assists), each divided by its own game-long mean. The farm window ends at the first 5-minute bucket after minute 5 where farm share drops under half. With fewer than 20 panel games the curve uses all players and says so.
5. **Role term.** Each item has a category (`docs/item-categories.md`) with a farm fit and a fight fit. Bought in the farm window it is scored by farm fit; later by fight fit.
6. **Colour spike.** Items are summed per colour (weapon, vitality, spirit). The item that takes a colour past 4,800 souls gets a bounded bonus; moving the leading colour toward it gets a small one. The game's own spike table is not in the API (`generic-data`, `items.json` checked), so only 4.8k, the figure given for this feature, is used. The build screen puts a small diamond on the crossing tile and in the share image; the numbers are in Details.
7. **Counters.** Details lists, for the 10 most-played enemies, up to three swaps: items that win more against that hero than overall, with at least 60 games and 1 point of gain, each showing the item it replaces.
8. **Zergggy** (account 35187362): his post-patch games and the items he and the build share, and only one of them has.
9. **Panel agreement** is still shown, labelled "not targeted", and does not fail `verify` for v2 heroes.

## Enhanced cards

Street Brawl rows are keyed by the base item, so enhanced cards cannot be separated from the API. The draft setup offers every card enhanced with the same chance, so no item is excluded for it. The standard-buy gate, the standard-direction gate and the game-mode effect do the filtering. This fallback is recorded in the report notes.

## Parameters (`V2_PARAMS`)

`brawlWeight` 1.5 (score per 10 points of lift), `roleWeight` 1.0, `spikeWeight` 0.35, `spikeMomentum` 0.1, `spikeThresholds` [4800], `minStandardShare` 0.05, `brawlShrinkFrac` 0.2, `modeMinMatches` 200, `swapMinGames` 60, `swapMinLift` 0.01, `swapsPerEnemy` 3.

## Known results

Mercurial Magnum is not in the Infernus build: rule 3, "rarely bought in standard (3% of the top item's games, needs 5%)". Greater Expansion and Mystic Expansion are out for the same rule (1%). Nothing was forced.
