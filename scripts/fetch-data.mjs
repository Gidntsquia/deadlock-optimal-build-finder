// Data pipeline: snapshots every remote input the app needs into public/data/.
// After one successful run the app and the generator work fully offline.
//
// Outputs
//   public/data/items.json                 item catalog (all upgrade items)
//   public/data/heroes.json                active heroes with base stats + growth
//   public/data/abilities.json             abilities of active heroes (names, upgrades, tooltip text and stats)
//   public/data/analytics/<hero_id>.json   item-stats, ability-order-stats, item-permutation-stats, and (top population)
//                                          build styles: per-style item/ability stats (see scripts/styles.mjs),
//                                          and sell stats: how often each item is sold to make room (fetchSellStats),
//                                          and charge-item ability sequences: sequences from games where a charge item was bought (fetchChargeOrders),
//                                          and corrupted stats: corrupted vs normal copies of each item (fetchCorruptedStats),
//                                          and imbue targets: which ability published builds put each imbue item on (fetchImbueTargets)
//   public/data/validation/<account>-<hero>.json  a top player's ~20 most recent matchmaking matches on one hero
//                                          with per-match purchases; 5 players per hero, chosen automatically
//                                          from the Phantom+ scoreboard (see selectValidationPlayers)   (VALIDATION ONLY)
//   public/data/img/{items,heroes,abilities,corrupted,props}/  images so the app needs no network at all
//   public/data/hero-stats.json            per-hero wins + matches, Phantom+ (badge >= 90), same window; feeds the tier list
//   public/data/item-stats.json            per-item wins + matches over every hero (Phantom+, same window) and per corrupted
//                                          item (all ranks, games >= 30 min, since corrupted items came out); feeds the item tier lists
//   public/data/manifest.json              timestamps + counts + validation_sets (who was selected and why)
//
// Flags
//   --analytics-only            refresh analytics/* only
//   --abilities-only            refresh abilities.json, ability images and the tooltip stat icons only
//   --hero-stats-only           refresh hero-stats.json and item-stats.json only (a few seconds)
//   --sell-stats-only           refresh only the sell stats inside analytics/* (top.sell_stats; --heroes works)
//   --charge-orders-only        refresh only the charge-item ability sequences inside analytics/* (item_ability_order_stats; --heroes works)
//   --corrupted-only            refresh only the corrupted-item stats inside analytics/* (corrupted; --heroes works)
//   --imbues-only               refresh only the imbue targets inside analytics/* (imbue_targets; --heroes works)
//   --validation-only           re-select players and refetch validation/* for every hero
//   --since 2026-09-29T20:00Z   (with --analytics-only) only use games from this time on, e.g. a patch going live; the
//                               hero's analytics file records it (min_unix_timestamp) and the Details dialog shows it
//   --heroes 1,31               (with --validation-only or --analytics-only) only these hero ids; with --validation-only their entries are merged into manifest.validation_sets
//   --select-only               (with --validation-only) run the selection, print the table per hero, write nothing
//   --matchups 6:20,12,50;60:3,17,20   opt-in enemy-counter experiment fetch (plans/matchup-builds.md).
//                                Repeatable per hero (';'-separated groups, enemies ','-separated); writes
//                                public/data/analytics/matchups/<heroId>.json plus the -badge70/-allranks(/-allranks60d)
//                                populations it compared to choose that rung. Does not touch the normal fetch.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const API = 'https://api.deadlock-api.com';
import { detectStyles, usageOf, STYLE } from './styles.mjs';
const ASSETS = `${API}/v1/assets`; // assets.deadlock-api.com was retired (NXDOMAIN) by 2026-09
const OUT = path.resolve('public/data');
// Held-out validation sets: for every active hero, VALIDATION_PLAYERS_PER_HERO top players chosen
// automatically by selectValidationPlayers(). Never read by the generator.
const VALIDATION_PLAYERS_PER_HERO = 5;
// Matches (matchmaking only, most recent first) fetched per selected (player, hero).
const VALIDATION_MATCH_TARGET = 20;
// Candidate pool per hero: the top N Phantom+ players by matches on the hero in the analytics window.
const VALIDATION_CANDIDATES = 25;
// Filters: a candidate needs at least this many recent games on the hero ...
const VALIDATION_MIN_RECENT = 5;
// ... and, once the sample is big enough (>= VALIDATION_WR_MIN_MATCHES), a recent win rate of at least this.
const VALIDATION_MIN_WINRATE = 0.4;
const VALIDATION_WR_MIN_MATCHES = 10;
// Score = recent_matches * (1 + EXPERIENCE_WEIGHT * ln(1 + total_hero_matches)) * recencyFactor,
// recencyFactor = exp(-daysSince(last_played) / RECENCY_HALFLIFE_DAYS) clamped to [RECENCY_FLOOR, 1].
const VALIDATION_EXPERIENCE_WEIGHT = 0.15;
const VALIDATION_RECENCY_DAYS = 14;
const VALIDATION_RECENCY_FLOOR = 0.25;
const VALIDATION_ONLY = process.argv.includes('--validation-only');
const SELECT_ONLY = process.argv.includes('--select-only');
// `--heroes 1,31` limits --validation-only to those hero ids (entries are merged into the existing manifest).
const HEROES_ARG = (() => {
  const i = process.argv.indexOf('--heroes');
  if (i < 0 || !process.argv[i + 1]) return null;
  return process.argv[i + 1]
    .split(',')
    .map((x) => Number(x.trim()))
    .filter((x) => Number.isFinite(x));
})();
// Analytics window: last 30 days (live data; the window is recorded in manifest.json).
const WINDOW_DAYS = 30;
// High-rank population: average lobby badge >= 90 (Phantom and above). Chosen as the highest bracket
// where all three analytics endpoints are still well populated for every hero (Ascendant+ leaves
// ability-order sequences with <100 matches). Builds are generated from this population when it is
// large enough, so they follow what top-rank players actually buy rather than the all-rank average.
const TOP_BADGE = 90;
// `--analytics-only` refreshes only public/data/analytics/* from the existing heroes.json.
const ANALYTICS_ONLY = process.argv.includes('--analytics-only');
// A 429 on match metadata can ask for an hour-long retry-after; wait at most this long, then throw so the
// caller skips that match and moves on to the next one (there are more candidates than the target).
const MAX_WAIT_MS = 45 * 1000;
let MIN_TS = Math.floor(Date.now() / 1000) - WINDOW_DAYS * 86400;
const SINCE_ARG = (() => {
  const i = process.argv.indexOf('--since');
  if (i < 0) return null;
  const t = Date.parse(process.argv[i + 1] ?? '');
  if (!Number.isFinite(t)) throw new Error(`--since: bad date ${process.argv[i + 1]}`);
  return Math.floor(t / 1000);
})();
// Rate limit is 200 req / 60 s -> ~350 ms between requests keeps us well under.
const SLEEP_MS = 350;

