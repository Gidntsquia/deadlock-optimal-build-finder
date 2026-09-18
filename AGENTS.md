# AGENTS.md

Static React app that generates Deadlock hero builds in the browser from a local data snapshot. No backend.

## Stack
- React 19, TypeScript 6, Vite 8, npm (not Bun). Node 18+ (dev box runs 24).
- Lint: oxlint (`npm run lint`). `npm run ui-lint` bans stock Tailwind palette classes, off-token
  colors, raw gradients, and oversized radii/shadows in `src/**/*.tsx` (excludes `src/components/ui/`),
  and also scans `src/index.css` itself for off-scale `border-radius` (must be 4px/8px/9999px/50%),
  off-grid spacing (0/1/2/multiples-of-4), any blurred `box-shadow`, raw gradients, and raw
  hex/rgb(a) colors outside the `:root`/`@theme inline` token block. Violations are reported as
  `file:line: rule — snippet`. `node scripts/ui-lint.mjs --self-test` plants one known-bad case per
  rule (tsx + each CSS rule) and must report all of them caught.
- Browser checks: Playwright, `npm run verify:browser` (builds first, then serves `dist/` on
  :4173 and runs `scripts/browser-check.mjs` — port 4173 must be free; run in the foreground
  and let it finish, don't background it). Set `SHOT_DIR=docs/ui/after` (or any dir) to control
  where the check's screenshots land; default is `screenshots/` (gitignored).
  Includes an `@axe-core/playwright` scan at desktop/phone × item-sheet open/closed — must
  report 0 serious/critical violations.
  Logic checks: `npm run verify`. Typecheck: `npx tsc -b`. Format: `npx prettier --check/--write`.
- UI: Tailwind v4 (`@tailwindcss/vite`) + shadcn/ui, vendored under `src/components/ui/`
  (Dialog, Tabs, Collapsible, Command, Button, Tooltip, Sonner toasts, Skeleton), themed to the
  in-game shop palette via CSS custom properties in `src/index.css` (`@theme inline` maps them
  onto the shadcn/Radix contract instead of stock neutral/indigo). Design tokens and the
  tell→fix table are in `docs/ui/DESIGN.md`.
- Deployed to GitHub Pages under `/deadlock-optimal-build-finder/` (`BASE_PATH` env at build time). Always build
  asset URLs through `img()` / `import.meta.env.BASE_URL`.

## Layout
- `src/generator/`, `src/validation/` — build scoring and panel validation. UI work must not change them.
- `src/components/` — UI. `src/export/png.ts` — canvas share image.
- `public/data/` — snapshot written by `npm run fetch-data` (~3 min, ~16 MB). Images and most data are not in git.
- `scripts/` — data fetch, tuning, CLI, `browser-check.mjs`, `ui-lint.mjs`.
- `screenshots/` and `plans/` are gitignored. Evidence that must be reviewed goes under `docs/`
  (`docs/ui/before/`, `docs/ui/after/`, `docs/ui/DESIGN.md`, `docs/build-board.png`).

## Conventions
- No secrets, no `.env`; the app makes no network requests after the snapshot is fetched.
- Logs: browser console only (structured JSON lines once `src/log.ts` exists).
- Keep the Deadlock shop look (teal bar, parchment board, slot-tinted tiles); no stock component-library theme.
- Gotcha: the production build's lightningcss minifier can silently drop a CSS declaration that
  equals a property's spec-default (e.g. `translate: 0;`, maybe `transform: none;`/`opacity: 1;`)
  even when it's needed to win a cascade override — it only shows up after `npm run build`, not
  in dev. Prefer a Tailwind utility class (e.g. an arbitrary-variant reset like
  `max-[899px]:translate-none`) over a raw CSS reset when you need one of these to survive
  minification.
- Gotcha: never run `git checkout <file>` to "undo a test mutation" against a file that has
  uncommitted edits — it reverts to the last *commit*, silently discarding the uncommitted work.
  Back up first (`cp file /tmp/x.bak`), mutate, check, then restore from the backup copy instead.
- UI copy: plain words, short sentences, no stats jargon.
- Never delete a browser check to make it pass; fix it or replace it with an equivalent.

## Gotchas
- Chromium's `:focus-visible` tracks a page-wide "last input modality" — a scripted
  `element.focus()` right after a real mouse click won't show a focus ring. In Playwright,
  send a real `page.keyboard.press('Tab')` before asserting focus-ring styles.
  Tailwind's `animate-in`/`animate-out` (used by the vendored `dialog.tsx`) are CSS
  *animations*, not transitions — a `* { transition: none !important }` reduced-motion
  override won't stop them; also zero `animation-duration`/`animation-iteration-count`.
- Radix `Tabs`: a `TabsTrigger` with no matching `TabsContent` (same `value`) leaves its
  auto-generated `aria-controls` pointing at nothing — an axe `aria-valid-attr-value` critical
  violation. Render a real `TabsContent` (use `forceMount` to avoid unmount/remount behavior)
  instead of drawing the panel content outside the `Tabs` tree.
- `HTMLCanvasElement.prototype.toBlob` stubbed to throw synchronously still surfaces as a
  rejected Promise when called inside `new Promise((res, rej) => cv.toBlob(...))` — useful for
  testing the PNG-export failure path without touching `src/export/png.ts`.
- WCAG contrast: 4.5:1 for normal text, 3:1 only for "large text" (≥18.66px bold or ≥24px
  regular) — 12–13px bold does not qualify as large text, a common trap when dimming muted/
  secondary text with `opacity` instead of a darker solid color.
