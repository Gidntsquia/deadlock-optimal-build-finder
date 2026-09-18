# UI Design Notes

**User approval: not yet obtained.** This agent cannot show the after-shots to a
human and record a yes/no — that step is blocked pending a person reviewing
`docs/ui/after/*.png` against `docs/ui/before/*.png` and telling the worker/evaluator
"approve" or "revise" with a date. Do not treat this document's existence as approval.

## Sources read

1. https://dev.to/kiwibreaksme/why-ai-generated-uis-look-off-and-the-one-principle-that-fixes-it-4j20
   — "incoherence is the tell": mixed corner radii, shadows, accent colors, spacing units,
   icon styles, type scales, motion durations, and control heights each read as "two products
   glued together." Fix: pick exactly one value per axis, encode it as a token, apply it
   everywhere; treat a mismatch as a lint error, not a stylistic choice.
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
| `--spacing-4px` | 4px base unit | `@theme inline`; padding/gap values throughout are 4/6/8/10/12/14/18/20px — all multiples of the 4px unit, no off-grid values like 7px or 13px |

### Radius

| Token | Value | Where |
|---|---|---|
| `--radius-sm` | 4px | small controls (chips, ap-track pips) |
| `--radius-md` / `--radius` | 8px | cards, tiles, buttons, dialog corners — the dominant radius |
| `50%` | avatars/dots only | hero portraits, legend dot — the one deliberate exception, reserved for circular things |
| `999px` (pill) | style tabs, chips | one pill radius, used only for tab/chip shapes, never mixed with 8px on the same element family |

One radius vocabulary: 4px (small controls) / 8px (cards, the default) / pill (tabs, chips) /
50% (circular avatars). `ui-lint.mjs` fails the build if a component reaches for an arbitrary
radius outside these tokens.

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
| `--good` | `#2a7040` (darkened from `#3f9f5c` for contrast — see below) | core-item badge |

One accent (`--teal`) is used for every "this is selected / this is the primary action"
signal (active hero, active tab, focus ring) — there is no second competing accent color.

### Shadow

One shadow treatment: a hard, single-direction drop with no blur-heavy/glow variants —
`0 2px 0 rgba(0,0,0,.25)` (buttons/tiles) and `0 6px 18px rgba(0,0,0,.45)` (the one elevated
surface, the item sheet backdrop-adjacent dialog). No glassmorphism, no neon glow, no gradient
fills — `ui-lint.mjs` bans raw gradients and off-token colors in `src/**/*.tsx`.

## Tell → source → fix → file

| Tell | Source | What this repo did | File |
|---|---|---|---|
| Mixed corner radii ("two products glued together") | kiwibreaksme | Collapsed all radii to the 4px/8px/pill/50% vocabulary above; `ui-lint.mjs` fails on any other radius value | `src/index.css` (`@theme inline`), `scripts/ui-lint.mjs` |
| Multiple shadow directions/scales ("two suns") | kiwibreaksme | One hard single-direction drop shadow reused for every raised control; no blur-glow shadow anywhere | `src/index.css` (`.btn`, `.share-btn`, `.tile`, `.sheet`) |
| No single accent color | kiwibreaksme | `--teal` is the only color used for selection/active/focus state across hero picker, style tabs, and focus ring | `src/index.css` (`--teal`, `--ring`), `src/components/HeroPicker.tsx`, `src/components/ui/tabs.tsx` |
| Off-grid spacing (7px/13px/19px) | kiwibreaksme | All padding/gap values are multiples of the 4px base unit | `src/index.css` (`--spacing-4px` and usages) |
| Default Inter/Poppins/system sans with no point of view | Medium (cssamithpitigala) | Single custom `Nunito` webfont loaded via `@font-face`, matching the in-game shop's own type, instead of the system-UI default | `src/index.css` (`@font-face`, `--font-sans`) |
| Purple-to-cyan gradient / glassmorphism-with-glow | smoothui.dev | No gradients anywhere in `src/**/*.tsx`; `ui-lint.mjs` greps for and fails on `linear-gradient`/`radial-gradient` and raw hex/inline-style colors | `scripts/ui-lint.mjs`, `src/index.css` |
| Missing functional states: no focus ring, failing contrast, no empty/error state | smoothui.dev | Visible focus outline distinct from resting state on every interactive tile (item 5); axe scan added at 2 sizes × sheet open/closed reporting 0 serious/critical violations, which required darkening `--ink-soft`, `--good`, and the item-sheet section-heading purple to clear 4.5:1 contrast; explicit error/retry UI already covers the analytics-fetch-failure state | `src/index.css` (`--ink-soft`, `--good`, `.tt-section h3`), `scripts/browser-check.mjs` (axe checks), `src/components/BuildView.tsx` (error/retry) |
| Identical icon+heading+2-line card grids (generic sameness) | smoothui.dev | Board tiles carry per-item art, buy-order numbers, and slot-color tint rather than a uniform icon+label card; the hero grid uses real hero portraits, not placeholder icons | `src/components/ItemTile.tsx`, `src/components/HeroPicker.tsx` |

## Before / after

`docs/ui/before/*.png` and `docs/ui/after/*.png` hold the same 8 named views
(hero-picker, infernus-build, item-sheet, warden-styles × desktop/phone). Visible
differences in the after set: a real hero-search box above the picker grid, capped/centered
desktop content width, plain-language date and "match" wording (jargon removed, item 4),
skeleton-shaped loading state and dimmed-not-collapsed board during a hero switch (item 6),
the item sheet rebuilt as a focus-trapped dialog with a visible focus ring (item 5), and the
contrast/ARIA fixes above (item 7). The shop palette (teal room, parchment board, navy
ability panel, slot-tinted tiles) is unchanged and still recognisable in every after shot.