// `--matchups <heroId>:<e1,e2,...>` (repeatable, ';'-separated; a hero repeated across groups has its
// enemy sets unioned so it is only fetched once). Parses to Map<heroId, Set<enemyId>>, or null.
const MATCHUPS_ARG = (() => {
  const i = process.argv.indexOf('--matchups');
  if (i < 0 || !process.argv[i + 1]) return null;
  const byHero = new Map();
  for (const group of process.argv[i + 1].split(';').filter(Boolean)) {
    const [heroStr, enemiesStr] = group.split(':');
    const heroId = Number(heroStr);
    if (!Number.isFinite(heroId)) continue;
    if (!byHero.has(heroId)) byHero.set(heroId, new Set());
    for (const e of (enemiesStr || '')
      .split(',')
      .map((x) => Number(x.trim()))
      .filter(Number.isFinite))
      byHero.get(heroId).add(e);
  }
  return byHero.size ? byHero : null;
})();
// Matchup widening ladder (plans/matchup-builds.md step 1): rung 1 is badge>=70/30d; if that rung has
// fewer than MATCHUP_MIN_ITEMS items with >=MATCHUP_MIN_MATCHES matches against every enemy, widen to
// all-ranks/30d; if still thin, widen to all-ranks/60d, with min_unix_timestamp clamped to not go
// earlier than MATCHUP_LAST_PATCH_TS.
const MATCHUP_MIN_BADGE = 70;
const MATCHUP_MIN_ITEMS = 60;
const MATCHUP_MIN_MATCHES = 500;
const MATCHUP_WIDE_DAYS = 60;
// Best-effort floor for the widened 60-day window: we do not have a reliable "last major patch" feed
// in this pipeline, so this is a conservative placeholder (90 days back from whenever this file is
// read) rather than a real patch date — adjust if a real patch-date source becomes available.
const MATCHUP_LAST_PATCH_TS = Math.floor(Date.now() / 1000) - 90 * 86400;

const slimStat = (s) => ({ item_id: s.item_id, wins: s.wins, matches: s.matches });

// One item-stats population (`all` + per-enemy `vs`) for one hero at a given rung.
async function fetchMatchupPopulation(heroId, enemies, { minBadge, windowDays, clampToPatch }) {
  let minTs = Math.floor(Date.now() / 1000) - windowDays * 86400;
  if (clampToPatch) minTs = Math.max(minTs, MATCHUP_LAST_PATCH_TS);
  const badgeQ = minBadge != null ? `&min_average_badge=${minBadge}` : '';
  const q = `hero_id=${heroId}&min_unix_timestamp=${minTs}${badgeQ}`;
  const all = (await getJson(`${API}/v1/analytics/item-stats?${q}`)).map(slimStat);
  const vs = {};
  for (const e of enemies) vs[e] = (await getJson(`${API}/v1/analytics/item-stats?${q}&enemy_hero_ids=${e}`)).map(slimStat);
  return { hero_id: heroId, population: { min_badge: minBadge ?? null, window_days: windowDays }, all, vs };
}

// Fewest items with >=MATCHUP_MIN_MATCHES against any single enemy — the binding constraint the
// widening ladder checks (plan: "fewer than ~60 items have >=500 matches vs an enemy").
const matchupMinCount = (pop, enemies) => Math.min(...enemies.map((e) => (pop.vs[e] || []).filter((r) => r.matches >= MATCHUP_MIN_MATCHES).length));

async function fetchMatchupsForHero(heroId, enemies) {
  const badge70 = await fetchMatchupPopulation(heroId, enemies, { minBadge: MATCHUP_MIN_BADGE, windowDays: WINDOW_DAYS, clampToPatch: false });
  await save(`analytics/matchups/${heroId}-badge70.json`, badge70);
  const allRanks = await fetchMatchupPopulation(heroId, enemies, { minBadge: null, windowDays: WINDOW_DAYS, clampToPatch: false });
  await save(`analytics/matchups/${heroId}-allranks.json`, allRanks);

  let chosen = badge70,
    rung = 'badge70';
  if (matchupMinCount(badge70, enemies) < MATCHUP_MIN_ITEMS) {
    chosen = allRanks;
    rung = 'allranks';
  }
  if (matchupMinCount(chosen, enemies) < MATCHUP_MIN_ITEMS) {
    const wide = await fetchMatchupPopulation(heroId, enemies, { minBadge: null, windowDays: MATCHUP_WIDE_DAYS, clampToPatch: true });
    await save(`analytics/matchups/${heroId}-allranks60d.json`, wide);
    chosen = wide;
    rung = 'allranks60d';
  }
  console.log(`   hero ${heroId}: matchup rung used = ${rung} (min items >=${MATCHUP_MIN_MATCHES} matches vs any enemy: ${matchupMinCount(chosen, enemies)})`);
  await save(`analytics/matchups/${heroId}.json`, chosen);
  return { heroId, enemies, rung };
}

async function fetchMatchups(byHero) {
  console.log(`matchups-only: ${byHero.size} hero(es), ${[...byHero.values()].reduce((a, s) => a + s.size, 0)} enemy pairing(s) total`);
  const results = [];
  for (const [heroId, enemiesSet] of byHero) results.push(await fetchMatchupsForHero(heroId, [...enemiesSet]));
  console.log('done', results);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (res.status === 429 || res.status >= 500) {
        // retry-after can be an hour on the match-metadata endpoint; cap it and let the caller skip the row
        // match metadata is limited to a few calls per hour per IP: honour its retry-after up to MAX_WAIT_MS there
        const maxWait = url.includes('/metadata') ? MAX_WAIT_MS : 60000;
        const asked = Number(res.headers.get('retry-after') || 0) * 1000 || 2000 * (i + 1);
        if (res.status === 429 && asked > maxWait) throw new Error(`429 retry-after ${Math.round(asked / 1000)}s for ${url}`);
        const wait = Math.min(maxWait, asked);
        console.warn(`  ${res.status} on ${url} – waiting ${wait}ms`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
      const j = await res.json();
      await sleep(SLEEP_MS);
      return j;
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(1500 * (i + 1));
    }
  }
}

// Downloads an image once into public/data/img/<dir>/<id>.webp and returns the app-relative path.
async function saveImage(url, dir, id, suffix = '') {
  if (!url) return undefined;
  const rel = `img/${dir}/${id}${suffix}.webp`;
  const f = path.join(OUT, rel);
  await mkdir(path.dirname(f), { recursive: true });
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`${res.status}`);
    await writeFile(f, Buffer.from(await res.arrayBuffer()));
    await sleep(40);
    return rel;
  } catch (e) {
    console.warn(`  image failed ${url}: ${e.message}`);
    return undefined;
  }
}

