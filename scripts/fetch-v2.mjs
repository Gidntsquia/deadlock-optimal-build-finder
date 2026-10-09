// v2 build data (docs/build-v2.md). Every request here carries min_unix_timestamp = PATCH_SINCE: nothing older.
// Called from fetch-data.mjs (part of the full run) or alone with `node scripts/fetch-data.mjs --v2-only [--heroes 1]`.
// Writes public/data/v2/<heroId>.json (one hero) and public/data/v2/modes.json (all heroes, both modes, for the game-mode effect).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const API = 'https://api.deadlock-api.com';
export const PATCH_NAME = '09-29-2026';
export const PATCH_SINCE = Math.floor(Date.UTC(2026, 8, 29, 20) / 1000);
export const TOP_BADGE = 90;
export const ZERGGGY = 35187362;
export const V2_ENEMIES = 10;
const OUT = path.resolve('public/data/v2');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (res.status === 429 || res.status >= 500) {
        const asked = Number(res.headers.get('retry-after') || 0) * 1000 || 2000 * (i + 1);
        if (res.status === 429 && asked > 60000) throw new Error(`429 retry-after ${Math.round(asked / 1000)}s for ${url}`);
        console.warn(`  ${res.status} on ${url} - waiting ${Math.min(asked, 60000)}ms`);
        await sleep(Math.min(asked, 60000));
        continue;
      }
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
      const j = await res.json();
      await sleep(350);
      return j;
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(1500 * (i + 1));
    }
  }
}
const slim = (r) => ({ item_id: r.item_id, wins: r.wins, matches: r.matches, avg_buy_time_s: Math.round(r.avg_buy_time_s ?? 0) });
const save = async (rel, data) => {
  const f = path.join(OUT, rel);
  await mkdir(path.dirname(f), { recursive: true });
  await writeFile(f, JSON.stringify(data));
};

/** Snapshots (cumulative, every 3-5 min) -> per-interval rates of farm and fight activity. */
export function intervalsOf(stats) {
  const out = [];
  let prev = { time_stamp_s: 0 };
  for (const s of stats ?? []) {
    const dt = (s.time_stamp_s - prev.time_stamp_s) / 60;
    if (dt >= 1) {
      const d = (k) => ((s[k] ?? 0) - (prev[k] ?? 0)) / dt;
      out.push({
        mid: (prev.time_stamp_s + s.time_stamp_s) / 2,
        creepGold: ((s.gold_lane_creep ?? 0) + (s.gold_neutral_creep ?? 0) - (prev.gold_lane_creep ?? 0) - (prev.gold_neutral_creep ?? 0)) / dt,
        creeps: ((s.creep_kills ?? 0) + (s.neutral_kills ?? 0) - (prev.creep_kills ?? 0) - (prev.neutral_kills ?? 0)) / dt,
        damage: d('player_damage'),
        ka: ((s.kills ?? 0) + (s.assists ?? 0) - (prev.kills ?? 0) - (prev.assists ?? 0)) / dt,
      });
    }
    prev = s;
  }
  return out;
}
const slimStats = (stats) =>
  (stats ?? []).map((s) => [
    s.time_stamp_s,
    (s.gold_lane_creep ?? 0) + (s.gold_neutral_creep ?? 0),
    (s.creep_kills ?? 0) + (s.neutral_kills ?? 0),
    s.player_damage ?? 0,
    (s.kills ?? 0) + (s.assists ?? 0),
  ]);

