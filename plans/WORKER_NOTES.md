# Worker notes (Infernus v2 pass 4)
Launch: `npm run dev`, open `?hero=infernus`, Details. CLI: `npm run generate 1 -- --v2 --explain`; `npm run verify`.
- 1 MET: verify prints the final 12 and the standard 12; held at end = exactly the 12; litmus 9/9; 0 failures.
- 2 MET: lifted Mercurial Magnum (took Escalating Exposure's spot, 26 min), Juggernaut (took Spiritual Overflow's, 27 min), Spirit Resilience (took Rapid Recharge's, 16 min: no pushed-out item within one tier, so it sits where the same-priced item stays). Rows 16, 23, 24 of 27; none in the last three.
- 3 MET: last row is Boundless Spirit (final). Spill kept: Extra Regen, Healbane, Spirit Lifesteal, Escalating Exposure (all sold). Spiritual Overflow cut (pushed out, no slot).
- 4 MET: Quicksilver Reload row 8 (12:18), Magnum row 23; verify component check passes.
- 5 MET: most held 12; sells: Extra Regen->Toxic Bullets, Healbane->Spirit Shredder, Spirit Lifesteal->Dispel Magic, Escalating Exposure->Ricochet. No final-12 item sold.
- 6 MET (verify order-sanity checks pass; tour passes). Not eyeballed: ring/share PNG.
- 7 MET: Details shows one sentence per row, closed toggle; screenshot plans/eval-artifacts/pass4-details-v2.png. Tour step rewritten (checks forms, word count, nothing else above toggle).
- 8: tsc, ui-lint (+self-test), prettier (changed files) pass; oxlint only old warnings. Other heroes' snapshot diff vs HEAD (worktree): empty.
- 9: `npm test` 3 passes in a row (104 PASS). One earlier run failed once (sell-later note, then "Failed to fetch"), not reproduced in 4 later runs; cause not found.
- 10 docs rules 10, 11 rewritten. 11 order below. No deploy done (evaluator decides).
Deviations: (a) spec says a pushed-out item is not in the build; Escalating Exposure is pushed out but kept as a sold spill because the litmus list requires it in (cut order puts litmus items last). It is bought at 25:54 and sold at Ricochet (27:34): odd but follows the rules. (b) Tier gap capped at one for pairing (T3 into T1's 8-min spot is unaffordable). (c) A phase row holds at most 11 tiles (tail moves to next phase) or the fit check breaks.
Final order (row item, time): 1 Extra Spirit 2:22; 2 Extra Regen 3:42 (sold at Toxic Bullets); 3 Rapid Rounds 5:00; 4 Improved Spirit 6:06; 5 Extended Magazine 7:31; 6 Healbane 9:46 (sold at Spirit Shredder); 7 Swift Striker 9:55; 8 Quicksilver Reload 12:18; 9 Extra Charge 12:27; 10 Titanic Magazine 13:18; 11 Sprint Boots 14:03; 12 Duration Extender 14:40; 13 Spirit Lifesteal 14:42 (sold at Dispel Magic); 14 Mystic Vulnerability 15:02; 15 Rapid Recharge 15:46; 16 Spirit Resilience (took Rapid Recharge's spot); 17 Enduring Speed 17:12; 18 Toxic Bullets 18:28; 19 Spirit Shredder 18:57; 20 Dispel Magic 19:07; 21 Superior Duration 22:01; 22 Escalating Exposure 25:54 (sold at Ricochet); 23 Mercurial Magnum (took Escalating's spot, 26 min); 24 Juggernaut (took Spiritual Overflow's spot, 27 min); 25 Ricochet 27:34; 26 Spirit Rend 27:48; 27 Boundless Spirit 30:34.

## Follow-up (user: departures made no sense) — fixed
- Escalating Exposure (must-have) stays in the final 12; Dispel Magic is pushed out instead. No buy-then-sell.
- No tier cap or "same price" fallback: every lifted item takes a real pushed-out item's spot (Resilience -> Grit's, 8 min; Juggernaut -> Dispel Magic's, 19 min; Magnum -> Spiritual Overflow's, 27 min). Must-have spill items (Healbane) are never dropped for being late.
- Phase cap of 11 tiles per row remains (fit check). verify 0 failures, litmus 9/9, npm test x3 green.

## Follow-up 2 (eval: Spiritual Overflow bought then sold)
- Pushed-out standard items are dropped from the build entirely (unless a must-have); no item costing 6000+ is ever sold. Order now 26 rows, Spiritual Overflow absent; verify 0 failures; tsc, prettier, npm test (104 PASS) green. Lint/snapshot/3x test not re-run. Details v2 not changed this round (not verified by eye).
