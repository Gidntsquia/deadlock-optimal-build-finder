# export-to-game

Injects a build produced by this app into Deadlock as a local "Unpublished" hero build, by editing
the Steam Cloud cache file the game reads on startup:

```
<Steam>/userdata/<account_id>/1422450/remote/cfg/cached_hero_builds.kv3
<Steam>/userdata/<account_id>/1422450/remotecache.vdf
```

The file is binary KV3 (LZ4-compressed) wrapping protobuf `CMsgHeroBuild` messages. See
`hero_build.proto` for the schema (from SteamDatabase's citadel_gcmessages_common.proto).

## Setup

```
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
# regenerate the protobuf bindings if you change hero_build.proto:
python -m grpc_tools.protoc -I. --python_out=. hero_build.proto
```

## Usage

List existing unpublished builds:

```
python3 export_to_game.py list
```

Dry run (never touches the real file — writes to --out instead):

```
python3 export_to_game.py export my-build.json --out /tmp/preview.kv3
```

Apply for real (backs up the original cache + remotecache.vdf first, refuses if Steam looks to be
running):

```
python3 export_to_game.py export my-build.json --apply
```

`--account-id` (default `267836488`) and `--cache`/`--remotecache` let you point at a different
Steam account or a copy of the files for testing.

## Build JSON schema

Produced by `src/export/game-json.ts`'s `toGameBuildJson(build, hero)` in the app, or write it by
hand:

```json
{
  "hero_id": 7,
  "hero_class_name": "hero_wraith",
  "name": "My Build",
  "description": "",
  "categories": [
    { "name": "Early Game", "description": "", "width": 360, "height": 175, "item_ids": [111, 222] }
  ],
  "ability_order": [
    { "ability_id": 333, "kind": "unlock" },
    { "ability_id": 333, "kind": "tier1" }
  ],
  "tags": [1, 3]
}
```

- `hero_id` is the game's internal hero id (same as `Hero.id` in `src/types.ts`).
- `tags` are numeric ids for the in-game build editor's "Standard Tags" (weapon/vitality/spirit/etc).
  These ids are a best-effort guess read off the tag picker's icon grid (top-to-bottom, left-to-right)
  — there's no public proto enum for them and they have **not** been confirmed in-game. See the
  `STANDARD_TAG_ID` table in `src/export/game-json.ts` before trusting a specific id.
- `item_ids` are the deadlock-api item ids (same as `Item.id`), in buy order, one category per build
  phase (Early/Mid/Late Game) by convention — the game just renders whatever categories you give it.
- `ability_order.kind` is one of `unlock` / `tier1` / `tier2` / `tier3`, matching `AbilityStep.kind`
  in the app. This is translated to the "currency_changes" encoding the game's build format actually
  uses (`unlock` → currency_type 2 delta -1; `tier1/2/3` → currency_type 1 delta -1/-2/-5), based on
  reverse-engineering existing entries in a real `cached_hero_builds.kv3`. List order matters — pass
  steps in recommended pick order.

See `example-build.json` for a minimal working example.

## What was verified

- Round-tripped a real `cached_hero_builds.kv3` through `keyvalues3`'s KV3 **text** encoding (the
  library's binary writer and its text writer's default header are both broken for this file's v5
  format — see "Known issues" below); confirmed byte-for-byte identical `.value` after re-parsing.
- Appended a build, re-read the output, and confirmed every original `Unpublished` entry is still
  byte-identical, and the new entry decodes as a valid `CMsgHeroBuild` with the expected id, name,
  categories, and ability order.
- Exercised `--apply` against a scratch copy of the real file: it created timestamped `.bak` files
  for both the cache and `remotecache.vdf`, wrote the new cache, and patched `remotecache.vdf`'s
  `size`/`localtime`/`time`/`remotetime` fields for the correct entry.

## Known issues / uncertainty

- **keyvalues3 library bugs worked around here**: its binary KV3 writer is broken for this file's
  format on the installed version, and its text writer leaves the `format` header field as a bare
  UUID (`... 7412167c-...-->`) instead of `format:generic:version{...}`, which its own reader then
  fails to parse back. This tool forces `f.format = kv3.FORMAT_GENERIC` before writing and always
  writes **KV3 text** (not binary). Source 2's KV3 loader is documented to accept text wherever
  binary is accepted, and this file's game (Deadlock) is a Source 2 title, but this has **not** been
  verified by actually loading the file in-game — only by round-tripping through the same Python
  library that read it. If Deadlock rejects the text-format file, the next step would be writing a
  minimal binary KV3 v5 encoder (LZ4 block compression, header includes the object/string blocks).
- **remotecache.vdf patching is a targeted string replace**, not a full VDF (KV1) parse/rewrite, to
  avoid perturbing formatting of unrelated entries. It matches the entry by exact relative path
  (tries both `/` and `\` separators) and rewrites `size`/`localtime`/`time`/`remotetime`. It does
  not update `sha` (Steam should recompute/ignore this locally; if Steam still flags a cloud
  conflict, forcing a re-upload from the Steam client's Cloud sync settings for Deadlock should
  resolve it).
- **Ability-order semantics are inferred**, not confirmed against Valve's own encoder: reverse
  engineering existing entries suggested `currency_type 2 / delta -1` for the four ability unlocks
  and `currency_type 1 / delta -1/-2/-5` for tier upgrades, but the real client's entries interleave
  these in a per-level order that this tool does not attempt to reproduce exactly — it just emits the
  steps in the order given in the JSON. This likely still renders correctly in-game (the ability
  order UI probably just needs a valid pick sequence) but hasn't been visually confirmed in Deadlock.
- **Steam-running detection** uses `tasklist.exe /FI "IMAGENAME eq steam.exe"` via WSL interop; if
  that check is inconclusive (e.g. `tasklist.exe` unreachable) the tool proceeds but prints a loud
  warning rather than blocking, per the task's request — Deadlock/Steam should still be fully closed
  before `--apply`, since a running Steam client can overwrite local changes with its own cloud sync.
- This has been tested end-to-end only against a **scratch copy** of the real `cached_hero_builds.kv3`
  (see the test transcript in the session that built this), never against the real file with Steam
  running. Recommended first real use: `--apply` once, then launch Deadlock and check the build shows
  up under "My Builds" / Unpublished before relying on it further.