const save = async (rel, data) => {
  const f = path.join(OUT, rel);
  await mkdir(path.dirname(f), { recursive: true });
  await writeFile(f, JSON.stringify(data));
  console.log(`wrote ${rel}`);
};

// Keep only fields the app needs; the SVG-heavy description blobs are kept
// because the item card renders their text.
function slimItem(it) {
  const props = {};
  for (const [k, v] of Object.entries(it.properties || {})) {
    props[k] = { value: v.value, label: v.label, postfix: v.postfix, prefix: v.prefix, css_class: v.css_class };
  }
  return {
    id: it.id,
    class_name: it.class_name,
    name: it.name,
    cost: it.cost ?? 0,
    item_tier: it.item_tier,
    item_slot_type: it.item_slot_type,
    shopable: !!it.shopable,
    disabled: !!it.disabled,
    is_active_item: !!it.is_active_item,
    activation: it.activation,
    component_items: it.component_items || [],
    shop_image_webp: it.shop_image_webp || it.image_webp,
    image_webp: it.image_webp,
    description: it.description || {},
    tooltip_sections: it.tooltip_sections || [],
    properties: props,
  };
}

function slimHero(h) {
  return {
    id: h.id,
    name: h.name,
    class_name: h.class_name,
    description: h.description,
    images: { small: h.images?.icon_image_small_webp, card: h.images?.icon_hero_card_webp },
    starting_stats: Object.fromEntries(Object.entries(h.starting_stats || {}).map(([k, v]) => [k, v.value])),
    standard_level_up_upgrades: h.standard_level_up_upgrades || {},
    level_info: h.level_info || {},
    abilities: [h.items?.signature1, h.items?.signature2, h.items?.signature3, h.items?.signature4].filter(Boolean),
    gun_tag: h.gun_tag,
    tags: h.tags,
  };
}

// Keeps what the ability tooltip needs: stat labels and icons, the tooltip's stat blocks, the per-tier
// upgrade text (t1_desc..t3_desc, missing on some tiers; the app then writes it from the stat bonuses).
// Inline <svg> icons in the tooltip text are dropped (the app colours the label after them instead).
// The scale kind sits in specific_stat_scale_type / scaling_stats, or only in the scale function's class name
// (Afterburn's damage and burn time, every charge count).
const SCALE_BY_CLASS = {
  scale_function_tech_damage: 'ETechPower',
  scale_function_healing_spirit_scale: 'ETechPower',
  scale_function_tech_duration: 'ETechDuration',
  scale_function_tech_range: 'ETechRange',
  scale_function_ability_charges: 'EMaxChargesIncrease',
  scale_function_ability_recharge_time: 'ETechCooldownBetweenChargeUses',
};
function scaleOf(k, f) {
  if (!f) return null;
  const own = f.specific_stat_scale_type || (f.scaling_stats?.length ? f.scaling_stats : null);
  if (own) return own;
  const kind = SCALE_BY_CLASS[f.class_name] ?? null;
  return kind === 'ETechRange' && /radius/i.test(k) ? 'ETechRadius' : kind;
}
const noSvg = (s) => (typeof s === 'string' ? s.replace(/<svg[\s\S]*?<\/svg>\s*/gi, '') : s);
function slimAbility(a) {
  const d = Object.fromEntries(Object.entries(a.description || {}).map(([k, v]) => [k, noSvg(v)]));
  const td = a.tooltip_details || {};
  return {
    id: a.id,
    class_name: a.class_name,
    name: a.name,
    hero: a.hero,
    image_webp: a.image_webp,
    ability_type: a.ability_type,
    description: d.desc || '',
    quip: d.quip,
    tier_desc: [d.t1_desc, d.t2_desc, d.t3_desc].map((x) => x || ''),
    active: d.active,
    passive: d.passive,
    upgrades: (a.upgrades || []).map((u) =>
      (u.property_upgrades || []).map((p) => ({ name: p.name, bonus: String(p.bonus), ...(p.upgrade_type ? { type: p.upgrade_type } : {}) })),
    ),
    properties: Object.fromEntries(
      Object.entries(a.properties || {})
        .filter(([, v]) => v && v.value !== undefined)
        .map(([k, v]) => [
          k,
          {
            value: v.value,
            scale: scaleOf(k, v.scale_function),
            stat_scale: v.scale_function?.stat_scale,
            label: v.label,
            prefix: v.prefix,
            postfix: v.postfix,
            css_class: v.css_class,
            icon: v.icon,
            disable_value: v.disable_value,
          },
        ]),
    ),
    tooltip: {
      header: td.additional_header_properties,
      sections: (td.info_sections || []).map((sec) => ({
        text: noSvg(sec.loc_string),
        requires: sec.property_upgrade_required,
        blocks: (sec.properties_block || []).map((b) => ({
          title: noSvg(b.loc_string),
          props: (b.properties || []).map((p) => ({
            key: p.important_property,
            status: p.status_effect_name,
            status_value: p.status_effect_value,
            show_value: p.show_property_value,
            icon: p.important_property_icon,
          })),
        })),
        basic: sec.basic_properties,
      })),
    },
  };
}

// Stat icons used by the ability tooltips, saved once under img/props/ (svg or png, as served).
async function saveAbilityIcons(abilities) {
  const local = new Map();
  const save1 = async (url) => {
    if (!url || local.has(url)) return local.get(url);
    const rel = `img/props/${path.basename(new URL(url).pathname)}`;
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`${res.status}`);
      await mkdir(path.join(OUT, 'img/props'), { recursive: true });
      await writeFile(path.join(OUT, rel), Buffer.from(await res.arrayBuffer()));
      local.set(url, rel);
    } catch (e) {
      console.warn(`  icon failed ${url}: ${e.message}`);
      local.set(url, undefined);
    }
    return local.get(url);
  };
  for (const a of abilities) {
    for (const p of Object.values(a.properties)) p.icon = await save1(p.icon);
    for (const s of a.tooltip.sections) for (const b of s.blocks) for (const p of b.props) p.icon = await save1(p.icon);
  }
  console.log(`   ${[...local.values()].filter(Boolean).length} stat icons`);
}

async function fetchAbilities(heroes) {
  const abilitiesRaw = await getJson(`${ASSETS}/items/by-type/ability`);
  const heroIds = new Set(heroes.map((h) => h.id));
  const sigNames = new Set(heroes.flatMap((h) => h.abilities));
  const abilities = abilitiesRaw.filter((a) => heroIds.has(a.hero)).map(slimAbility);
  for (const a of abilities) {
    if (!sigNames.has(a.class_name)) {
      // innates (zipline, mantle...) are never shown: keep only what the generator reads
      delete a.tooltip;
      for (const p of Object.values(a.properties)) for (const k of Object.keys(p)) if (k !== 'value' && k !== 'scale') delete p[k];
      continue;
    }
    const l = await saveImage(a.image_webp, 'abilities', a.id);
    if (l) a.image_webp = l;
  }
  await saveAbilityIcons(abilities.filter((a) => a.tooltip));
  await save('abilities.json', abilities);
  return abilities;
}

