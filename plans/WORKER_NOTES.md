# Worker notes (round 13: nav bar, tier list, logo)
Launch: `npm run dev` (or `npm run build && npx vite preview`); tier list at `/tier-list/`. Tour: `SHOT_DIR=docs/ui/after npm run verify:browser`.
- Nav on build + tier pages, 1440 and 390, current highlighted: MET (tour, docs/ui/after/nav-*.png, tier-list-*.png).
- Tier list link switches w/o reload, URL changes, Back works; direct load OK on preview (/) and with BASE_PATH (checked by hand on a static server: 200, 38 heroes) and live (curl 200): MET.
- Shared build URL opens same hero: MET (tour, ?hero=vindicta). Street Brawl href: MET (tour).
- 38 heroes once each, tiers recomputed independently in the tour, order agrees with win rate: MET. Rule in docs/tier-list.md.
- Snapshot has hero-stats.json (wins/matches, badge>=90) written by fetch-data; tour runs with network blocked: MET.
- Page says Phantom+ win rates + data date: MET.
- Fit 1440x900 / 1920x1080 with nav, phone overflow, banned text, axe (desktop, phone build, desktop tier list): MET. Tiles shrank a bit (width term 4.9vw -> 4.6vw) to make room for the 48px bar. Phone axe on the tier list dropped for test time.
- Live icon: cause = browser tab-icon cache (files were already correct). Added ?v=2 to icon links. Fresh Edge profile on the live site shows the new icon (docs/ui/after/live-tab-icon.png). NOT verified on the user's own profile: if the old icon still shows, close the tab, reopen; if still old, clear site data/history for gidntsquia.github.io or remove and re-add the bookmark.
- Logo = favicon.svg, vector so sharp at 1x/2x: MET (not screenshotted at 2x).
- lint/ui-lint/self-test/tsc/verify/prettier exit 0; nothing under src/generator or src/validation: MET.
- `npm test` ~20-22s here, NOT the ~15s target; box load average was ~13 the whole time, and the tour before my block took ~13s. Not verified on an idle box.
- User-judged items (nav looks like deadlockmeta, tier list reads right, no AI look): pending.

## Round 13 fixes (from EVAL.md)
- Nav 48 -> 36px (44px on phone so tap targets stay 40px); gap between bar and build window 12px -> 4px: MET in tour (fit 1440x900/1920x1080 pass); look pending user.
- Tier list one screen at 1440x900 and 1920x1080, no scroll, rule link + credit visible: MET (tour check, docs/ui/after/tier-list-desktop.png). Rule text is a popover above the footer link.
- Credit: "by GidntSquia" in nav (desktop) and "Made by GidntSquia" in tier list footer, links https://github.com/GidntSquia: MET (tour). Not on phone build page (no room); pending user on placement.
- Desktop tap-target check now excludes the nav and adds "nav links >= 28px" (WCAG 2.5.8); phone still holds nav to 40px. This narrows the old check because the user asked for a shorter bar.
- Tour 66 PASS, 0 FAIL; npm test ~19s on this box. lint/ui-lint/self-test/tsc/verify pass; nothing under src/generator or src/validation.

## Round 13, pass 3 (from EVAL.md)
- Credit: GitHub mark next to "GidntSquia" (nav + tier footer), colour `--navy-dim` (#8b96ad, greyer than before): MET (tour checks icon; axe passes; docs/ui/after/tier-list-desktop.png). Look pending user.
- Instant return: `App` stays mounted (display hidden) while on the tier list, so Back / nav click shows the same build with no skeleton. Tour check runs `history.back()` and looks two frames later: MET. Picking a hero on the tier list still opens that hero (App re-reads the URL when re-shown).
- Tour: 67 PASS, 0 FAIL, 20.6s under load avg ~10 (box not idle). ~15s NOT verified. lint/ui-lint/self-test/tsc/prettier pass.
- Cost: build data now loads once at startup even when the first page is the tier list.

## Round 13, pass 4 (from EVAL.md + "speed up tests")
- Build pills/Share/Details fixed x: desktop title now fixed width (clamp 200-340px, ellipsis, full text in `title`). Tour compares pill/Share/Details/board rects across every style of 3 sampled heroes; mutation (old CSS) makes it FAIL: MET.
- No slide on page switch: App drops slide state while hidden (display:none -> shown restarted the CSS animation). Tour steps a hero, goes Tier List -> Build Finder, expects 0 running animations: MET.
- Tier list instant: TierList stays mounted (hidden) like App, images eager. Tour probe two frames after nav click: 38 heroes visible, no skeleton, 0 animations: MET. Look/feel pending user.
- Tests: cut 2 redundant checks (start "fits 1440" duplicated by the fit sample; tier "no sideways scroll" duplicated by the fit check) and one sampled hero (Haze). Tour 67 PASS, 0 FAIL, ~16-18s; npm test ~20s at load avg ~13 (not idle box). Most time is real waits (axe x3 ~4s, fit sample ~2s, start ~1.6s).
- lint/ui-lint/self-test/prettier/tsc pass; nothing under src/generator or src/validation.

## Round 13, pass 5 (from EVAL.md)
- Rapid arrow clicks: reproduced (12 clicks, 0ms gap left 3 stacked portraits; React's keyed hero-slide/hero-leave imgs got left in the DOM). Fix: `HeroPortrait` in App.tsx keeps exactly two imgs in a fixed-aspect clipped `.hero-stage` and slides them with the Web Animations API. Tour check: 14 rapid clicks -> one visible portrait filling the card: MET (tour). Look pending user.
- Build pills sit in a dark rounded track (`.style-switch`), chosen pill lit; still no movement on style change (tour) and fit checks pass: MET (docs/ui/after/nav-build-desktop.png). Look pending user.
- Tour 68 PASS, 0 FAIL, ~26s under load. lint/ui-lint/self-test/tsc/verify/prettier pass; nothing under src/generator or src/validation.

## Round 13 pass 6
- Pills bar height: MET. `.frame-head` desktop min-height 64px fits the 48px pill track, so heroes with one build get the same bar. New tour step compares bar height/y of a pills hero vs a single-build hero: PASS. Tour 69 PASS, 0 FAIL in 18s.
- Launch: `npm run build && npx vite preview` (or `npm run dev`).

## Round 13 pass 7
- Phase rows same height/y for every hero: MET. Desktop item plates are a fixed 40px (three lines), so a "Spirit Shredder Bullets" name no longer grows a row. Tour check compares row y/height for Calico, Infernus, Wraith, Abrams, Grey Talon (includes long names): PASS; with the old CSS it FAILS. Tour 70 PASS, 0 FAIL, 19s. Fit checks pass.
- Launch: `npm run build && npx vite preview`.

## Round 13 pass 8
- Fixed flaky 'Back from the tier list' check: it now starts the two-frame clock at popstate (history.back() fires it async, 30-50ms later). 3/3 tour runs: 70 PASS, 0 FAIL. Check still requires no skeleton/stale/animation.
