# Tier list rule

Data: `public/data/hero-stats.json`, written by `npm run fetch-data` (or `node scripts/fetch-data.mjs --hero-stats-only`,
a few seconds). One row per hero: `wins` and `matches` from `api.deadlock-api.com/v1/analytics/hero-stats` with
`min_average_badge=90` (Phantom and above) since the latest patch (`PATCH_NAME` / `PATCH_SINCE` in
`scripts/fetch-data.mjs`, now 09-29-2026 from 20:00 UTC; bump both when a new patch lands, titles at
`api.deadlock-api.com/v1/patches`). Older games are left out so the lists show the game as it plays now.

Rule (`src/tiers.ts`): win rate = wins / matches x 100. Tier by win rate:

| Tier | Win rate |
| ---- | -------- |
| S+ Top pick | 54% or more |
| S Strong | 52% to under 54% |
| A Good | 50% to under 52% |
| B Even | 48% to under 50% |
| C Weak | 46% to under 48% |
| D Struggling | under 46% |

Why fixed 2-point bands: the pool averages 50% by construction, so a fixed band reads the same from one
snapshot to the next; S+ is kept for clear outliers (2 of 38 heroes on 2026-09-19). Empty tiers are not shown.
Inside a tier, heroes are ordered by win rate, best first. No numbers are shown on the page; this file and the
"How tiers are set" note on the page are where the cut-offs live.
The browser tour recomputes the tiers from the snapshot with this table and compares them to the page.

## Item and corrupted item lists

The same page has a Heroes / Items / Corrupted Items switch (`?list=items`, `?list=corrupted`).
Data: `public/data/item-stats.json`, written with `hero-stats.json` (same flags). Rows are wins and matches per item over
every hero from `/v1/analytics/item-stats`:

- `items`: normal copies (`corrupted_items=exclude`), Phantom and above, since the latest patch.
- `corrupted`: corrupted copies (`corrupted_items=only`), all ranks, games of 30 minutes or more, since corrupted items
  came out (29 Sep 2026). Phantom+ alone had only 20 to 260 games per corrupted item on 2026-10-01, too few to rank.

Rule (`buildItemTierRows` in `src/tiers.ts`): shop items with 300 games or more are listed. Pricier items are bought
later, in games that are often already being won, so raw item win rate mostly sorts by price (every 6400 item would
be S). Each item is instead compared with its price group: edge = item win rate minus the pooled win rate (all wins /
all games) of the listed items at the same cost.

Edge alone still favours rarely bought items: on 2026-10-01 Frenzy (8k games) and Lucky Shot (12k) topped the list
at +6 to +7, because a rare 6400 item is mostly a sixth or seventh big buy by a player already far ahead. Comparing
only buys at the same game minute or the same net worth (`bucket=game_time_min` / `net_worth_by_5000`) did not change
that order, so rarity is discounted directly: score = edge x games / (games + typical), where typical is the median
games of the listed items at that price. An item bought as often as the typical one keeps half its edge; one bought a
quarter as often keeps a fifth. The item sheet shows the edge ("Difference"), the typical games and the score
("Difference that counts").

Scores spread about half as wide as hero win rates, so item bands are 1 point wide (the hero table applied to
50 + 2 x score):

| Tier | Score |
| ---- | ----- |
| S+ Top pick | +2 or more |
| S Strong | +1 to +2 |
| A Good | 0 to +1 |
| B Even | -1 to 0 |
| C Weak | -2 to -1 |
| D Struggling | under -2 |

Best score first inside a tier. The browser tour recomputes these tiers from the snapshot and compares them to the page.
