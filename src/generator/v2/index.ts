// Build v2 (docs/build-v2.md): post-patch standard data as the base, Street Brawl as a filtered fight signal, a role curve
// (farm early, fight later) and colour spikes as scored factors. Written for any hero; switched on per hero in pipeline.ts.
import type { Ability, Build, Hero, HeroAnalytics, Item, ItemStat, SlotType } from '../../types';
import { generateBuild, choosePopulation } from '../build';
import { ARCHETYPES } from '../stats';
import { categorize, ROLE_FIT, STANDARD_ONLY } from './categories';
import { farmShareAt, fmtMin, roleCurve } from './roles';
import type { Category, ColourTotal, EnemyReport, ExplainRow, ItemCategory, SlimStat, Swap, V2Data, V2Modes, V2Report, ZergggyReport } from './types';

export const V2_PARAMS = {
  brawlWeight: 1.5,      // score per 10 points of hero-specific brawl lift
  roleWeight: 1.0,       // score at full role fit (the role term runs -0.5..+0.5 of this)
  spikeWeight: 0.35,     // bonus for the item that takes a colour across a spike
  spikeMomentum: 0.1,    // bonus for moving the leading colour toward its spike
  spikeThresholds: [4800],
  minStandardShare: 0.05, // brawl lift needs this share (relative to the most-bought item) of standard games
  brawlShrinkFrac: 0.2,   // win-rate prior weight = 20% of the biggest item's games, as in v1
  modeMinMatches: 200,    // a hero counts toward the game-mode effect for an item with this many games in both modes
  swapMinGames: 60, swapMinLift: 0.01, swapsPerEnemy: 3,
};
const CAT_WORD: Record<Category, string> = { clearSpeed: 'clear speed', souls: 'souls', laneSustain: 'lane sustain', weaponDamage: 'weapon damage', spiritDamage: 'spirit damage', survivability: 'survivability', mobility: 'mobility', actives: 'active use', utility: 'utility' };
const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
const pts = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)} pts`;

export interface V2Input { hero: Hero; heroes: Hero[]; abilities: Ability[]; items: Item[]; analytics: HeroAnalytics; data: V2Data; modes: V2Modes }

const shrunk = (w: number, m: number, K: number, mean: number) => (w + K * mean) / (m + K);
function meanOf(rows: SlimStat[]) { const m = rows.reduce((a, r) => a + r.matches, 0); return m ? rows.reduce((a, r) => a + r.wins, 0) / m : 0.5; }
/** per item: shrunk win rate minus the mean of the same rows, so items compare inside one hero and one mode */
function relMap(rows: SlimStat[]) {
  const mean = meanOf(rows), K = Math.max(200, V2_PARAMS.brawlShrinkFrac * Math.max(1, ...rows.map((r) => r.matches)));
  return new Map(rows.map((r) => [r.item_id, { rel: shrunk(r.wins, r.matches, K, mean) - mean, matches: r.matches, wr: r.wins / r.matches }]));
}

export function buildV2(input: V2Input): { build: Build; report: V2Report } {
  const { hero, items, data, modes } = input;
  const P = V2_PARAMS;
  const catalog = new Map(items.filter((i) => i.shopable && !i.disabled && i.cost > 0).map((i) => [i.id, i]));
  const std = data.standard.item_stats.filter((s) => catalog.has(s.item_id) && s.matches > 0);
  const brawlRows = data.brawl.item_stats.filter((s) => catalog.has(s.item_id) && s.matches > 0);
  const maxStd = Math.max(1, ...std.map((s) => s.matches));
  const curve = roleCurve(data.timelines);
  const stdRel = relMap(std), brawlRel = relMap(brawlRows);
  const stdBy = new Map(std.map((s) => [s.item_id, s]));

  // game-mode effect: the same item's (brawl rel - standard rel) over every OTHER hero
  const globalLift = new Map<number, number>();
  {
    const acc = new Map<number, { w: number; s: number }>();
    for (const [hid, h] of Object.entries(modes.heroes)) {
      if (Number(hid) === hero.id) continue;
      const rs = relMap(h.standard), rb = relMap(h.brawl);
      for (const [id, b] of rb) {
        const s = rs.get(id);
        if (!s || s.matches < P.modeMinMatches || b.matches < P.modeMinMatches) continue;
        const w = Math.min(s.matches, b.matches), a = acc.get(id) ?? { w: 0, s: 0 };
        a.w += w; a.s += w * (b.rel - s.rel); acc.set(id, a);
      }
    }
    for (const [id, a] of acc) globalLift.set(id, a.s / a.w);
  }

  const cats = new Map<number, ItemCategory>();
  for (const it of catalog.values()) cats.set(it.id, categorize(it, stdBy.get(it.id)?.avg_buy_time_s ?? null, curve.farmEndS));

  // one explain row per candidate (the items in the standard data)
  const rows = new Map<number, ExplainRow>();
  const denyOf = (id: number): { lift: number; denied: string | null; hero: number | null; g: number | null } => {
    const s = stdRel.get(id)!, b = brawlRel.get(id), cat = cats.get(id)!, st = stdBy.get(id)!;
    if (!b) return { lift: 0, denied: 'no brawl games for this item', hero: null, g: null };
    const hero = b.rel - s.rel, g = globalLift.get(id) ?? null;
    const base = { hero, g };
    if (st.matches / maxStd < P.minStandardShare) return { lift: 0, denied: `rarely bought in standard (${pct(st.matches / maxStd, 0)} of the top item's games, needs ${pct(P.minStandardShare, 0)})`, ...base };
    if (s.rel < 0) return { lift: 0, denied: `standard win rate is below average (${pts(s.rel)}): brawl sharpens, never flips`, ...base };
    if (b.rel < 0) return { lift: 0, denied: `brawl win rate disagrees with standard (${pts(b.rel)} in brawl)`, ...base };
    const fightOnly = cat.all.filter((c) => !STANDARD_ONLY.includes(c));
    if (STANDARD_ONLY.includes(cat.primary) || !fightOnly.length) return { lift: 0, denied: `standard-only mechanic (${CAT_WORD[cat.primary]})`, ...base };
    if (st.avg_buy_time_s < curve.farmEndS) return { lift: 0, denied: `bought at ${fmtMin(st.avg_buy_time_s)}, inside the farm window (ends ${fmtMin(curve.farmEndS)})`, ...base };
    if (g === null) return { lift: 0, denied: 'no other hero has this item in both modes (cannot remove the game-mode effect)', ...base };
    const specific = hero - g;
    if (specific <= 0) return { lift: 0, denied: `brawl favours it on every hero as much (${pts(hero)} here, ${pts(g)} across heroes)`, ...base };
    return { lift: specific, denied: null, ...base };
  };
  for (const s of std) {
    const it = catalog.get(s.item_id)!, cat = cats.get(s.item_id)!, d = denyOf(s.item_id), f = farmShareAt(curve, s.avg_buy_time_s);
    const [ff, gf] = ROLE_FIT[cat.primary];
    const roleTerm = ff * f + gf * (1 - f) - 0.5;
    const side = f >= 0.5 ? 'farm' : 'fight';
    rows.set(s.item_id, {
      itemId: s.item_id, name: it.name, slot: it.item_slot_type, category: cat.primary, categorySource: cat.source,
      stdMatches: s.matches, popRel: s.matches / maxStd, stdDelta: stdRel.get(s.item_id)!.rel,
      brawlMatches: brawlRel.get(s.item_id)?.matches ?? 0, brawlRel: brawlRel.get(s.item_id)?.rel ?? null,
      heroModeLift: d.hero, globalModeLift: d.g, brawlLift: d.lift, denied: d.denied,
      buyTimeS: s.avg_buy_time_s, farmShareAtBuy: f, roleTerm,
      roleNote: `bought at ${fmtMin(s.avg_buy_time_s)}, ${side} window: ${CAT_WORD[cat.primary]} ${Math.abs(roleTerm) < 0.05 ? 'is neutral' : roleTerm > 0 ? 'counts' : 'counts less'}${cat.source === 'data' ? ' (class from data)' : ''}`,
    });
  }

  // score terms for the v1 selection loop
  const hooks = {
    item(item: Item) {
      const r = rows.get(item.id);
      if (!r) return { delta: 0, notes: [] };
      const notes = [r.roleNote];
      if (r.brawlLift > 0) notes.push(`wins more in Street Brawl fights than other heroes' copies (${pts(r.brawlLift)} after removing the game-mode effect)`);
      return { delta: P.brawlWeight * r.brawlLift * 10 + P.roleWeight * r.roleTerm, notes };
    },
    dynamic(item: Item, chosen: Item[]) {
      const T = P.spikeThresholds[P.spikeThresholds.length - 1];
      const spend = (slot: SlotType) => chosen.filter((c) => c.item_slot_type === slot).reduce((a, c) => a + c.cost, 0);
      const now = spend(item.item_slot_type), after = now + item.cost;
      if (now < T && after >= T) return { delta: P.spikeWeight, notes: [`takes ${item.item_slot_type} spend past ${(T / 1000).toFixed(1)}k`] };
      const lead = (['weapon', 'vitality', 'spirit'] as SlotType[]).sort((a, b) => spend(b) - spend(a))[0];
      if (item.item_slot_type === lead && after < T) return { delta: P.spikeMomentum * (after / T), notes: [] };
      return { delta: 0, notes: [] };
    },
  };

  // the v1 machinery with v2 data: post-patch standard rows, no style split, post-patch sell stats and ability orders
  const stats: ItemStat[] = std.map((s) => ({ item_id: s.item_id, bucket: 0, wins: s.wins, losses: s.matches - s.wins, matches: s.matches, players: 0, avg_buy_time_s: s.avg_buy_time_s, avg_sell_time_s: 0, avg_buy_time_relative: 0, avg_sell_time_relative: 0 } as ItemStat));
  const ab = data.ability_order_stats.rows.map((r) => ({ ...r, players: 0 }));
  const analytics: HeroAnalytics = {
    ...input.analytics,
    item_stats: stats, ability_order_stats: ab, permutation_stats: [], min_unix_timestamp: data.patch.min_unix_timestamp,
    top: { min_average_badge: data.standard.min_average_badge, item_stats: stats, ability_order_stats: ab, permutation_stats: [], sell_stats: data.sell_stats, item_ability_order_stats: input.analytics.top?.item_ability_order_stats },
  };
  const popn = choosePopulation(analytics);
  const build = generateBuild({ hero, abilities: input.abilities, items, analytics, v2: hooks }, ARCHETYPES[0], popn);
  build.population = { ...build.population, kind: 'top', minBadge: data.standard.min_average_badge };

  // colour totals and the item that crosses each spike, in buy order (sold items are not held at the end)
  const T = P.spikeThresholds;
  const colours: ColourTotal[] = (['weapon', 'vitality', 'spirit'] as SlotType[]).map((slot) => {
    let total = 0, crossing: ColourTotal['crossing'] = null;
    for (const b of build.items) {
      if (b.item.item_slot_type !== slot || b.sellFor) continue;
      const before = total; total += b.paidCost;
      for (const t of T) if (before < t && total >= t && !(slot && b.spike)) { b.spike = { slot, threshold: t }; if (t === T[T.length - 1]) crossing = { itemId: b.item.id, name: b.item.name, threshold: t }; }
    }
    return { slot, total, crossing };
  });

  const enemies = counters(input, build, rows, stdRel, brawlRel);
  const zerg = zergggy(input, build, rows);
  const report: V2Report = {
    patch: { name: data.patch.name, since: data.patch.min_unix_timestamp },
    counts: { standard: maxStd, brawl: Math.max(0, ...brawlRows.map((r) => r.matches)) },
    curve, rows: [...rows.values()].sort((a, b) => b.stdMatches - a.stdMatches), colours,
    spikeThresholds: T,
    spikeSource: 'The game\'s threshold table is not in the API (generic-data and items.json checked on 2026-10-08); 4.8k is the figure the user gave, and lower steps are not scored.',
    enemies, zergggy: zerg,
    notes: [
      'Street Brawl rows are keyed by the base item: enhanced and rare cards cannot be separated in the API. The draft config offers every card enhanced with the same chance, so no item is excluded for it; the standard-direction gate, the standard-buy-rate gate and the game-mode effect carry the filtering (an enhanced-only strong item such as Rescue Beam fails the standard gates).',
      'Brawl is all ranks (the API returns an error for a badge filter in that mode); standard is Phantom+.',
      'Brawl buy rate is never a score input. Only win rate when held is used.',
    ],
  };
  build.v2 = report;
  return { build, report };
}