async function fetchPopulation(heroId, extra = '') {
  const q = `hero_id=${heroId}&min_unix_timestamp=${MIN_TS}${extra}`;
  const [item_stats, ability_order_stats, permutation_stats] = await Promise.all([
    getJson(`${API}/v1/analytics/item-stats?${q}`),
    getJson(`${API}/v1/analytics/ability-order-stats?${q}&min_matches=5`),
    getJson(`${API}/v1/analytics/item-permutation-stats?${q}&comb_size=2`),
  ]);
  // Ability sequences and pair stats are very large (10k+ rows); keep the most-played rows.
  const abilitySeqs = [...ability_order_stats].sort((a, b) => b.matches - a.matches).slice(0, 400);
  const pairs = [...permutation_stats].sort((a, b) => b.matches - a.matches).slice(0, 600);
  return { item_stats, ability_order_stats: abilitySeqs, permutation_stats: pairs };
}

// Build styles. For every candidate anchor item we fetch the hero's item stats CONDITIONAL on that
// item having been bought (include_item_ids). detectStyles() picks the anchors whose games look
// materially different from the population (see scripts/styles.mjs). Each detected style then gets its
// own item + ability-order population (include the style's seed item); the main style is the population
// with every alternative anchor excluded, so each build is generated from games played its way.
async function fetchStyles(hero, topQ, top, shopIds) {
  const { n: N, u } = usageOf(top.item_stats.filter((s) => shopIds.has(s.item_id)));
  const cands = [...u].filter(([, x]) => x >= STYLE.candidateShare[0] && x <= STYLE.candidateShare[1]).map(([id]) => id);
  const conditional = {};
  for (const id of cands)
    conditional[id] = (await getJson(`${API}/v1/analytics/item-stats?${topQ}&include_item_ids=${id}`)).filter((s) => shopIds.has(s.item_id));
  const found = detectStyles(
    top.item_stats.filter((s) => shopIds.has(s.item_id)),
    conditional,
  );
  if (!found.length) return { styles: [], scanned: cands.length };
  const population = async (filter) => {
    const [item_stats, ability_order_stats] = await Promise.all([
      getJson(`${API}/v1/analytics/item-stats?${topQ}${filter}`),
      getJson(`${API}/v1/analytics/ability-order-stats?${topQ}${filter}&min_matches=5`),
    ]);
    return { item_stats, ability_order_stats: [...ability_order_stats].sort((a, b) => b.matches - a.matches).slice(0, 400) };
  };
  const excluded = found.flatMap((s) => s.anchors);
  const main = await population(`&exclude_item_ids=${excluded.join(',')}`);
  const styles = [{ key: 'main', seed: null, anchors: [], exclude: excluded, matches: Math.max(0, ...main.item_stats.map((s) => s.matches)), ...main }];
  for (const s of found) {
    const pop = await population(`&include_item_ids=${s.seed}`);
    styles.push({
      key: `style-${s.seed}`,
      seed: s.seed,
      anchors: s.anchors,
      exclude: [],
      matches: Math.max(0, ...pop.item_stats.map((s) => s.matches)),
      ...pop,
    });
  }
  for (const s of styles) s.share = s.matches / N;
  return { styles, scanned: cands.length };
}

// Charge-item ability sequences. Players who buy a passive item that adds ability charges (Extra Charge, Rapid
// Recharge...) level the abilities those charges go on much earlier, so the generator takes a charge build's
// ability order from only those games. For the high-rank population and each style, for every charge item the
// hero buys in enough games, fetch the ability sequences of the games where it was bought (on top of the
// style's own filter). Stored as item_ability_order_stats keyed by item id.
const CHARGE_MIN_MATCHES = 200;
async function fetchChargeOrders(heroes) {
  const targets = HEROES_ARG ? heroes.filter((h) => HEROES_ARG.includes(h.id)) : heroes;
  const items = JSON.parse(await readFile(path.join(OUT, 'items.json'), 'utf8'));
  const chargeIds = items
    .filter((i) => i.shopable && !i.disabled && !i.is_active_item && parseFloat(i.properties?.BonusAbilityCharges?.value ?? 0) > 0)
    .map((i) => i.id);
  console.log(`charge-item ability sequences (${targets.length} heroes, items ${chargeIds.join(',')})`);
  for (const h of targets) {
    const file = path.join(OUT, 'analytics', `${h.id}.json`);
    const a = JSON.parse(await readFile(file, 'utf8'));
    if (!a.top) continue;
    const since = a.min_unix_timestamp ?? MIN_TS; // a hero refetched with --since keeps that window
    const topQ = `hero_id=${h.id}&min_unix_timestamp=${since}&min_average_badge=${TOP_BADGE}`;
    const fetchFor = async (pop, filter, seed) => {
      const out = {};
      for (const id of chargeIds) {
        if ((pop.item_stats.find((s) => s.item_id === id)?.matches ?? 0) < CHARGE_MIN_MATCHES) continue;
        // a style seeded on the charge item already is that population
        const rows = id === seed ? pop.ability_order_stats : await getJson(`${API}/v1/analytics/ability-order-stats?${topQ}${filter(id)}&min_matches=5`);
        out[id] = [...rows].sort((x, y) => y.matches - x.matches).slice(0, 400);
      }
      return out;
    };
    a.top.item_ability_order_stats = await fetchFor(a.top, (id) => `&include_item_ids=${id}`, null);
    // all ranks too: the generator falls back to it when high-rank sequences are too thin (e.g. right after a patch)
    const allQ = `hero_id=${h.id}&min_unix_timestamp=${since}`;
    a.item_ability_order_stats = {};
    for (const id of chargeIds) {
      if ((a.item_stats.find((s) => s.item_id === id)?.matches ?? 0) < CHARGE_MIN_MATCHES) continue;
      const rows = await getJson(`${API}/v1/analytics/ability-order-stats?${allQ}&include_item_ids=${id}&min_matches=5`);
      a.item_ability_order_stats[id] = [...rows].sort((x, y) => y.matches - x.matches).slice(0, 400);
    }
    for (const st of a.top.styles ?? []) {
      st.item_ability_order_stats = await fetchFor(
        st,
        (id) => (st.seed === null ? `&exclude_item_ids=${st.exclude.join(',')}&include_item_ids=${id}` : `&include_item_ids=${st.seed},${id}`),
        st.seed,
      );
    }
    console.log(
      `   ${h.name}: ${Object.keys(a.top.item_ability_order_stats).length} charge item(s), ${Object.keys(a.item_ability_order_stats).length} all-rank`,
    );
    await save(`analytics/${h.id}.json`, a);
  }
}

