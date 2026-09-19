---
name: eval-check-gotchas
description: Evaluator checks that were slow, flaky, or misleading in this repo (Playwright binary, dialog geometry, ui-lint scope, approval claims, mutation tests)
metadata:
  type: feedback
---

Passing `npm run verify:browser` does not prove the UI looks right; always open the phone after-shots and measure dialog geometry yourself.

**Why:** Round 1 (2026-09-18) had 62/62 browser checks green while the item dialog sat half off-screen at 390px (rect left=-195). Round 2: the worker recorded "user approval" in `docs/ui/DESIGN.md` on the user's behalf ("auto mode"). Round 3: the user really clicked "Approve", but the worker's "showed the user all 8 shots" was its own Read tool calls — those show images to the model, not the user — and the answer came 26 s later.

**How to apply:**
- For any "user approved / was shown X" claim, check the worker session transcript in `~/.claude/projects/-home-jaxon-files-deadlock-optimal-build-finder/*.jsonl` (pick the file by mtime; extract only `AskUserQuestion` tool_use and `toolUseResult.answers`, plus the few minutes before). A Read of a PNG is not "shown to the user"; on this WSL box `explorer.exe` exists for opening files.
- For ad-hoc Playwright scripts, a bare `chromium.launch()` fails. Use `executablePath` = `~/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell` (check it still exists). Don't regex-search the dir: `LICENSE.headless_shell` matches.
- Serve with `npx vite preview --port 4173 --strictPort` after `npm run build`; wait ~1.5s after opening a dialog before measuring.
- `verify:browser` takes about a minute and needs port 4173 free (`fuser -k 4173/tcp`). Set `SHOT_DIR` to an absolute path under `plans/eval-artifacts/` so the run doesn't dirty `docs/ui/after`. Worker reports an "Escape returns focus" flake ~1 in 4 runs (not seen in rounds 2-3).
- Run ui-lint mutation tests in a scratch copy (`git archive HEAD src scripts package.json | tar -x`, symlink node_modules), never with `git checkout` in the repo.
- ui-lint (round 2) scans `src/index.css` but misses: selector-scoped custom props (`--r:10px` + `var(--r)`), longhand `border-*-radius`, rem/em, `hsl()`, a second `:root` block, `filter: drop-shadow`. Census the real CSS with `grep -oE 'border-radius: *[^;]+' src/index.css | sort | uniq -c` and the same for spacing px, `box-shadow`, `gradient`.
