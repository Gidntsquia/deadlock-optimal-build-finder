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