// Sell stats: how often top players sell an item to make room, as opposed to keeping it or turning it
// into an upgrade. The item-stats endpoints only give an average sell time over the games where it was
// sold (an upgrade counts as a sale), so this counts it from a sample of recent high-rank games instead.
// Only per-item totals are stored. Validation panel players' rows are left out so the panel stays held out.
const SELL_SAMPLE_MATCHES = 300;
async function fetchSellStats(heroId, items, panelIds, since = MIN_TS) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const q = `hero_ids=${heroId}&min_average_badge=${TOP_BADGE}&min_unix_timestamp=${since}&game_mode=normal&include_player_items=true&limit=${SELL_SAMPLE_MATCHES}`;
  const matches = await getJson(`${API}/v1/matches/metadata?${q}`);
  const acc = new Map();
  let players = 0;
  for (const m of matches)
    for (const p of m.players || []) {
      if (p.hero_id !== heroId || panelIds.has(p.account_id)) continue;
      players++;
      const bought = (p.items || []).filter((it) => byId.has(it.item_id));
      const seen = new Set();
      for (const it of bought) {
        if (seen.has(it.item_id)) continue; // first purchase only
        seen.add(it.item_id);
        const a = acc.get(it.item_id) ?? { item_id: it.item_id, buyers: 0, sold: 0, upgraded: 0, sold_time_sum: 0 };
        a.buyers++;
        if (it.sold_time_s > 0) {
          // the game records an upgrade as selling the component at the moment the upgrade is bought
          const cls = byId.get(it.item_id).class_name;
          const upgraded = bought.some((o) => (byId.get(o.item_id).component_items || []).includes(cls) && Math.abs(o.game_time_s - it.sold_time_s) <= 2);
          if (upgraded) a.upgraded++;
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
  return { players, matches: matches.length, items: rows };
}

async function fetchAllSellStats(heroes, manifest) {
  const targets = HEROES_ARG ? heroes.filter((h) => HEROES_ARG.includes(h.id)) : heroes;
  console.log(`sell stats (${targets.length} heroes, ${SELL_SAMPLE_MATCHES} recent badge>=${TOP_BADGE} games each)`);
  const items = JSON.parse(await readFile(path.join(OUT, 'items.json'), 'utf8')).filter((i) => i.shopable && !i.disabled && i.cost > 0);
  const panelIds = new Set((manifest.validation_sets || []).map((v) => v.account_id));
  for (const h of targets) {
    const file = path.join(OUT, `analytics/${h.id}.json`);
    const analytics = JSON.parse(await readFile(file, 'utf8'));
    const sell = await fetchSellStats(h.id, items, panelIds, analytics.min_unix_timestamp ?? MIN_TS);
    console.log(
      `   ${h.name}: ${sell.players} players; sold for room in >=30%: ${
        sell.items
          .filter((r) => r.buyers >= 30 && r.sold / r.buyers >= 0.3)
          .map((r) => items.find((i) => i.id === r.item_id).name)
          .join(', ') || 'none'
      }`,
    );
    analytics.top = { ...analytics.top, sell_stats: sell };
    await save(`analytics/${h.id}.json`, analytics);
  }
  manifest.sell_stats_fetched_at = new Date().toISOString();
}

// Corrupted items (the Broker swaps a T3/T4 item for a corrupted copy with a random penalty, free, from
// about minute 30). For each item: games where the hero ran the corrupted copy vs games with the normal
// copy, both limited to games that lasted >= 30 min so the normal side also reached the Broker. All ranks:
// at Phantom+ there are too few corrupted games yet. Since the corrupted launch only.
// the 09-29-2026 patch went live ~19:30 UTC (first corrupted buys); 20:00 keeps pre-patch games out
const CORRUPTED_SINCE = Math.floor(Date.UTC(2026, 8, 29, 20) / 1000);
const CORRUPTED_MIN_DURATION_S = 1800;
async function fetchCorruptedStats(heroes) {
  const targets = HEROES_ARG ? heroes.filter((h) => HEROES_ARG.includes(h.id)) : heroes;
  console.log(`corrupted stats (${targets.length} heroes, all ranks, games >= ${CORRUPTED_MIN_DURATION_S / 60} min)`);
  for (const h of targets) {
    const q = `hero_id=${h.id}&min_unix_timestamp=${CORRUPTED_SINCE}&min_duration_s=${CORRUPTED_MIN_DURATION_S}`;
    const [only, normal] = await Promise.all([
      getJson(`${API}/v1/analytics/item-stats?${q}&corrupted_items=only`),
      getJson(`${API}/v1/analytics/item-stats?${q}&corrupted_items=exclude`),
    ]);
    const byId = new Map(normal.map((r) => [r.item_id, r]));
    const items = only
      .filter((r) => r.matches > 0)
      .map((r) => ({
        item_id: r.item_id,
        corrupted: { wins: r.wins, matches: r.matches, avg_buy_time_s: Math.round(r.avg_buy_time_s ?? 0) },
        normal: { wins: byId.get(r.item_id)?.wins ?? 0, matches: byId.get(r.item_id)?.matches ?? 0 },
      }));
    const file = path.join(OUT, `analytics/${h.id}.json`);
    const analytics = JSON.parse(await readFile(file, 'utf8'));
    analytics.corrupted = { since_unix_timestamp: CORRUPTED_SINCE, min_duration_s: CORRUPTED_MIN_DURATION_S, items };
    await save(`analytics/${h.id}.json`, analytics);
    console.log(`   ${h.name}: ${items.reduce((a, r) => a + r.corrupted.matches, 0)} corrupted purchases over ${items.length} items`);
  }
}

// Imbue targets: an imbue item (Quicksilver Reload, Duration Extender...) goes on one ability. Match data does not
// say which, but published builds do (imbue_target_ability_id). Count, per item, the ability set by the hero's most
// favorited builds (latest version of each); builds that leave it unset do not count.
const IMBUE_BUILDS = 500;
async function fetchImbueTargets(heroes) {
  const targets = HEROES_ARG ? heroes.filter((h) => HEROES_ARG.includes(h.id)) : heroes;
  console.log(`imbue targets (${targets.length} heroes, top ${IMBUE_BUILDS} published builds each)`);
  for (const h of targets) {
    const builds = await getJson(`${API}/v1/builds?hero_id=${h.id}&limit=${IMBUE_BUILDS}&sort_by=favorites&only_latest=true`);
    const counts = new Map(); // item id -> ability id -> builds
    for (const b of builds) {
      const seen = new Set(); // one vote per build and item
      for (const c of b.hero_build?.details?.mod_categories ?? [])
        for (const m of c.mods ?? []) {
          if (!m.imbue_target_ability_id || seen.has(m.ability_id)) continue;
          seen.add(m.ability_id);
          const per = counts.get(m.ability_id) ?? new Map();
          per.set(m.imbue_target_ability_id, (per.get(m.imbue_target_ability_id) ?? 0) + 1);
          counts.set(m.ability_id, per);
        }
    }
    const items = [...counts].map(([item_id, per]) => ({
      item_id,
      targets: [...per].map(([ability_id, n]) => ({ ability_id, builds: n })).sort((a, b) => b.builds - a.builds),
    }));
    const file = path.join(OUT, `analytics/${h.id}.json`);
    const analytics = JSON.parse(await readFile(file, 'utf8'));
    analytics.imbue_targets = { builds: builds.length, items };
    await save(`analytics/${h.id}.json`, analytics);
    console.log(
      `   ${h.name}: ${builds.length} builds, ${items.reduce((a, r) => a + r.targets.reduce((x, t) => x + t.builds, 0), 0)} imbue picks over ${items.length} items`,
    );
  }
}

// Tier list input: one request, every hero's wins and matches at badge >= TOP_BADGE over the snapshot window.
async function fetchHeroStats(heroes) {
  console.log(`hero win rates (badge>=${TOP_BADGE})`);
  const rows = await getJson(`${API}/v1/analytics/hero-stats?min_average_badge=${TOP_BADGE}&min_unix_timestamp=${MIN_TS}`);
  const byId = new Map(rows.map((r) => [r.hero_id, r]));
  const missing = heroes.filter((h) => !byId.has(h.id)).map((h) => h.name);
  if (missing.length) throw new Error(`hero-stats has no row for: ${missing.join(', ')}`);
  await save('hero-stats.json', {
    fetched_at: new Date().toISOString(),
    min_average_badge: TOP_BADGE,
    min_unix_timestamp: MIN_TS,
    window_days: WINDOW_DAYS,
    heroes: heroes.map((h) => ({ hero_id: h.id, wins: byId.get(h.id).wins, matches: byId.get(h.id).matches })),
  });
}

// Item tier list input: every item's wins and matches over all heroes. Normal copies use the tier list's population
// (Phantom+, snapshot window); corrupted copies are too new for that, so they use the corrupted-stats population.
async function fetchItemStats() {
  console.log(`item win rates, all heroes (badge>=${TOP_BADGE}; corrupted: all ranks, games >= ${CORRUPTED_MIN_DURATION_S / 60} min)`);
  const [normal, corrupted] = await Promise.all([
    getJson(`${API}/v1/analytics/item-stats?min_average_badge=${TOP_BADGE}&min_unix_timestamp=${MIN_TS}&corrupted_items=exclude`),
    getJson(`${API}/v1/analytics/item-stats?min_unix_timestamp=${CORRUPTED_SINCE}&min_duration_s=${CORRUPTED_MIN_DURATION_S}&corrupted_items=only`),
  ]);
  const slim = (rows) => rows.filter((r) => r.matches > 0).map((r) => ({ item_id: r.item_id, wins: r.wins, matches: r.matches }));
  await save('item-stats.json', {
    fetched_at: new Date().toISOString(),
    min_average_badge: TOP_BADGE,
    min_unix_timestamp: MIN_TS,
    window_days: WINDOW_DAYS,
    corrupted_since_unix_timestamp: CORRUPTED_SINCE,
    corrupted_min_duration_s: CORRUPTED_MIN_DURATION_S,
    items: slim(normal),
    corrupted: slim(corrupted),
  });
}

async function fetchAnalytics(heroes, manifest) {
  const targets = HEROES_ARG ? heroes.filter((h) => HEROES_ARG.includes(h.id)) : heroes;
  console.log(`4/5 per-hero analytics (${targets.length} heroes, all ranks + badge>=${TOP_BADGE}, plus build styles)`);
  const shopIds = new Set(
    JSON.parse(await readFile(path.join(OUT, 'items.json'), 'utf8'))
      .filter((i) => i.shopable && !i.disabled && i.cost > 0)
      .map((i) => i.id),
  );
  for (const h of targets) {
    const all = await fetchPopulation(h.id);
    const topQ = `hero_id=${h.id}&min_unix_timestamp=${MIN_TS}&min_average_badge=${TOP_BADGE}`;
    const top = await fetchPopulation(h.id, `&min_average_badge=${TOP_BADGE}`);
    const topMatches = Math.max(0, ...top.item_stats.map((s) => s.matches));
    const { styles, scanned } = await fetchStyles(h, topQ, top, shopIds);
    console.log(
      `   ${h.name}: top-rank max item matches ${topMatches}; ${scanned} anchors scanned, ${Math.max(0, styles.length - 1)} alternative style(s)${
        styles.length
          ? ': ' +
            styles
              .slice(1)
              .map((s) => `${s.seed} ${(s.share * 100).toFixed(0)}%`)
              .join(', ')
          : ''
      }`,
    );
    await save(`analytics/${h.id}.json`, {
      hero_id: h.id,
      ...(SINCE_ARG ? { min_unix_timestamp: SINCE_ARG } : {}),
      ...all,
      top: { min_average_badge: TOP_BADGE, ...top, styles },
    });
  }
  manifest.counts.analytics_heroes = heroes.length;
  manifest.top_min_average_badge = TOP_BADGE;
}

// Steps 1-4 of the selection for one hero: scoreboard candidates -> hero-stats -> score/filter -> names.
async function selectValidationPlayers(hero, since, histories) {
  const board = async (from) => {
    const base = `${API}/v1/analytics/scoreboards/players?hero_id=${hero.id}&min_average_badge=${TOP_BADGE}&min_unix_timestamp=${from}&limit=${VALIDATION_CANDIDATES}`;
    return [await getJson(`${base}&sort_by=matches`), await getJson(`${base}&sort_by=wins`)];
  };
  let [byMatches, byWins] = await board(since);
  let wins = new Map(byWins.map((r) => [r.account_id, r.value]));
  // Right after a patch the scoreboard is empty (it needs a minimum of games per player): take the snapshot
  // window's top players and count only their games since the patch, from their match history.
  if (byMatches.length < VALIDATION_PLAYERS_PER_HERO && since > MIN_TS) {
    [byMatches] = await board(MIN_TS);
    wins = new Map();
    for (const r of byMatches) {
      const games = playable(await historyOf(r.account_id, histories), hero.id, since);
      r.matches = games.length;
      wins.set(r.account_id, games.filter((m) => m.match_result === m.player_team).length);
    }
    byMatches = byMatches.filter((r) => r.matches > 0);
  }
  const now = Date.now() / 1000;
  const cands = [];
  for (const r of byMatches) {
    const recent_matches = r.matches ?? r.value;
    const recent_wins = wins.get(r.account_id) ?? 0;
    let total_hero_matches = recent_matches,
      last_played = 0;
    try {
      const hs = await getJson(`${API}/v1/players/${r.account_id}/hero-stats`);
      const row = (hs || []).find((x) => x.hero_id === hero.id);
      if (row) {
        total_hero_matches = row.matches_played ?? recent_matches;
        last_played = row.last_played ?? 0;
      }
    } catch (e) {
      console.warn(`  hero-stats failed for ${r.account_id}: ${e.message}`);
    }
    const days = last_played ? Math.max(0, (now - last_played) / 86400) : VALIDATION_RECENCY_DAYS * 10;
    const recency = Math.min(1, Math.max(VALIDATION_RECENCY_FLOOR, Math.exp(-days / VALIDATION_RECENCY_DAYS)));
    const score = recent_matches * (1 + VALIDATION_EXPERIENCE_WEIGHT * Math.log(1 + total_hero_matches)) * recency;
    const wr = recent_matches ? recent_wins / recent_matches : 0;
    const passes = recent_matches >= VALIDATION_MIN_RECENT && !(recent_matches >= VALIDATION_WR_MIN_MATCHES && wr < VALIDATION_MIN_WINRATE);
    cands.push({ account_id: r.account_id, recent_matches, recent_wins, total_hero_matches, last_played, score, passes });
  }
  cands.sort((a, b) => b.score - a.score);
  let picked = cands.filter((c) => c.passes).slice(0, VALIDATION_PLAYERS_PER_HERO);
  if (picked.length < VALIDATION_PLAYERS_PER_HERO) {
    const need = VALIDATION_PLAYERS_PER_HERO - picked.length;
    const fill = cands.filter((c) => !c.passes).slice(0, need);
    console.warn(`  ${hero.name}: only ${picked.length} candidates pass the filters – filling ${fill.length} from the unfiltered top`);
    picked = [...picked, ...fill];
  }
  const names = new Map();
  if (picked.length) {
    try {
      const steam = await getJson(`${API}/v1/players/steam?account_ids=${picked.map((c) => c.account_id).join(',')}`);
      for (const p of steam || []) if (p.personaname) names.set(p.account_id, p.personaname);
    } catch (e) {
      console.warn(`  steam names failed: ${e.message}`);
    }
  }
  return picked.map((c, i) => ({
    account_id: c.account_id,
    player: names.get(c.account_id) || `#${c.account_id}`,
    hero_id: hero.id,
    hero: hero.name,
    selection: {
      rank: i + 1,
      recent_matches: c.recent_matches,
      recent_wins: c.recent_wins,
      total_hero_matches: c.total_hero_matches,
      last_played: c.last_played,
      score: Number(c.score.toFixed(2)),
    },
  }));
}

function printSelection(hero, sel) {
  console.log(`   ${hero.name} (${hero.id})`);
  console.table(
    sel.map((v) => ({
      rank: v.selection.rank,
      account_id: v.account_id,
      player: v.player,
      recent: v.selection.recent_matches,
      wins: v.selection.recent_wins,
      total: v.selection.total_hero_matches,
      last_played: new Date(v.selection.last_played * 1000).toISOString().slice(0, 10),
      score: v.selection.score,
    })),
  );
}

async function historyOf(accountId, histories) {
  if (!histories.has(accountId)) histories.set(accountId, await getJson(`${API}/v1/players/${accountId}/match-history`));
  return histories.get(accountId);
}
// normal-mode games on the hero from `since` on: unranked (1), private lobby (2), ranked (4); newest first
const playable = (hist, heroId, since) =>
  hist
    .filter((m) => m.hero_id === heroId && [1, 2, 4].includes(m.match_mode) && m.game_mode === 1 && m.start_time >= since)
    .sort((a, b) => b.start_time - a.start_time);

// Step 5: the player's most recent matchmaking matches on the hero, with per-match purchases.
async function fetchPlayerMatches(v, histories, since) {
  const hist = await historyOf(v.account_id, histories);
  const onHero = hist.filter((m) => m.hero_id === v.hero_id);
  const real = playable(hist, v.hero_id, since);
  const purchases = [];
  for (const m of real) {
    if (purchases.length >= VALIDATION_MATCH_TARGET) break;
    try {
      const meta = await getJson(`${API}/v1/matches/${m.match_id}/metadata`);
      const mi = meta.match_info;
      const p = (mi.players || []).find((x) => x.account_id === v.account_id);
      if (!p || !(p.items || []).length) continue; // no purchase data (abandon etc.): does not count toward the target
      purchases.push({
        match_id: m.match_id,
        start_time: mi.start_time,
        duration_s: mi.duration_s,
        match_mode: mi.match_mode,
        game_mode: mi.game_mode,
        won: p.team === mi.winning_team,
        net_worth: p.net_worth,
        items: (p.items || []).map((it) => ({ item_id: it.item_id, game_time_s: it.game_time_s, sold_time_s: it.sold_time_s })),
      });
    } catch (e) {
      console.warn(`  skip match ${m.match_id}: ${e.message}`);
    }
  }
  return { total_hero_matches: onHero.length, matchmaking_hero_matches: real.length, matches: purchases };
}

async function fetchValidation(heroes, manifest) {
  const targets = HEROES_ARG ? heroes.filter((h) => HEROES_ARG.includes(h.id)) : heroes;
  console.log(
    `5/5 held-out top-player matches (validation only): ${targets.length} heroes x ${VALIDATION_PLAYERS_PER_HERO} players x ${VALIDATION_MATCH_TARGET} matches${SELECT_ONLY ? ' [select-only]' : ''}`,
  );
  // a hero whose analytics were fetched with --since (a patch) is validated on games from then on only
  const sinceOf = new Map();
  for (const h of targets) {
    const a = JSON.parse(await readFile(path.join(OUT, 'analytics', `${h.id}.json`), 'utf8').catch(() => '{}'));
    sinceOf.set(h.id, SINCE_ARG ?? a.min_unix_timestamp ?? MIN_TS);
  }
  const histories = new Map();
  const selected = [];
  for (const h of targets) {
    const sel = await selectValidationPlayers(h, sinceOf.get(h.id), histories);
    printSelection(h, sel);
    selected.push(...sel);
  }
  if (SELECT_ONLY) return;
  const entries = [];
  for (const v of selected) {
    const data = await fetchPlayerMatches(v, histories, sinceOf.get(v.hero_id));
    const file = `validation/${v.account_id}-${v.hero_id}.json`;
    await save(file, { ...v, ...data });
    entries.push({ ...v, file, matches: data.matches.length });
  }
  const targetIds = new Set(targets.map((h) => h.id));
  const kept = HEROES_ARG ? (manifest.validation_sets || []).filter((v) => !targetIds.has(v.hero_id)) : [];
  manifest.validation_sets = [...kept, ...entries].sort((a, b) => a.hero_id - b.hero_id || a.selection?.rank - b.selection?.rank);
  manifest.counts.validation_sets = manifest.validation_sets.length;
  manifest.validation = { players_per_hero: VALIDATION_PLAYERS_PER_HERO, match_target: VALIDATION_MATCH_TARGET, selected_at: new Date().toISOString() };
  delete manifest.counts.zergggy_matches_with_purchases;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  if (MATCHUPS_ARG) {
    await fetchMatchups(MATCHUPS_ARG);
    return;
  }
  if (VALIDATION_ONLY) {
    const manifest = JSON.parse(await readFile(path.join(OUT, 'manifest.json'), 'utf8'));
    const heroes = JSON.parse(await readFile(path.join(OUT, 'heroes.json'), 'utf8'));
    MIN_TS = manifest.min_unix_timestamp;
    await fetchValidation(heroes, manifest);
    if (!SELECT_ONLY) await save('manifest.json', manifest);
    return;
  }
  if (process.argv.includes('--abilities-only')) {
    await fetchAbilities(JSON.parse(await readFile(path.join(OUT, 'heroes.json'), 'utf8')));
    return;
  }
  if (process.argv.includes('--hero-stats-only')) {
    const manifest = JSON.parse(await readFile(path.join(OUT, 'manifest.json'), 'utf8'));
    const heroes = JSON.parse(await readFile(path.join(OUT, 'heroes.json'), 'utf8'));
    MIN_TS = manifest.min_unix_timestamp;
    await fetchHeroStats(heroes);
    await fetchItemStats();
    return;
  }
  if (ANALYTICS_ONLY) {
    const manifest = JSON.parse(await readFile(path.join(OUT, 'manifest.json'), 'utf8'));
    const heroes = JSON.parse(await readFile(path.join(OUT, 'heroes.json'), 'utf8'));
    MIN_TS = SINCE_ARG ?? manifest.min_unix_timestamp; // keep the same window as the rest of the snapshot unless --since
    manifest.analytics_fetched_at = new Date().toISOString();
    await fetchAnalytics(heroes, manifest);
    await fetchChargeOrders(heroes);
    await fetchAllSellStats(heroes, manifest);
    await fetchCorruptedStats(heroes);
    manifest.corrupted_fetched_at = new Date().toISOString();
    await fetchImbueTargets(heroes);
    manifest.imbue_targets_fetched_at = new Date().toISOString();
    // the tier lists cover every hero, so a --heroes or --since run leaves them on the snapshot window
    if (!HEROES_ARG && !SINCE_ARG) {
      await fetchHeroStats(heroes);
      await fetchItemStats();
    }
    await save('manifest.json', manifest);
    return;
  }
  if (process.argv.includes('--charge-orders-only')) {
    const manifest = JSON.parse(await readFile(path.join(OUT, 'manifest.json'), 'utf8'));
    const heroes = JSON.parse(await readFile(path.join(OUT, 'heroes.json'), 'utf8'));
    MIN_TS = manifest.min_unix_timestamp;
    await fetchChargeOrders(heroes);
    manifest.charge_orders_fetched_at = new Date().toISOString();
    await save('manifest.json', manifest);
    return;
  }
  if (process.argv.includes('--corrupted-only')) {
    const manifest = JSON.parse(await readFile(path.join(OUT, 'manifest.json'), 'utf8'));
    const heroes = JSON.parse(await readFile(path.join(OUT, 'heroes.json'), 'utf8'));
    await fetchCorruptedStats(heroes);
    manifest.corrupted_fetched_at = new Date().toISOString();
    await save('manifest.json', manifest);
    return;
  }
  if (process.argv.includes('--imbues-only')) {
    const manifest = JSON.parse(await readFile(path.join(OUT, 'manifest.json'), 'utf8'));
    const heroes = JSON.parse(await readFile(path.join(OUT, 'heroes.json'), 'utf8'));
    await fetchImbueTargets(heroes);
    manifest.imbue_targets_fetched_at = new Date().toISOString();
    await save('manifest.json', manifest);
    return;
  }
  if (process.argv.includes('--sell-stats-only')) {
    const manifest = JSON.parse(await readFile(path.join(OUT, 'manifest.json'), 'utf8'));
    const heroes = JSON.parse(await readFile(path.join(OUT, 'heroes.json'), 'utf8'));
    MIN_TS = manifest.min_unix_timestamp;
    await fetchAllSellStats(heroes, manifest);
    await save('manifest.json', manifest);
    return;
  }
  const manifest = { fetched_at: new Date().toISOString(), min_unix_timestamp: MIN_TS, window_days: WINDOW_DAYS, counts: {} };

  console.log('1/5 item catalog');
  const items = (await getJson(`${ASSETS}/items/by-type/upgrade`)).map(slimItem);
  console.log(`   downloading ${items.length} item images`);
  for (const it of items) {
    it.remote_shop_image = it.shop_image_webp;
    const local = await saveImage(it.shop_image_webp, 'items', it.id);
    if (local) {
      it.shop_image_webp = local;
      it.image_webp = local;
    }
  }
  // the game's corrupted-item frame, drawn over the art of items the build says to corrupt
  const shopImages = (await getJson(`${ASSETS}/images`)).shop?.corrupted_items ?? {};
  await saveImage(shopImages['item_frame_corrupted.webp'], 'corrupted', 'frame');
  await save('items.json', items);
  manifest.counts.items = items.length;
  manifest.counts.shopable_items = items.filter((i) => i.shopable && !i.disabled).length;

  console.log('2/5 heroes');
  const heroesRaw = await getJson(`${ASSETS}/heroes`);
  const active = heroesRaw.filter((h) => h.player_selectable && !h.disabled && !h.in_development);
  const heroes = active.map(slimHero);
  for (const h of heroes) {
    const l = await saveImage(h.images.small, 'heroes', h.id);
    if (l) h.images.small = l;
    const c = await saveImage(h.images.card, 'heroes', h.id, '-card');
    if (c) h.images.card = c;
  }
  await save('heroes.json', heroes);
  manifest.counts.heroes = heroes.length;

  console.log('3/5 abilities');
  const abilities = await fetchAbilities(heroes);
  manifest.counts.abilities = abilities.length;

  await fetchAnalytics(heroes, manifest);
  await fetchChargeOrders(heroes);
  await fetchHeroStats(heroes);
  await fetchItemStats();

  await fetchValidation(heroes, manifest);
  await fetchAllSellStats(heroes, manifest); // after validation: needs the panel ids to leave them out
  await fetchCorruptedStats(heroes);
  manifest.corrupted_fetched_at = new Date().toISOString();
  await fetchImbueTargets(heroes);
  manifest.imbue_targets_fetched_at = new Date().toISOString();

  await save('manifest.json', manifest);
  console.log('done', manifest.counts);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