function counters(input: V2Input, build: Build, rows: Map<number, ExplainRow>, stdRel: ReturnType<typeof relMap>, brawlRel: ReturnType<typeof relMap>): EnemyReport[] {
  const { data, heroes } = input, P = V2_PARAMS;
  const inBuild = new Set(build.items.map((b) => b.item.id));
  const name = (id: number) => heroes.find((h) => h.id === id)?.name ?? `hero ${id} (not in the hero list)`;
  const replaceFor = (slot: SlotType, used: Set<number>) => build.items.filter((b) => b.item.item_slot_type === slot && !b.sellFor && !used.has(b.item.id)).sort((a, b) => a.score - b.score)[0];
  return data.enemies.map((e) => {
    const used = new Set<number>(), swaps: Swap[] = [];
    const tryRows = (vs: SlimStat[], allRel: ReturnType<typeof relMap>, source: 'standard' | 'brawl') => {
      const vrel = relMap(vs), cand: Swap[] = [];
      for (const r of vs) {
        const row = rows.get(r.item_id), a = allRel.get(r.item_id), v = vrel.get(r.item_id);
        if (!row || !a || !v || inBuild.has(r.item_id) || swaps.some((s) => s.itemId === r.item_id) || r.matches < P.swapMinGames) continue;
        if (source === 'standard' && row.popRel < P.minStandardShare) continue;
        if (source === 'brawl' && row.denied) continue; // same filters as the build's brawl lift
        const lift = v.rel - a.rel;
        if (lift < P.swapMinLift) continue;
        cand.push({ itemId: r.item_id, name: row.name, replaces: null, source, games: r.matches, lift, reason: `wins ${pct(v.wr)} against ${name(e.hero_id)} (${r.matches} games) against ${pct(a.wr)} overall, ${pts(lift)} relative to the other items` });
      }
      cand.sort((x, y) => y.lift - x.lift);
      for (const c of cand) {
        if (swaps.length >= P.swapsPerEnemy) break;
        const slot = rows.get(c.itemId)!.slot, out = replaceFor(slot, used);
        if (out) used.add(out.item.id);
        swaps.push({ ...c, replaces: out?.item.name ?? null });
      }
    };
    tryRows(data.standard_vs.rows[e.hero_id] ?? [], stdRel, 'standard');
    if (swaps.length < P.swapsPerEnemy) tryRows(data.brawl_vs.rows[e.hero_id] ?? [], brawlRel, 'brawl');
    return { heroId: e.hero_id, name: name(e.hero_id), games: e.games, swaps };
  });
}

