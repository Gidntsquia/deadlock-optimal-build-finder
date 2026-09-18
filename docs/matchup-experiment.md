# Matchup-aware builds — experiment findings (2026-09-18)

Implements plans/matchup-builds.md: a hard-coded, opt-in enemy-counter scoring term
(`PARAMS.weights.matchup`, default 0, no UI). This doc is step 5 (evaluation).

## What was built

1. `scripts/fetch-data.mjs --matchups "<heroId>:<e1,e2,...>;..."` — opt-in fetch, separate from the
   normal snapshot fetch. Widens badge>=70/30d → all-ranks/30d → all-ranks/60d (clamped to a
   conservative 90-day floor; see `MATCHUP_LAST_PATCH_TS` comment — this repo has no real
   "last patch date" feed, so it's a placeholder, not a verified patch date) whenever fewer than 60
   items have >=500 matches against every enemy. Writes
   `public/data/analytics/matchups/<heroId>-badge70.json`, `-allranks.json`, (`-allranks60d.json` if
   needed), and the chosen rung as `<heroId>.json`.
2. `MatchupStats`/`SlimStat` types in `src/types.ts`; `GeneratorInput.matchup?: { enemies, stats }` in
   `src/generator/build.ts`.
3. `PARAMS.weights.matchup = 0` (default) and `MIN_VS_MATCHES = 300` in `src/generator/stats.ts`.
   Scoring term ported from `../deadlock-street-brawl-helper` (`shrink`, per-enemy `liftVs - liftAll`,
   `MIN_VS_MATCHES` cutoff) into `src/generator/build.ts`'s per-item scoring block, using this
   generator's own `pop`/`K` conventions instead of Brawl's within-tier normalisation. Items below the
   `minUsage` floor are let back into the candidate set when their matchup lift is positive and they
   clear `MIN_VS_MATCHES` for at least one enemy (Healbane-style low-usage counters).
   Reason string: `"wins more against enemy hero <ids>"` — the generator only has one hero's data
   (no full hero catalog in `GeneratorInput`), so it can't render enemy names itself;
   `scripts/matchup-experiment.ts` maps ids to names for display.
4. `scripts/matchup-experiment.ts` (`npm run matchup-experiment`): 4 hard-coded scenarios x weights
   `[0.25, 0.5, 1]` x populations `{badge>=70, all-ranks}`, printing baseline vs matchup-scored build,
   item swaps with per-enemy sample sizes, and a usage-weighted mean matchup-conditioned win rate.

## Guard checks

- `npx tsc -b` — clean.
- `npm run lint` (oxlint) — clean.
- `npm run verify` — all PASS, before and after this change, **byte-identical**: same median/mean
  panel agreement (74% / 73.5%) and per-hero numbers, since `generateBuilds`/`generateBuild` are
  called without a `matchup` input anywhere in the app/verify path and the weight defaults to 0.

## Data fetched for the experiment

Scoped to 2 heroes (Abrams id 6, Sinclair id 60) and their scenario enemies only — not the full
38x37 grid. `node scripts/fetch-data.mjs --matchups "6:20,12,50;6:3,17,14;6:31,35,10;60:3,17,20"`
(~46 requests, ~20s). Both heroes needed the **all-ranks** rung: badge>=70/30d had only 66-81 items
with >=500 matches per enemy pairing, short of the widening threshold in some cases; all-ranks
cleared it, so `--allranks60d` was never needed for these two heroes.

## Scenarios and results

| scenario | expected counter | swap found? |
| --- | --- | --- |
| Abrams vs heavy healing (Ivy, Kelvin, Pocket) | anti-heal (Healbane) | **no** — identical build at all weights, both populations |
| Abrams vs all-gun (Vindicta, Grey Talon, Holliday) | bullet resist | **no** — identical build at all weights, both populations |
| Abrams vs all-spirit (Lash, Viscous, Paradox) | spirit resist | **no** — identical build at all weights, both populations |
| Sinclair (low-pick) vs mixed team | none specific (sanity check for thin data) | one swap (Arcane Surge in, Mystic Slow out) at every weight and population; usage-weighted win rate barely moves (-0.0 to -0.1pp) |

Full run: `npm run matchup-experiment`.

## Sanity verdict

**Fails the sanity check as currently tuned: the swaps do not match known counters.** For the three
Abrams scenarios that were built specifically to have an obvious expected answer, the term produces
*zero* item swaps at any of the tried weights (0.25 / 0.5 / 1), in both the badge>=70 and all-ranks
populations. The only scenario that swapped anything (Sinclair) picked the same item regardless of
which of 3 very different enemy compositions was passed in, which is a sign the swap is not driven by
the enemies at all — likely `Arcane Surge` simply scores better than `Mystic Slow` under Sinclair's
*baseline* winLift/popularity terms once it clears `MIN_VS_MATCHES` and is let back into the
candidate pool by the "positive matchup lift" widen, not because it counters those specific enemies.

Per plan step 5: **stop here, do not do the time-split validation.** Root cause, found by hand-computing
Healbane's numbers from `public/data/analytics/matchups/6-allranks.json` (not just reading the
experiment script's build diff):

- Also checked directly: `Bullet Armor` and `Spirit Armor` have **no row at all** in Abrams's
  `item-stats` (all-ranks, 30d). Checked `public/data/items.json`: both are `disabled: true` in the
  current snapshot (superseded/renamed items from an older patch), so they never appear in live
  match data at all — this is expected, not a fetch bug, but it does mean two of the three
  "obvious expected counters" for the bullet/spirit scenarios were never real test cases with this
  item catalog. The scenario would need updating to whatever the current bullet/spirit-resist items
  are named before it says anything about those matchups.
- Healbane does have data, and the sign is right: mean `(liftVs - liftAll) * 10` over Ivy/Kelvin/Pocket
  is **+0.097** (0.088, 0.104, 0.100 per enemy) — Healbane really does win a bit more against those
  three heroes than its baseline rate. But this is far below the `> 0.1` reason threshold and, more
  importantly, tiny next to the scale of the other terms: `WEIGHTS.popularity * sqrt(pop)` alone
  ranges roughly 0-3, so even at `matchup` weight 1 this lift (0.097) cannot move Healbane past
  Abrams's existing top-16.
- The reason the lift is so small: **`K` (the Bayesian shrinkage prior) is derived from `maxMatches`
  of the *entire* wide population**, which for a heavily-played hero like Abrams is ~407k matches, so
  `K = max(200, 0.2 * 407k) ≈ 81,400`. Compared to that prior weight, a per-enemy vs-row of even
  10,000-17,000 matches (Healbane vs Ivy/Kelvin/Pocket, well above `MIN_VS_MATCHES=300`) is still
  swamped — `shrink()` pulls almost all the way back to the population mean regardless of how lopsided
  the enemy-specific win rate actually is. This is a scaling bug carried over from
  `deadlock-street-brawl-helper`, where `K` is computed the same way but Brawl's populations (free
  draft, one hero at a time within a much smaller item pool) never reach hundreds of thousands of
  matches for one item, so the same formula doesn't crush the signal there.
- The Sinclair swap (Arcane Surge in, Mystic Slow out, identical for all 3 very different enemy
  rosters) is consistent with this: the per-item matchup lift is small everywhere, so the "let a
  low-usage item back into the candidate pool" rule is really just responding to a small positive
  lift number that happens to be similar regardless of the specific enemies, not to those enemies
  in particular.

**Recommended weight: 0 (no change).** The plumbing (fetch, types, scoring term, no-op guarantee) is
in place and verified, but the term as specified does not produce recognizable counter-picks — not
because counters aren't in the data (Healbane's sign is correct), but because `K` scaled off the
*whole-population* max matches crushes the signal for popular heroes, and some expected counter items
(Bullet Armor, Spirit Armor on Abrams) have no item-stats row at all in this window. Before trying a
non-zero weight again: (1) confirm whether Bullet/Spirit Armor genuinely have no analytics rows for
Abrams or whether the wrong class name/id was used, and (2) rescale `K` for the matchup term
independently of the wide population's absolute size (e.g. cap it, or base it on the per-enemy vs-row
population instead of the hero's all-time max), since reusing the exact Brawl formula does not
transfer to this generator's much larger match counts.
