# Tier list rule

Data: `public/data/hero-stats.json`, written by `npm run fetch-data` (or `node scripts/fetch-data.mjs --hero-stats-only`,
a few seconds). One row per hero: `wins` and `matches` from `api.deadlock-api.com/v1/analytics/hero-stats` with
`min_average_badge=90` (Phantom and above) over the snapshot's 30-day window.

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

- `items`: normal copies (`corrupted_items=exclude`), Phantom and above, the snapshot's 30-day window.
- `corrupted`: corrupted copies (`corrupted_items=only`), all ranks, games of 30 minutes or more, since corrupted items
  came out (29 Sep 2026). Phantom+ alone had only 20 to 260 games per corrupted item on 2026-10-01, too few to rank.

Rule (`buildItemTierRows` in `src/tiers.ts`): shop items with 300 games or more are listed. Pricier items are bought
later, in games that are often already being won, so raw item win rate mostly sorts by price (every 6400 item would
be S). Each item is instead compared with its price group: edge = item win rate minus the pooled win rate (all wins /
all games) of the listed items at the same cost. The tier is the hero table above applied to 50 + edge, so S+ is
+4 points or more, S +2 to +4, A 0 to +2, B -2 to 0, C -4 to -2, D below -4. Best edge first inside a tier.
The browser tour recomputes these tiers from the snapshot and compares them to the page.