function zergggy(input: V2Input, build: Build, rows: Map<number, ExplainRow>): ZergggyReport {
  const z = input.data.zergggy, byId = new Map(input.items.map((i) => [i.id, i]));
  const his = new Set<number>();
  for (const g of z.games) for (const it of g.items) if (byId.get(it.item_id)?.shopable && it.sold_time_s === 0) his.add(it.item_id);
  const mine = new Map(build.items.map((b) => [b.item.id, b]));
  const shared = [...his].filter((id) => mine.has(id)).map((id) => byId.get(id)!.name);
  const onlyHis = [...his].filter((id) => !mine.has(id)).map((id) => {
    const r = rows.get(id), n = byId.get(id)!.name;
    if (!r) return { name: n, reason: 'not in the post-patch Phantom+ data for this hero' };
    return { name: n, reason: r.popRel < 0.12 ? `bought in only ${pct(r.popRel, 0)} of the top item's games` : `${pct(r.popRel, 0)} of games, ${pts(r.stdDelta)} win rate, ${r.roleNote}; scored below the items kept${r.denied ? ` (brawl lift denied: ${r.denied})` : ''}` };
  });
  const onlyBuild = build.items.filter((b) => !his.has(b.item.id)).map((b) => ({ name: b.item.name, reason: b.reasons.slice(0, 2).join('; ') || 'high score' }));
  return { games: z.games.length, sinceTotal: z.hero_games_total_since_patch, shared, onlyHis, onlyBuild };
}
export type { V2Data, V2Modes, V2Report, Category };