/** Role curve inputs: per game, cumulative snapshots [t, creepGold, creeps, heroDamage, kills+assists]. */
async function panelTimelines(heroId, panelFiles) {
  const games = [];
  for (const f of panelFiles) {
    const v = JSON.parse(await readFile(path.resolve('public/data', f), 'utf8'));
    for (const m of v.matches) {
      if (m.start_time < PATCH_SINCE || m.game_mode !== 1) continue;
      try {
        const meta = await getJson(`${API}/v1/matches/${m.match_id}/metadata`);
        const p = (meta.match_info.players ?? []).find((x) => x.account_id === v.account_id);
        if (p?.stats?.length) games.push({ match_id: m.match_id, account_id: v.account_id, duration_s: meta.match_info.duration_s, snaps: slimStats(p.stats) });
      } catch (e) {
        console.warn(`  skip panel match ${m.match_id}: ${e.message}`);
      }
    }
  }
  return games;
}
async function aggregateTimelines(heroId, limit = 60) {
  const ms = await getJson(
    `${API}/v1/matches/metadata?hero_ids=${heroId}&min_average_badge=${TOP_BADGE}&min_unix_timestamp=${PATCH_SINCE}&game_mode=normal&include_player_stats=true&limit=${limit}`,
  );
  const games = [];
  for (const m of ms)
    for (const p of m.players ?? [])
      if (p.hero_id === heroId && p.stats?.length)
        games.push({ match_id: m.match_id, account_id: p.account_id, duration_s: m.duration_s, snaps: slimStats(p.stats) });
  return games;
}

/** Which items the hero's Phantom+ players sell later (post-patch games only). Same method as fetch-data's sell stats. */
async function sellStats(heroId, items, panelIds) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const matches = await getJson(
    `${API}/v1/matches/metadata?hero_ids=${heroId}&min_average_badge=${TOP_BADGE}&min_unix_timestamp=${PATCH_SINCE}&game_mode=normal&include_player_items=true&limit=300`,
  );
  const acc = new Map();
  let players = 0;
  for (const m of matches)
    for (const p of m.players ?? []) {
      if (p.hero_id !== heroId || panelIds.has(p.account_id)) continue;
      players++;
      const bought = (p.items ?? []).filter((it) => byId.has(it.item_id));
      const seen = new Set();
      for (const it of bought) {
        if (seen.has(it.item_id)) continue;
        seen.add(it.item_id);
        const a = acc.get(it.item_id) ?? { item_id: it.item_id, buyers: 0, sold: 0, upgraded: 0, sold_time_sum: 0 };
        a.buyers++;
        if (it.sold_time_s > 0) {
          const cls = byId.get(it.item_id).class_name;
          if (bought.some((o) => (byId.get(o.item_id).component_items ?? []).includes(cls) && Math.abs(o.game_time_s - it.sold_time_s) <= 2)) a.upgraded++;
          else {
            a.sold++;
            a.sold_time_sum += it.sold_time_s;
          }
        }
        acc.set(it.item_id, a);
      }
    }
  const rows = [...acc.values()]
    .map(({ sold_time_sum, ...a }) => ({ ...a, avg_sold_time_s: a.sold ? Math.round(sold_time_sum / a.sold) : 0 }))
    .sort((a, b) => b.buyers - a.buyers);
  return { min_unix_timestamp: PATCH_SINCE, players, matches: matches.length, items: rows };
}

async function zergggy(heroId) {
  const hist = await getJson(`${API}/v1/players/${ZERGGGY}/match-history`);
  const mine = hist.filter((m) => m.hero_id === heroId && m.start_time >= PATCH_SINCE);
  const games = [];
  for (const h of mine) {
    const meta = await getJson(`${API}/v1/matches/${h.match_id}/metadata`);
    const mi = meta.match_info;
    const p = (mi.players ?? []).find((x) => x.account_id === ZERGGGY);
    if (!p) continue;
    games.push({
      match_id: h.match_id,
      start_time: mi.start_time,
      game_mode: mi.game_mode,
      match_mode: mi.match_mode,
      won: p.team === mi.winning_team,
      items: (p.items ?? []).map((i) => ({ item_id: i.item_id, game_time_s: i.game_time_s, sold_time_s: i.sold_time_s })),
    });
  }
  return { account_id: ZERGGGY, since: PATCH_SINCE, hero_games_total_since_patch: mine.length, games };
}

/** Every hero's standard (Phantom+) and brawl item rows: the base for the game-mode effect. */
export async function fetchModes(heroes) {
  const rows = {};
  for (const h of heroes) {
    const std = await getJson(`${API}/v1/analytics/item-stats?hero_id=${h.id}&min_unix_timestamp=${PATCH_SINCE}&min_average_badge=${TOP_BADGE}`);
    const brw = await getJson(`${API}/v1/analytics/item-stats?hero_id=${h.id}&min_unix_timestamp=${PATCH_SINCE}&game_mode=street_brawl`);
    rows[h.id] = { standard: std.map(slim), brawl: brw.map(slim) };
  }
  await save('modes.json', { min_unix_timestamp: PATCH_SINCE, standard_min_average_badge: TOP_BADGE, brawl_min_average_badge: null, heroes: rows });
}

