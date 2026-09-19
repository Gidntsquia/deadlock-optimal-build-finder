# UI Design Notes

**Current design: the 2026-09-19 in-game redesign (next section). User verdict: see "User verdict"
below.** Sections after it describe the earlier rounds; their token scales and lint rules still
apply, their layout notes (top bar, side column, tabs, disclosure panels) do not.

## In-game redesign (2026-09-19)

Reference: `docs/ui/reference/in-game-build.png`. The main screen is the in-game build window and
nothing else.

- Desktop (>=900px): hero portrait and name on the left (one button, opens the hero dialog), teal
  frame on the right filling the viewport. Frame head: `Hero - Build name`, build pills, then
  Share and Details on the right. Parchment board: Early / Mid / Late Game rows with dark title
  bars, then a navy Ability Order row. No top bar, footer, side column or tabs.
- Tiles: full-bleed item art, slot-coloured name plate, slot-coloured corner flag with the tier
  numeral, ACTIVE tag on actives. No order numbers, no check badges.
- Fit: `--tile: clamp(72px, min(5.5vw, 9.2vh), 112px)`. Worst case in the data (14 items in one
  phase, 22 total) wraps to four tile rows and still fits 1440x900 with no scrolling.
- Phone: same frame in one column, hero avatar in the frame head, Share and Details at the bottom
  right of the frame. Dialogs are bottom sheets.
- Hero dialog: search box (type, Enter picks the first match, arrows move) over a portrait grid.
- Ability order: the in-game "Ability Point Order" grid (`docs/ui/reference/ability-order.png`).
  One banded row per ability, dark glyph on a cream icon chip at the left, one column per point
  spent. A dark chip sits in the ability's row at the column of each point: purple bolt = unlock,
  diamond + 1, 2, 5 = the three upgrades (in-game point costs). The only digits are 1/2/5. Each
  row and marker has an aria-label. Phone: same grid, columns shrink to fit, no sideways scroll.
  The share PNG draws the same grid.
- Hero cue: the hero control is always marked. Desktop: a teal "Change Hero" pill with a swap icon
  under the portrait name. Phone: a round swap-arrows badge on the avatar corner. Both are visible
  at rest, no hover needed; still one button named "<Hero>, change hero".
- Item sheet: art, slot, tier, cost, stats, passive/active text. No ranking text.
- Details (the single quiet control, closed by default): tagline, match count, rank floor, data
  window and date, soul totals, agreement with top players and the player table, method note,
  ability-order support, per-item table (buy order, cost, pick rate, win rate, score, core),
  deadlock-api.com credit and README link. Anything numeric or methodological goes here.
- Share PNG (`src/export/png.ts`) draws the same frame, rows, tiles and ability row. It draws
  no numbers.
- New tokens: `--weapon-plate`, `--vitality-plate`, `--spirit-plate`, `--row-head`,
  `--row-head-ink`, `--row-body`, `--pill`, `--frame-edge`. The old background gradient is gone.
- Before/after: `docs/ui/before/` is the UI as it stood before this redesign; `docs/ui/after/`
  has the same 8 names plus `details-desktop.png` and `details-phone.png`.

### User verdict

Round-4 eval, user's words: "The ability upgrade order has regressed; it should look like this
[reference/ability-order.png]. Also, it's not immediately obvious that you can click on the hero
image to change which hero you have selected-- make that more intuitive." Mobile: "Works".
Superfluous / AI-made: "Works". Overall: "Its good, but not quite there yet."

Round 5 (grid + hero cue): user's verdict on the new shots is pending; run the evaluator.

## Sources read

1. https://dev.to/kiwibreaksme/why-ai-generated-uis-look-off-and-the-one-principle-that-fixes-it-4j20
   — "The tell: parts that don't agree." Mixed corner radii, shadows, accent colors, spacing
   units, icon styles, type scales, motion durations, and control heights each read as "two
   products glued together" (sharp dialog + rounded buttons) or "a scene with two suns"
   (mismatched shadow light source). Fix: pick exactly one value per axis, encode it as a
   token, apply it everywhere; treat a mismatch as a lint error, not a stylistic choice.
2. https://smoothui.dev/blog/ai-design-slop
   — names purple-to-cyan gradients, glassmorphism-with-neon-glow, identical icon+heading+2-line
   card grids, default hover-bounce animation, and missing functional states (no focus ring,
   failing contrast, no empty/error state) as the giveaways.
3. https://medium.com/@cssamithpitigala/why-ai-generated-ui-looks-good-but-often-feels-generic-020a9b1b8492
   — AI defaults converge on the statistical mean of its training UIs: rounded corners, soft
   drop shadows, an Inter/Poppins/DM-Sans-family sans-serif, a light background with a pastel
   accent, and no visual point of view; the fix is a named, specific style reference instead of
   "clean and modern."

## Token tables

### Type

