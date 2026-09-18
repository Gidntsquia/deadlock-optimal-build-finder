# Matchup-aware builds — experiment findings (2026-09-18, updated after K-scaling fix)

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

## K-scaling bug found and fixed

The first pass of this experiment computed `Kvs` (the shrinkage prior used for the per-enemy
`liftVs`) from the *entire wide population's* max item-matches — for Abrams, one item alone had
~407k matches, giving `Kvs ≈ 81,400`. That prior is enormous next to a per-enemy vs-row (a few
thousand to tens of thousands of matches), so `shrink()` pulled almost every `liftVs` back to the
population mean regardless of the true enemy-specific win rate, and `liftVs - liftAll` came out
near zero for everything. Root cause: `Kvs` was reusing the same scale as `KAll` (whole population),
but `liftVs` and `liftAll` are shrinking arrays of very different match-count magnitudes and each
needs its own prior scaled to its own array's max matches.

Fix (`src/generator/build.ts`): `Kvs` is now computed per enemy, from the max matches within that
enemy's own `vs` rows (`KvsByEnemy`), while `KAll` (unchanged) still comes from the wide
population's `all` rows. `npx tsc -b`, `npm run lint`, and `npm run verify` all pass after the fix,
and `npm run verify` is still byte-identical to the pre-matchup-work baseline (weight 0 is still a
strict no-op).

Hand-checked Healbane vs Abrams's healing-team scenario (Ivy/Kelvin/Pocket) after the fix: lift per
enemy went from ~0 (pre-fix, swamped by the shared K) to +0.088 / -0.020 / +0.089-ish per-enemy diffs
that no longer collapse to zero, landing at a mean lift of **0.0355** — small, correctly signed, but
still far below the old `> 0.1` reason-string threshold. Scanning *all* of Abrams's items for this
scenario after the fix, the highest lift in the whole item pool is **0.045** (`Compress Cooldown`),
i.e. even the single best-matching item for this matchup produces a lift about half the size of the
reason threshold — this isn't a threshold-tuning problem, the maximum achievable signal at realistic
weights is just small.

## Sanity verdict (re-run after the fix)

**Still fails the sanity check, for a different reason than before.** With `Kvs` fixed, the term is
no longer numerically broken — lifts are real, correctly signed in spot checks, and do move rankings
at high enough weight. But at the plan's intended weights (0.25 / 0.5 / 1) the signal is too small to
change any of the 4 scenarios' builds at all (confirmed: zero swaps, both populations, all 3
weights). Pushing the weight far past the intended range (tested 3 / 6 / 10, for diagnosis only, not
a recommendation) does eventually produce swaps, but they don't look like counters:
`Battle Vest`/`Extra Stamina`/`Counterspell`/`Arcane Surge` show up as "wins" across multiple
*different* enemy rosters (heavy-healing, all-gun, all-spirit) for the same hero, which is the
signature of generic noise (these items are just slightly above their own baseline win rate against
almost anyone) rather than an enemy-specific counter — never once did the fixed term surface
Healbane, a bullet/spirit-resist item, or anything scenario-specific, even at 10x the intended weight.

`Bullet Armor` and `Spirit Armor` still have no `item-stats` row at all for Abrams (checked
`public/data/items.json`: both `disabled: true`, superseded/renamed items from an older patch), so
the bullet/spirit scenarios were never real test cases for the two items whose swap would have been
the clearest sanity signal. That gap is unrelated to the `K` fix and still open.

**Recommended weight: 0 (no change).** The plumbing (fetch, types, scoring term, no-op guarantee)
and the `K` scaling are both now correct, but the resulting signal is too weak at any weight in the
plan's intended range to produce recognizable counter-picks, and even well outside that range the
swaps it does produce don't track the specific enemies passed in. Two independent things would need
to improve before trying a non-zero weight again: (1) a larger real counter effect would need to
exist in the underlying win-rate data than `liftVs - liftAll` is currently finding — this may be a
property of the game (a well-designed item's raw win-rate edge against a specific hero composition
may just be a few points, most of which selection bias already explains), not a further scoring bug;
and (2) `Bullet Armor`/`Spirit Armor` need current, non-disabled equivalents in the item catalog
before the two "obvious counter" scenarios can be evaluated at all.

## Follow-up: tested the live resist items directly (not the disabled ones)

To rule out "the disabled Bullet/Spirit Armor items are hiding a real signal", re-ran the lift
calculation by hand for the current, non-disabled equivalents — `Bullet Resilience` and
`Spirit Resilience` (tier 3 vitality items) — against the exact gun-team and spirit-team scenarios:

| item | scenario | lift | expected sign | raw per-enemy win rate |
| --- | --- | --- | --- | --- |
| Bullet Resilience | vs all-gun (Vindicta/Grey Talon/Holliday) | **+0.043** | positive | 47.0% / 49.8% / 51.9% |
| Spirit Resilience | vs all-spirit (Lash/Viscous/Paradox) | **-0.018** | positive | 50.4% / 52.8% / 54.3% |
| Bullet Resist Shredder | vs all-gun | -0.013 | positive | — |
| Bullet Resist Shredder | vs all-spirit | +0.007 | negative | — |

Bullet Resilience gets the right sign (barely) against the scenario it was picked for, but it's the
largest lift found across two full scenario sweeps and it's still under 0.05. Spirit Resilience and
Bullet Resist Shredder get the *wrong* sign against the scenario they should counter. The raw
per-enemy win rates for Bullet Resilience vs. three different "gun" heroes (47.0% / 49.8% / 51.9%)
also disagree with each other more than they agree with a shared "counters guns" story.

**This rules out the disabled-item gap as the explanation.** The K-scaling fix was real and
necessary, but the residual problem is the underlying signal, not remaining plumbing: item pick vs.
enemy-composition win-rate deltas in this data are the same size as, or smaller than, the noise from
who buys what (skill/MMR correlation, patch drift, matchup correlation with matchmaking), even for
the textbook case of a resist item against its matching damage type. Fixing this would need either
much more per-hero×enemy match volume than a single 30-day snapshot provides, or an estimator that
controls for player skill directly (not available from this API — no per-match MMR/badge field to
condition on), not further tuning of `K`, `MIN_VS_MATCHES`, or population width.