export async function fetchV2Hero(heroId, manifest) {
  const q = `hero_id=${heroId}&min_unix_timestamp=${PATCH_SINCE}`;
  const standard = (await getJson(`${API}/v1/analytics/item-stats?${q}&min_average_badge=${TOP_BADGE}`)).map(slim);
  const brawl = (await getJson(`${API}/v1/analytics/item-stats?${q}&game_mode=street_brawl`)).map(slim);
  const counters = (await getJson(`${API}/v1/analytics/hero-counter-stats?min_unix_timestamp=${PATCH_SINCE}&min_average_badge=${TOP_BADGE}`)).filter(
    (r) => r.hero_id === heroId,
  );
  const enemies = counters
    .sort((a, b) => b.matches_played - a.matches_played)
    .slice(0, V2_ENEMIES)
    .map((r) => ({ hero_id: r.enemy_hero_id, games: r.matches_played, wins: r.wins }));
  const standardVs = {},
    brawlVs = {};
  for (const e of enemies) {
    standardVs[e.hero_id] = (await getJson(`${API}/v1/analytics/item-stats?${q}&min_average_badge=${TOP_BADGE}&enemy_hero_ids=${e.hero_id}`)).map(slim);
    brawlVs[e.hero_id] = (await getJson(`${API}/v1/analytics/item-stats?${q}&game_mode=street_brawl&enemy_hero_ids=${e.hero_id}`)).map(slim);
  }
  const abilityOrder = (await getJson(`${API}/v1/analytics/ability-order-stats?${q}&min_average_badge=${TOP_BADGE}&min_matches=5`))
    .sort((a, b) => b.matches - a.matches)
    .slice(0, 400);
  const panelFiles = (manifest.validation_sets ?? []).filter((v) => v.hero_id === heroId).map((v) => v.file);
  let timelines = await panelTimelines(heroId, panelFiles);
  let timelineSource = 'panel';
  if (timelines.length < 20) {
    timelines = await aggregateTimelines(heroId);
    timelineSource = 'aggregate';
  }
  const items = JSON.parse(await readFile(path.resolve('public/data/items.json'), 'utf8'));
  const sell = await sellStats(heroId, items, new Set((manifest.validation_sets ?? []).filter((v) => v.hero_id === heroId).map((v) => v.account_id)));
  const z = await zergggy(heroId);
  await save(`${heroId}.json`, {
    hero_id: heroId,
    patch: { name: PATCH_NAME, min_unix_timestamp: PATCH_SINCE },
    standard: { min_unix_timestamp: PATCH_SINCE, min_average_badge: TOP_BADGE, item_stats: standard },
    brawl: { min_unix_timestamp: PATCH_SINCE, min_average_badge: null, item_stats: brawl },
    enemies,
    standard_vs: { min_unix_timestamp: PATCH_SINCE, rows: standardVs },
    brawl_vs: { min_unix_timestamp: PATCH_SINCE, rows: brawlVs },
    ability_order_stats: { min_unix_timestamp: PATCH_SINCE, rows: abilityOrder },
    timelines: { min_unix_timestamp: PATCH_SINCE, source: timelineSource, games: timelines },
    sell_stats: sell,
    zergggy: z,
  });
  console.log(
    `   v2 hero ${heroId}: ${standard.length} std items, ${brawl.length} brawl items, ${enemies.length} enemies, ${timelines.length} ${timelineSource} timelines, zergggy ${z.games.length} games`,
  );
}

export async function fetchV2(heroes, heroIds, manifest) {
  console.log(`v2: patch ${PATCH_NAME}, hero(es) ${heroIds.join(',')}`);
  await fetchModes(heroes);
  for (const id of heroIds) await fetchV2Hero(id, manifest);
}