| Token | Value | Where |
|---|---|---|
| `--font-sans` | `Nunito, "Segoe UI", system-ui, -apple-system, sans-serif` | `@theme inline`, `src/index.css` — the single font family for the whole app (no default Inter/system stack) |
| body text | 14px | `.stat-line`, `.tt-section p` |
| section heads | 13–14px, weight 700–900 | `.phase-head`, `.tt-section h3` |
| board/sheet H2 | 20px | `.sheet-head h2`, `.board-head h2` |

### Spacing

| Token | Value | Where |
|---|---|---|
| grid | 0, 1px, 2px (hairline gaps only), or a multiple of 4px | every `padding`/`margin`/`gap`/`inset` value in `src/index.css` outside the token block — enforced by `scripts/ui-lint.mjs` |

### Radius

| Token | Value | Where |
|---|---|---|
| `--radius-sm` | 4px | small controls (chips, ap-track pips) |
| `--radius` / `--radius-md` | 8px | cards, tiles, buttons, dialog corners — the dominant radius |
| `50%` | avatars/dots only | hero portraits, legend dot — the one deliberate exception, reserved for circular things |
| `--radius-full` (9999px, pill) | style tabs, chips | one pill radius, used only for tab/chip shapes, never mixed with 8px on the same element family |

One radius vocabulary: 4px (small controls) / 8px (cards, the default) / 9999px pill (tabs,
chips) / 50% (circular avatars). `scripts/ui-lint.mjs` scans both `src/**/*.tsx` and
`src/index.css` and fails the build on any `border-radius` value outside this set (outside the
`:root`/`@theme inline` token block, where the scale itself is defined).

### Colour

| Token | Value | Role |
|---|---|---|
| `--room` | `#0e1a19` | page background (dark teal room) |
| `--board` | `#cbbd9f` | parchment build-board surface |
| `--board-head` | `#b7a986` | darker parchment header strip |
| `--ink` / `--ink-soft` | `#2b241a` / `#463c26` | primary / muted text on parchment |
| `--teal` | `#62b6c8` | one accent color — header bar, active tab, focus ring (`--ring`) |
| `--weapon` / `--vitality` / `--spirit` | `#e6ad5f` / `#a6cf6e` / `#b992e4` | item-slot tints, matching the game's own item categories |
| `--navy` | `#2b3d70` | ability-point board surface |
| `--good` | `#2a7040` (darkened from `#3f9f5c` for contrast, item 7) | core-item badge |

One accent (`--teal`) is used for every "this is selected / this is the primary action"
signal (active hero, active tab, focus ring) — there is no second competing accent color.
Every solid color used outside the `:root`/`@theme inline` token block is a `var(--token)`
reference or a `color-mix(in srgb, var(--token) N%, transparent)` derived tint — there is no
raw hex or `rgb()`/`rgba()` literal left in `src/index.css` outside the token block except
black/white alpha overlays, which `ui-lint.mjs` allows explicitly. `scripts/ui-lint.mjs` fails
the build on any other raw hex/`rgb(a)` colour.

### Shadow

One shadow treatment: a hard, single-direction drop with **zero blur** — `--shadow-hard`
(`0 2px 0 rgba(0,0,0,.25)`, buttons/tiles/chips) and `--shadow-hard-lg` (`0 3px 0
rgba(0,0,0,.45)`, the item sheet and other elevated surfaces), plus `inset` hairline edges on
the ability-point board. No blurred shadow, glassmorphism, or neon glow anywhere.
`scripts/ui-lint.mjs` fails the build on any `box-shadow` with a non-zero blur radius, in either
`src/**/*.tsx` or `src/index.css`.

### Gradients

Exactly one gradient in the whole app: `--bg-vignette`, a `radial-gradient` defined inside the
`:root` token block and referenced only via `var(--bg-vignette)` for the page's background
vignette. `scripts/ui-lint.mjs` fails the build on any `linear-gradient`/`radial-gradient`/
`conic-gradient` found outside a token definition, in either `src/**/*.tsx` or `src/index.css`.

## `ui-lint.mjs` coverage

`scripts/ui-lint.mjs` scans two things:
- `src/**/*.tsx` (excluding vendored `src/components/ui/`) for stock Tailwind palette classes,
  oversized `rounded-*`/`shadow-*` utilities, gradient utility classes, raw hex colors, and
  inline-style colors.
- `src/index.css` itself, outside the `:root`/`@theme inline` token block, for: off-scale
  `border-radius`; off-grid `padding`/`margin`/`gap`/`inset`; any blurred `box-shadow`; any
  `linear-gradient`/`radial-gradient`/`conic-gradient`; and raw hex or `rgb(a)` colors other than
  black/white.

`node scripts/ui-lint.mjs --self-test` plants one known-bad case for each of the rules above (5
tsx rules, 6 CSS rules) and requires every one to be caught by name before it exits 0.

## Tell → source → fix → file

