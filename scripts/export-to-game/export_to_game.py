#!/usr/bin/env python3
"""
Inject a build produced by deadlock-optimal-build-finder into Deadlock's local "Unpublished" hero
builds, by editing the Steam Cloud cache file the game reads on startup.

This tool NEVER touches the real game file unless you pass --apply. By default (--dry-run, which is
also the default with no flag at all) it reads the real file read-only and writes its output to
--out, so you can inspect it before trusting it.

File touched (Windows Steam install, from WSL):
  <steamapps>/userdata/<account_id>/1422450/remote/cfg/cached_hero_builds.kv3
  <steamapps>/userdata/<account_id>/1422450/remotecache.vdf   (Steam Cloud bookkeeping, updated to match)

Format: binary KV3 v5 (LZ4 block compressed). Root dict has LastUsedBuilds / Favorites / Unpublished /
SavedLastUsed. Unpublished is a list of protobuf-encoded bytes blobs: a 2-field wrapper message whose
field 1 is a serialized CMsgHeroBuild and field 2 is an empty bytes field (see hero_build.proto).

See README.md in this directory for usage examples.
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path

try:
    import keyvalues3 as kv3
except ImportError:
    sys.exit("Missing dependency 'keyvalues3'. Run: pip install -r requirements.txt")

try:
    import hero_build_pb2 as hb_pb2
except ImportError:
    sys.exit(
        "Missing generated hero_build_pb2.py. Regenerate with:\n"
        "  python -m grpc_tools.protoc -I. --python_out=. hero_build.proto\n"
        "(run from this directory)"
    )

DEFAULT_STEAM_USERDATA = Path("/mnt/c/Program Files (x86)/Steam/userdata")
DEADLOCK_APP_ID = "1422450"
CACHE_REL = Path("remote/cfg/cached_hero_builds.kv3")
REMOTECACHE_REL = Path("remotecache.vdf")

AP_DELTA = {"unlock": (2, -1), "tier1": (1, -1), "tier2": (1, -2), "tier3": (1, -5)}


def default_paths(account_id: str) -> tuple[Path, Path]:
    base = DEFAULT_STEAM_USERDATA / account_id / DEADLOCK_APP_ID
    return base / CACHE_REL, base / REMOTECACHE_REL


# --------------------------------------------------------------------------------------
# KV3 read/write (works around keyvalues3's text writer leaving `format` as a bare UUID
# instead of a kv3.Format, which produces a header the library's own reader can't parse
# back; and its binary writer's block-compression path, which is broken on this version).
# We round-trip through KV3 TEXT, which Source 2 accepts anywhere binary is accepted.
# --------------------------------------------------------------------------------------

def read_kv3(path: Path) -> "kv3.KV3File":
    return kv3.read(str(path))


def write_kv3_text(f: "kv3.KV3File", path: Path) -> None:
    f.format = kv3.FORMAT_GENERIC
    kv3.write(f, str(path))
    # Verify the file we just wrote actually round-trips before trusting it.
    reread = kv3.read(str(path))
    if reread.value != f.value:
        raise RuntimeError(f"KV3 round-trip check failed writing {path}")


# --------------------------------------------------------------------------------------
# CMsgHeroBuild encode / decode
# --------------------------------------------------------------------------------------

def decode_entry(blob: bytes) -> "hb_pb2.CMsgHeroBuild":
    w = hb_pb2.Wrapper()
    w.MergeFromString(bytes(blob))
    return w.hero_build


def encode_entry(build: "hb_pb2.CMsgHeroBuild") -> bytes:
    w = hb_pb2.Wrapper()
    w.hero_build.CopyFrom(build)
    w.f2 = b""  # matches the trailing empty field observed on every existing entry
    return w.SerializeToString()


def next_build_id(unpublished: list) -> int:
    ids = []
    for blob in unpublished:
        try:
            ids.append(decode_entry(blob).hero_build_id)
        except Exception:
            pass
    return (max(ids) + 1) if ids else 1


def build_from_json(payload: dict, account_id: int, hero_build_id: int) -> "hb_pb2.CMsgHeroBuild":
    b = hb_pb2.CMsgHeroBuild()
    b.hero_build_id = hero_build_id
    b.hero_id = int(payload["hero_id"])
    b.author_account_id = account_id
    b.last_updated_timestamp = int(time.time())
    b.name = payload.get("name", "Untitled build")
    b.description = payload.get("description", "")
    b.language = 0
    b.version = 0
    b.origin_build_id = 0
    b.development_build = False
    b.publish_timestamp = 0  # 0 marks it unpublished

    for tag_id in payload.get("tags", []):
        b.tags.append(int(tag_id))

    for cat in payload.get("categories", []):
        mc = b.details.mod_categories.add()
        mc.name = cat.get("name", "")
        mc.description = cat.get("description", "")
        mc.width = float(cat.get("width", 360))
        mc.height = float(cat.get("height", 175))
        mc.optional = bool(cat.get("optional", False))
        for item_id in cat.get("item_ids", []):
            mc.mods.add().ability_id = int(item_id)

    for step in payload.get("ability_order", []):
        currency_type, delta = AP_DELTA[step["kind"]]
        cc = b.details.ability_order.currency_changes.add()
        cc.ability_id = int(step["ability_id"])
        cc.currency_type = currency_type
        cc.delta = delta

    return b


# --------------------------------------------------------------------------------------
# remotecache.vdf bookkeeping
# --------------------------------------------------------------------------------------

def update_remotecache_vdf(text: str, rel_path: str, new_size: int) -> str:
    """Update the 'size', 'localtime', 'time' and 'remotetime' fields for rel_path's entry.

    remotecache.vdf is Valve KV1 text. We do a targeted textual patch rather than a full KV1
    parse/serialize round-trip, to avoid disturbing formatting/quoting of unrelated entries.
    """
    import re

    now = int(time.time())
    # Find the block for this file: `"<rel_path>"\n{ ... }` (case as stored; Windows uses backslashes).
    needle_variants = [rel_path, rel_path.replace("/", "\\")]
    for needle in needle_variants:
        pattern = re.compile(
            r'("' + re.escape(needle) + r'"\s*\{)(.*?)(\n\s*\})',
            re.DOTALL,
        )
        m = pattern.search(text)
        if not m:
            continue
        block = m.group(2)

        def sub_field(block: str, field: str, value: str) -> str:
            field_pat = re.compile(r'("' + field + r'"\s*)"(\d+)"')
            if field_pat.search(block):
                return field_pat.sub(lambda mm: mm.group(1) + f'"{value}"', block)
            return block

        block = sub_field(block, "size", str(new_size))
        block = sub_field(block, "localtime", str(now))
        block = sub_field(block, "time", str(now))
        block = sub_field(block, "remotetime", str(now))
        return text[: m.start(2)] + block + text[m.end(2):]
    raise RuntimeError(f"Could not find entry for {rel_path!r} in remotecache.vdf")


# --------------------------------------------------------------------------------------
# Steam-running check
# --------------------------------------------------------------------------------------

def steam_is_running() -> bool | None:
    """Best-effort check via tasklist.exe. Returns None if the check itself is unreliable."""
    try:
        out = subprocess.run(
            ["tasklist.exe", "/FI", "IMAGENAME eq steam.exe"],
            capture_output=True, text=True, timeout=10,
        )
        if out.returncode != 0:
            return None
        return "steam.exe" in out.stdout.lower()
    except Exception:
        return None


# --------------------------------------------------------------------------------------
# Commands
# --------------------------------------------------------------------------------------

def cmd_list(args: argparse.Namespace) -> None:
    f = read_kv3(Path(args.cache))
    unpub = f.value.get("Unpublished", [])
    print(f"{'id':>4}  {'hero_id':>7}  name")
    for blob in unpub:
        try:
            b = decode_entry(blob)
            print(f"{b.hero_build_id:>4}  {b.hero_id:>7}  {b.name}")
        except Exception as e:
            print(f"  <undecodable entry, {len(blob)} bytes: {e}>")


def cmd_export(args: argparse.Namespace) -> None:
    payload = json.loads(Path(args.build_json).read_text())
    cache_path = Path(args.cache)
    f = read_kv3(cache_path)

    unpub = list(f.value.get("Unpublished", []))
    new_id = next_build_id(unpub)
    account_id = args.account_id
    build = build_from_json(payload, account_id, new_id)
    blob = encode_entry(build)

    # Sanity: re-decode what we just built and diff against the intended payload's essentials.
    check = decode_entry(blob)
    assert check.hero_build_id == new_id
    assert check.name == payload.get("name", "Untitled build")
    assert len(check.details.mod_categories) == len(payload.get("categories", []))

    unpub.append(blob)
    f.value["Unpublished"] = unpub

    summary = f"Added Unpublished build: id={new_id} hero_id={build.hero_id} name={build.name!r}"
    write_cache(f, cache_path, Path(args.remotecache), args.apply, args.out, summary)


def write_cache(f: "kv3.KV3File", cache_path: Path, remotecache_path: Path, apply: bool, out: str | None, summary: str) -> None:
    out_path = Path(out) if out else None
    if apply:
        if out_path:
            sys.exit("--apply and --out are mutually exclusive: --apply writes to the real cache path.")
        running = steam_is_running()
        if running is True:
            sys.exit("Steam appears to be running (steam.exe found via tasklist.exe). Close it before --apply.")
        if running is None:
            print("WARNING: could not determine whether Steam is running (tasklist.exe check was inconclusive).")
            print("         Make sure Steam AND Deadlock are fully closed before continuing.")
        target = cache_path
    else:
        if not out_path:
            sys.exit("--dry-run requires --out <path> to write the result to.")
        target = out_path

    ts = time.strftime("%Y%m%d-%H%M%S")
    if apply:
        backup = cache_path.with_name(cache_path.name + f".{ts}.bak")
        shutil.copy2(cache_path, backup)
        print(f"Backed up {cache_path} -> {backup}")

    write_kv3_text(f, target)
    new_size = target.stat().st_size
    print(f"Wrote {'real cache' if apply else 'dry-run output'}: {target} ({new_size} bytes)")
    print(summary)

    if apply:
        rc_backup = remotecache_path.with_name(remotecache_path.name + f".{ts}.bak")
        shutil.copy2(remotecache_path, rc_backup)
        print(f"Backed up {remotecache_path} -> {rc_backup}")
        text = remotecache_path.read_text(encoding="utf-8", errors="replace")
        rel = str(CACHE_REL.relative_to("remote"))
        new_text = update_remotecache_vdf(text, rel, new_size)
        remotecache_path.write_text(new_text, encoding="utf-8")
        print(f"Updated {remotecache_path} (size={new_size}, localtime/time/remotetime=now)")
    else:
        print("(dry-run: remotecache.vdf was not touched; pass --apply to update the real files)")


def cmd_delete(args: argparse.Namespace) -> None:
    cache_path = Path(args.cache)
    f = read_kv3(cache_path)
    unpub = list(f.value.get("Unpublished", []))
    ids_to_delete = set(args.ids)

    kept = []
    deleted = []
    for blob in unpub:
        try:
            b = decode_entry(blob)
            if b.hero_build_id in ids_to_delete:
                deleted.append((b.hero_build_id, b.name))
                continue
        except Exception:
            pass
        kept.append(blob)

    missing = ids_to_delete - {i for i, _ in deleted}
    if missing:
        sys.exit(f"Build id(s) not found in Unpublished: {sorted(missing)}")

    f.value["Unpublished"] = kept
    summary = "Deleted:\n" + "\n".join(f"  id={i} name={n!r}" for i, n in deleted)
    write_cache(f, cache_path, Path(args.remotecache), args.apply, args.out, summary)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--account-id", type=int, default=267836488, help="Steam32 account id (default: 267836488)")
    p.add_argument("--cache", default=None, help="Path to cached_hero_builds.kv3 (default: derived from --account-id)")
    p.add_argument("--remotecache", default=None, help="Path to remotecache.vdf (default: derived from --account-id)")
    sub = p.add_subparsers(dest="cmd", required=True)

    sp_list = sub.add_parser("list", help="List existing Unpublished builds (id, hero, name)")
    sp_list.set_defaults(func=cmd_list)

    sp_export = sub.add_parser("export", help="Append a build (from JSON) to Unpublished")
    sp_export.add_argument("build_json", help="Path to a build JSON file (see README.md for the schema)")
    sp_export.add_argument("--out", default=None, help="Write result here instead of the real file (default mode)")
    sp_export.add_argument("--dry-run", action="store_true", default=True, help="Default. Requires --out.")
    sp_export.add_argument("--apply", action="store_true", help="Write to the REAL cache file (after backing it up). Refuses if Steam looks to be running.")
    sp_export.set_defaults(func=cmd_export)

    sp_delete = sub.add_parser("delete", help="Remove build(s) by id from Unpublished")
    sp_delete.add_argument("ids", type=int, nargs="+", help="hero_build_id(s) to delete (see `list`)")
    sp_delete.add_argument("--out", default=None, help="Write result here instead of the real file (default mode)")
    sp_delete.add_argument("--dry-run", action="store_true", default=True, help="Default. Requires --out.")
    sp_delete.add_argument("--apply", action="store_true", help="Write to the REAL cache file (after backing it up). Refuses if Steam looks to be running.")
    sp_delete.set_defaults(func=cmd_delete)

    args = p.parse_args()
    if args.cache is None or args.remotecache is None:
        cache, remotecache = default_paths(str(args.account_id))
        args.cache = args.cache or str(cache)
        args.remotecache = args.remotecache or str(remotecache)
    args.func(args)


if __name__ == "__main__":
    main()
