# Worker notes (Infernus v2 pass 3)
Launch: `npm run dev`; open `?hero=infernus`, Details. CLI: `npm run generate 1 -- --v2 --explain`; `npm run verify`.
- 1,2,5 order: MET. Lifted [Reactive Barrier, Debuff Reducer, Indomitable, Juggernaut, Mercurial Magnum], displaced [Grit, Extra Charge, Dispel Magic, Ricochet]. Slots now: Debuff Reducer 6 (Grit), Reactive Barrier 9 (Extra Charge), Indomitable 17 (Dispel), Juggernaut 21 (Ricochet), Magnum 24 (placed by cost in its phase). Printed by --explain and verify.
  Worker addition (not in spec): a spot more than one tier away is refused (first run put T4 Juggernaut at slot 6 where a T1 is bought at 8 min). Documented as rule 10. Magnum has no near-tier spot left, so it ends the list at its own time.
- 3 twelve-slot cap: MET, verify "most held 12", sells precede the buy they fund. 4 phases/totals/ability slider follow build.items: MET in code (tour passes); not eyeballed.
- 6 spike: MET, verify names Reactive Barrier for vitality (weapon Toxic Bullets, spirit Mystic Vulnerability). Ring/Details/share read the same b.spike. Selection-time spike bonus still sums chosen cost (no order yet); documented.
- 7 Details: MET in tour (summary, line per item, closed "Show numbers", table opens). Not eyeballed by me.
- 8: ui-lint, tsc, prettier (changed files) pass; oxlint only old warnings. 9: `npm test` x3 exit 0, 104 PASS each (47-56s, box loaded).
- 11 snapshot diff vs HEAD (git worktree): empty. Docs rule 6 rewritten, rule 10 added.
- 12 git: pull.rebase=true, rebase.autoStash=true set. Before: `## main...origin/main`, log main...origin/main empty.
- 10 deploy/live check: see below.
- 10: pushed 0091c8d; Pages run 37856585103 success; live bundle contains "Show numbers" and "Fights start at". Opened in Firefox 18:57 EDT. Not eyeballed by me.
- 12 after push: `git status -sb` = `## main...origin/main`, `git log main...origin/main` empty.

## Round 2 (user feedback 2026-10-08: Grit/Extra Charge take no final slot, Ricochet must stay, why Indomitable)
User overrides of the spec text (user wins):
- Components are bought and upgraded (new `chains.ts`): Grit→Reactive Barrier, Extra Charge→Rapid Recharge, Quicksilver→Magnum etc. They are never lifted or displaced. Verify check "every upgrade is bought from its component" PASS.
- Game-mode effect = matches-weighted mean of rel, no clamp at 0. The old version let Indomitable in. Standard-winner guard: a weaker brawl result can't push out an item that wins in standard (Ricochet). `brawlWeight` 2→5 (sweep: only 5 gives litmus 9/9). Litmus adds Ricochet in, Indomitable out.
- The spec's "vitality spike on Reactive Barrier" check is replaced by a recount check, since Reactive Barrier is now Grit's upgrade and the vitality crossing moved to Spirit Lifesteal.
- Sells: an item top players really sell (≥10% of 20+ post-patch buyers) goes first. A component that waits is listed right before its upgrade.
Now: lifted [Spirit Resilience, Juggernaut, Mercurial Magnum]; displaced [Grit]; most held 12; verify 0 failures; snapshot diff of the other heroes vs HEAD is empty.
- Round 2 deploy: pushed 55e128e, Pages run 37858407836 success, live bundle has "Buy first, upgrades into". Opened in Firefox 19:16 EDT. Not eyeballed by me.