| Tell | Source | What this repo did | File |
|---|---|---|---|
| Mixed corner radii ("two products glued together") | kiwibreaksme | Collapsed all radii to the 4px/8px/9999px/50% vocabulary above; `ui-lint.mjs` fails on any other radius value in `.tsx` or `.css` | `src/index.css` (`@theme inline`), `scripts/ui-lint.mjs` |
| Multiple shadow directions/scales ("two suns") / blurred shadow | kiwibreaksme | One hard, zero-blur drop shadow (`--shadow-hard`/`--shadow-hard-lg`) reused everywhere; the one previously-blurred shadow on the item sheet was replaced; `ui-lint.mjs` fails on any non-zero blur radius | `src/index.css` (`--shadow-hard*`, `.btn`, `.tile`, `.sheet`), `scripts/ui-lint.mjs` |
| No single accent color | kiwibreaksme | `--teal` is the only color used for selection/active/focus state across hero picker, style tabs, and focus ring | `src/index.css` (`--teal`, `--ring`), `src/components/HeroPicker.tsx`, `src/components/ui/tabs.tsx` |
| Off-grid spacing (5px/6px/7px/10px/14px/18px) | kiwibreaksme | Every padding/margin/gap value normalized to 0/1/2/a-multiple-of-4; `ui-lint.mjs` fails on any exception | `src/index.css`, `scripts/ui-lint.mjs` |
| Default Inter/Poppins/system sans with no point of view | Medium (cssamithpitigala) | Single custom `Nunito` webfont loaded via `@font-face`, matching the in-game shop's own type, instead of the system-UI default | `src/index.css` (`@font-face`, `--font-sans`) |
| Purple-to-cyan gradient / glassmorphism-with-glow | smoothui.dev | Exactly one gradient in the whole app, defined as a named token and referenced only via `var()`; no other gradients or glow effects | `src/index.css` (`--bg-vignette`), `scripts/ui-lint.mjs` |
| Missing functional states: no focus ring, failing contrast, no empty/error state | smoothui.dev | Visible focus outline distinct from resting state on every interactive tile (item 5); axe scan added at 2 sizes × sheet open/closed reporting 0 serious/critical violations, which required darkening `--ink-soft`, `--good`, and the item-sheet section-heading purple to clear 4.5:1 contrast; explicit error/retry UI already covers the analytics-fetch-failure state | `src/index.css` (`--ink-soft`, `--good`, `.tt-section h3`), `scripts/browser-check.mjs` (axe checks), `src/components/BuildView.tsx` (error/retry) |
| Identical icon+heading+2-line card grids (generic sameness) | smoothui.dev | Board tiles carry per-item art, buy-order numbers, and slot-color tint rather than a uniform icon+label card; the hero grid uses real hero portraits, not placeholder icons | `src/components/ItemTile.tsx`, `src/components/HeroPicker.tsx` |
| Broken layout that looks "assembled by an AI that never opened a real browser" (item dialog half off-screen on phone, off-centre with its top cut off on desktop) | this round's own eval | Fixed: the dialog's phone-only `translate` reset now survives production minification because it is a Tailwind utility class (`max-[899px]:translate-none`) instead of a raw CSS `translate: 0` (which lightningcss's minifier drops as a no-op); verified by `getBoundingClientRect()` checks at 390px and 1440px, before and after navigating between items | `src/components/ItemCard.tsx`, `scripts/browser-check.mjs` |
| A stated behavior ("the old build dims while the next loads") that was never actually wired up | this round's own eval | `App.tsx`'s stale-board class string had a missing space (`fadestale`, not `fade stale`) so `.board-wrap.stale`'s dimming CSS never matched; rebuilt the class list so it can't silently collapse, and added a browser check that polls computed `opacity` (not just the class name) during a delayed analytics response | `src/App.tsx`, `scripts/browser-check.mjs` |

## Before / after

`docs/ui/before/*.png` and `docs/ui/after/*.png` hold the same 8 named views
(hero-picker, infernus-build, item-sheet, warden-styles × desktop/phone). The after set was
re-shot after this round's items 1–3, so it reflects the current code, not the round-1 baseline.
Visible differences from `before`: a real hero-search box above the picker grid,
capped/centered desktop content width, plain-language date and "match" wording, skeleton-shaped
loading state, the item sheet rebuilt as a focus-trapped dialog with a visible focus ring, and
the contrast/ARIA fixes from round 1 — plus, new this round, the item detail sheet actually sits
on screen (bottom sheet on phone, centred with its top visible on desktop; it did not before) and
the previous build visibly dims during a hero switch (it did not before). The shop palette (teal
room, parchment board, navy ability panel, slot-tinted tiles) is unchanged and still recognisable
in every after shot.

## Approval

**Approved by the user, 2026-09-18**, after being shown all 8 files in `docs/ui/after/`:
`hero-picker-desktop.png`, `hero-picker-phone.png`, `infernus-build-desktop.png`,
`infernus-build-phone.png`, `item-sheet-desktop.png`, `item-sheet-phone.png`,
`warden-styles-desktop.png`, `warden-styles-phone.png`. The phone item sheet
(`item-sheet-phone.png`) was broken (off-screen) in the version approved in round 1 — the user
was told this explicitly before approving — and now renders as a bottom sheet, full width,
flush to the bottom, with the item name and stats legible. Known leftover the user flagged,
out of this round's scope: the "Ranking details" focus ring draws as a large white box across
the item sheet in both item-sheet shots.
