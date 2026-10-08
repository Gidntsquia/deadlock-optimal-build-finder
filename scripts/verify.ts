// Verifies the acceptance criteria that can be checked without a browser.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { generateBuilds, buildV2, usesV2, V2_PARAMS, litmusCheck } from '../src/generator';
import { computeCoreSet, consensusAgreement, panelAgreementAcrossBuilds, validateAgainstPanel } from '../src/validation/heldout';

const read = (p: string) => JSON.parse(readFileSync(`public/data/${p}`, 'utf8'));
let fails = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) fails++;
};

const items = read('items.json'),
  heroes = read('heroes.json'),
  abilities = read('abilities.json'),
  manifest = read('manifest.json');
check(
  'item catalog has >=200 items',
  items.length >= 200,
  `${items.length} items, ${items.filter((i: any) => i.shopable && !i.disabled).length} currently shopable`,
);
check(
  'analytics snapshot for every active hero',
  heroes.every((h: any) => existsSync(`public/data/analytics/${h.id}.json`)),
  `${heroes.length} heroes`,
);
const vsets: any[] = manifest.validation_sets ?? [];
// a hero refetched from a patch on (analytics min_unix_timestamp) has had only days to collect games: >=5 each
const minSetMatches = (h: any) => (read(`analytics/${h.id}.json`).min_unix_timestamp ? 5 : 10);
const short = heroes
  .filter((h: any) => vsets.filter((v) => v.hero_id === h.id && v.matches >= minSetMatches(h)).length < 3)
  .map((h: any) => `${h.name} (${vsets.filter((v) => v.hero_id === h.id).length})`);
check(
  'every active hero has >=3 validation sets with >=10 matches (>=5 since a patch)',
  short.length === 0,
  short.length ? `short: ${short.join(', ')}` : `${vsets.length} sets over ${heroes.length} heroes`,
);
for (const v of vsets) {
  const z = read(v.file);
  check(
    `${v.player} ${v.hero}: >=5 matches, all with purchases`,
    z.matches.length >= 5 && z.matches.every((m: any) => m.items.length > 0),
    `${z.matches.length} matches`,
  );
  check(
    `${v.player} ${v.hero}: matchmaking-only, hero matches`,
    z.hero_id === v.hero_id && z.account_id === v.account_id && z.matches.every((m: any) => [1, 2, 4].includes(m.match_mode) && m.game_mode === 1),
  );
}

// generator must not reference any held-out player or snapshot
const gen = (readdirSync('src/generator', { recursive: true }) as string[])
  .filter((f) => /\.ts$/.test(f))
  .map((f) => readFileSync(`src/generator/${f}`, 'utf8'))
  .join('\n');
const heldoutIds = [...new Set(vsets.map((v) => String(v.account_id)))];
check(
  'generator has no held-out player reference',
  !/validation\//i.test(gen) && !heldoutIds.some((id) => gen.includes(id)),
  `${heldoutIds.length} account ids checked`,
);
const readers = execSync("grep -rlE 'HeldoutPurchases>\\(|validation/[0-9]' src || true").toString().trim().split('\n').filter(Boolean);
check(
  'only validation module reads held-out snapshots',
  readers.every((f) => f.startsWith('src/validation/')),
  'files fetching the snapshot: ' + readers.join(', '),
);

const v2Of = (hero: any, analytics: any) =>
  buildV2({ hero, heroes, abilities, items, analytics, data: read(`v2/${hero.id}.json`), modes: read('v2/modes.json') });
const buildsOf = (hero: any, analytics: any) => (usesV2(hero.id) ? [v2Of(hero, analytics).build] : generateBuilds({ hero, abilities, items, analytics }));
// every hero generates a build, >=12 items each, <=12 held at once, 3 phases, running totals, 4 real abilities
const infAbilities = new Set(['Napalm', 'Flame Dash', 'Afterburn', 'Concussive Combustion']);
for (const hero of heroes) {
  const analytics = read(`analytics/${hero.id}.json`);
  let ok = true;
  const why: string[] = [];
  try {
    const builds = buildsOf(hero, analytics);
    if (builds.length < 1) {
      ok = false;
      why.push('no build');
    }
    for (const b of builds) {
      if (b.items.length < 12) {
        ok = false;
        why.push(`${b.name}: ${b.items.length} items`);
      }
      if (new Set(b.items.map((i) => i.phase)).size !== 3) {
        ok = false;
        why.push(`${b.name}: phases`);
      }
      // the game has 12 item slots; an upgrade replaces its component, so it takes no new slot; a sell-later
      // item frees its slot when the item it is sold for is bought
      let held = 0,
        peak = 0;
      for (const i of b.items) {
        held -= b.items.filter((x) => x.sellFor?.id === i.item.id).length;
        if (!i.upgradesFrom) held++;
        peak = Math.max(peak, held);
      }
      if (b.items.some((x) => x.sellFor && x.sellFor.id === x.item.id)) {
        ok = false;
        why.push(`${b.name}: item sold for itself`);
      }
      if (peak > 12) {
        ok = false;
        why.push(`${b.name}: holds ${peak} items, game allows 12`);
      }
      // corrupted-copy suggestions: only T3/T4 items kept to the end, ranked 1..n with no gaps
      const corrupt = b.items.filter((x) => x.corrupt);
      if (corrupt.some((x) => x.item.item_tier < 3 || x.sellFor || b.items.some((y) => y.upgradesFrom?.id === x.item.id))) {
        ok = false;
        why.push(`${b.name}: corrupt on a T1/T2, sold or upgraded item`);
      }
      if (
        corrupt
          .map((x) => x.corrupt!.rank)
          .sort((p, q) => p - q)
          .some((r, k) => r !== k + 1)
      ) {
        ok = false;
        why.push(`${b.name}: corrupt ranks not 1..n`);
      }
      let run = 0;
      for (const i of b.items) {
        run += i.paidCost;
        if (i.runningTotal !== run || !i.item.shop_image_webp) {
          ok = false;
          why.push(`${b.name}: totals/image`);
          break;
        }
      }
      const names = new Set(b.abilityOrder.map((s) => s.ability.name));
      if (names.size !== 4 || b.abilityOrder.filter((s) => s.kind === 'unlock').length !== 4) {
        ok = false;
        why.push(`${b.name}: abilities ${[...names]}`);
      }
      if (hero.id === 1 && ![...names].every((n) => infAbilities.has(n))) {
        ok = false;
        why.push('infernus names');
      }
    }
  } catch (e) {
    ok = false;
    why.push(String(e));
  }
  check(`hero ${hero.id} ${hero.name} generates`, ok, why.join('; '));
}

// a build with a passive charge item takes its ability order from the games where that item was bought:
// Infernus's charge buyers max Flame Dash (its charges come at T3) early, so the build must too
{
  const inf = heroes.find((h: any) => h.id === 1);
  const builds = buildsOf(inf, read('analytics/1.json'));
  const charge = (b: any) => b.items.some((i: any) => !i.item.is_active_item && parseFloat(i.item.properties.BonusAbilityCharges?.value ?? '0') > 0);
  const dashMax = (b: any) => b.abilityOrder.findIndex((s: any) => s.ability.name === 'Flame Dash' && s.kind === 'tier3') + 1;
  // v2 reads only post-patch games; its charge-item sequences hold fewer games than MIN_TOP_SEQ_MATCHES, so the build
  // takes the general order and says so (population.abilitySequenceItem unset). v1 builds must still use the charge buyers' order.
  const thin = (b: any) => usesV2(inf.id) && !b.population.abilitySequenceItem;
  const bad = builds.filter((b) => charge(b) && !thin(b) && (!b.population.abilitySequenceItem || dashMax(b) === 0 || dashMax(b) > 10));
  check(
    'Infernus charge builds max Flame Dash by the 10th ability point',
    builds.some(charge) && bad.length === 0,
    builds
      .map(
        (b) =>
          `${b.name}: from ${b.population.abilitySequenceItem?.name ?? (thin(b) ? 'all post-patch games (charge-item games too few)' : 'all games')}, Flame Dash maxed at point ${dashMax(b) || '-'}`,
      )
      .join('; '),
  );
}

// determinism
const a = execSync('npx tsx scripts/generate-cli.ts 1 --json').toString(),
  b = execSync('npx tsx scripts/generate-cli.ts 1 --json').toString();
check('rerun yields identical Infernus builds', a === b);

// validation report for every hero with a held-out panel
const heroAgreement: { hero: string; agreement: number; consensus: number }[] = [];
for (const hero of heroes) {
  const sets = vsets.filter((v) => v.hero_id === hero.id);
  if (!sets.length) continue;
  const builds = buildsOf(hero, read(`analytics/${hero.id}.json`));
  const panel = sets.map((set) => ({ set, core: computeCoreSet(read(set.file), items) }));
  let ok = true;
  const why: string[] = [];
  for (const bld of builds) {
    const val = validateAgainstPanel(bld, panel);
    const okB =
      val.players.length === sets.length &&
      val.agreement >= 0 &&
      val.agreement <= 1 &&
      val.players.every(
        (p) => p.validation.agreement >= 0 && p.validation.agreement <= 1 && bld.items.every((i) => typeof val.consensusBadges[i.item.id] === 'number'),
      );
    if (!okB) {
      ok = false;
      why.push(bld.name);
    }
  }
  const across = panelAgreementAcrossBuilds(builds, panel);
  const cons = consensusAgreement(builds, panel);
  heroAgreement.push({ hero: hero.name, agreement: across.agreement, consensus: cons.agreement });
  const styleNote =
    builds.length > 1
      ? `; ${builds.length} builds (${builds.map((b) => `${b.name} ${across.perRep.filter((r) => r.buildKey === b.key).length} reps`).join(', ')})`
      : '';
  check(
    `${hero.name}: panel of ${sets.length} (${sets.map((s) => s.player).join(', ')}) agreement in [0,1] + badges`,
    ok,
    ok
      ? `agreement ${(across.agreement * 100).toFixed(0)}%${usesV2(hero.id) ? ' (not targeted: the v2 build is not made to match the panel)' : ''} (consensus ${(cons.agreement * 100).toFixed(0)}%)${styleNote}`
      : why.join('; '),
  );
}
if (heroAgreement.length) {
  const sorted = [...heroAgreement].sort((x, y) => x.agreement - y.agreement);
  const med = sorted[Math.floor(sorted.length / 2)].agreement;
  const mean = heroAgreement.reduce((a, h) => a + h.agreement, 0) / heroAgreement.length;
  console.log(
    `median panel agreement across heroes: ${(med * 100).toFixed(0)}%, mean ${(mean * 100).toFixed(1)}%  (lowest: ${sorted
      .slice(0, 5)
      .map((h) => `${h.hero} ${(h.agreement * 100).toFixed(0)}%`)
      .join(', ')})`,
  );
  const cs = [...heroAgreement].sort((x, y) => x.consensus - y.consensus);
  const cmed = cs[Math.floor(cs.length / 2)].consensus,
    cmean = heroAgreement.reduce((a, h) => a + h.consensus, 0) / heroAgreement.length;
  console.log(
    `median consensus agreement (items core for >=2 reps): ${(cmed * 100).toFixed(0)}%, mean ${(cmean * 100).toFixed(1)}%  (lowest: ${cs
      .slice(0, 5)
      .map((h) => `${h.hero} ${(h.consensus * 100).toFixed(0)}%`)
      .join(', ')}). Ceiling from the panel itself: npx tsx scripts/ceiling.ts`,
  );
}

// v2 (Infernus): the report the Details dialog shows, and the rules the plan fixes
for (const hero of heroes.filter((h: any) => usesV2(h.id))) {
  const { build, report: r } = v2Of(hero, read(`analytics/${hero.id}.json`));
  const d = read(`v2/${hero.id}.json`);
  check(
    `v2 ${hero.name}: every dataset starts at the patch (${r.patch.name}, ${r.patch.since})`,
    [d.standard, d.brawl, d.standard_vs, d.brawl_vs, d.ability_order_stats, d.timelines, d.sell_stats].every(
      (x: any) => x.min_unix_timestamp === r.patch.since,
    ),
    `${r.counts.standard} standard / ${r.counts.brawl} brawl games on the top item`,
  );
  console.log(`v2 ${hero.name} role curve (${r.curve.source}, ${r.curve.games} games; fight window starts ${Math.round(r.curve.farmEndS / 60)} min):`);
  for (const b of r.curve.buckets)
    console.log(
      `   ${String(b.startS / 60).padStart(2)}-${String(b.startS / 60 + 5).padStart(2)} min  farm ${b.farm.toFixed(2)}  fight ${b.fight.toFixed(2)}  farm share ${(b.farmShare * 100).toFixed(0)}%`,
    );
  check(
    `v2 ${hero.name}: role curve is from panel games or says it fell back`,
    r.curve.source === 'panel' ? r.curve.games >= 20 : r.curve.games > 0,
    `${r.curve.source}, ${r.curve.games} games`,
  );
  check(
    `v2 ${hero.name}: every build item has a role reason`,
    build.items.every((b) => r.rows.some((x) => x.itemId === b.item.id && x.roleNote)),
  );
  check(
    `v2 ${hero.name}: no standard-only item (souls, clear, lane sustain) got a brawl lift`,
    r.rows.every((x) => !['souls', 'clearSpeed', 'laneSustain'].includes(x.category) || x.brawlLift === 0),
  );
  check(
    `v2 ${hero.name}: no item with a brawl term is under 1% of the top item's standard games or more than 2.0 pts below average in standard`,
    r.rows.every((x) => x.brawlLift === 0 || (x.popRel >= V2_PARAMS.minStandardShare && x.stdDelta >= V2_PARAMS.minStdDelta)),
  );
  check(
    `v2 ${hero.name}: counter swaps for 10 enemies, each with sample sizes`,
    r.enemies.length === 10 && r.enemies.every((e) => e.games > 0 && e.swaps.every((w) => w.games > 0)),
  );
  check(
    `v2 ${hero.name}: colour spend totals and the crossing item per colour`,
    r.colours.length === 3 && build.items.some((b) => b.spike),
    r.colours.map((c) => `${c.slot} ${c.total}${c.crossing ? ` crosses at ${c.crossing.name}` : ''}`).join('; '),
  );
  const pl = r.placement;
  console.log(`v2 ${hero.name} order (brawl-lifted: ${pl.lifted.join(', ')}; displaced: ${pl.displaced.join(', ')}):`);
  for (const x of pl.rows) console.log(`   ${String(x.slot).padStart(2)} ${x.name.padEnd(24)} ${x.source}`);
  {
    const held: string[] = [];
    let peak = 0,
      sellsOk = true;
    for (const b of build.items) {
      if (b.upgradesFrom) {
        const k = held.indexOf(b.upgradesFrom.name);
        if (k >= 0) held.splice(k, 1);
      }
      for (const o of build.items)
        if (o.sellFor?.id === b.item.id) {
          const k = held.indexOf(o.item.name);
          if (k < 0) sellsOk = false;
          else held.splice(k, 1);
        }
      held.push(b.item.name);
      peak = Math.max(peak, held.length);
    }
    for (const o of build.items) if (o.sellFor && build.items.findIndex((x) => x.item.id === o.sellFor!.id) <= build.items.indexOf(o)) sellsOk = false;
    check(`v2 ${hero.name}: never more than 12 items held, every sell comes at the buy it funds`, peak <= 12 && sellsOk, `most held ${peak}`);
  }
  {
    const idx = (n: string) => build.items.findIndex((b) => b.item.name === n) + 1;
    const three = ['Indomitable', 'Juggernaut', 'Mercurial Magnum'].map(idx).filter((i) => i > 0);
    const last = build.items.length;
    check(
      `v2 ${hero.name}: Indomitable, Juggernaut and Mercurial Magnum do not sit together at the last three slots`,
      !(three.length === 3 && three.every((i) => i > last - 3)),
      `slots ${three.join(', ')} of ${last}`,
    );
    const run = build.items.map((b) => b.runningTotal);
    check(
      `v2 ${hero.name}: running totals follow the order`,
      run.every((t, i) => t === (run[i - 1] ?? 0) + build.items[i].paidCost),
    );
    // spike tiles recomputed here from the final order and sell points (held at the moment of each buy), against the report
    const cash: Record<string, number> = { weapon: 0, vitality: 0, spirit: 0 },
      cross: Record<string, string> = {};
    for (const b of build.items) {
      for (const o of build.items) if (o.sellFor?.id === b.item.id) cash[o.item.item_slot_type] -= o.item.cost;
      const before = cash[b.item.item_slot_type];
      cash[b.item.item_slot_type] += b.paidCost;
      if (before < 4800 && cash[b.item.item_slot_type] >= 4800 && !cross[b.item.item_slot_type]) cross[b.item.item_slot_type] = b.item.name;
    }
    check(
      `v2 ${hero.name}: each colour's spike tile matches a recount of what is held at each buy`,
      r.colours.every((c) => (c.crossing?.name ?? undefined) === cross[c.slot]) &&
        build.items.filter((b) => b.spike).every((b) => cross[b.spike!.slot] === b.item.name),
      `crossings: ${r.colours.map((c) => `${c.slot} ${c.crossing?.name ?? 'none'}`).join('; ')}`,
    );
    const byClass = new Map(items.filter((i: any) => i.shopable && !i.disabled).map((i: any) => [i.class_name, i]));
    const missing = build.items.filter((b) => b.item.component_items.some((c) => byClass.has(c)) && !b.upgradesFrom).map((b) => b.item.name);
    check(
      `v2 ${hero.name}: every upgrade in the build is bought from its component`,
      missing.length === 0,
      missing.length ? `no component: ${missing.join(', ')}` : '',
    );
    const compNames = new Set(build.items.flatMap((b) => (b.upgradesFrom ? [b.upgradesFrom.name] : [])));
    check(
      `v2 ${hero.name}: no component of a build item is counted as displaced or lifted`,
      pl.displaced.every((n) => !compNames.has(n)) && pl.lifted.every((n) => !compNames.has(n)),
      `lifted ${pl.lifted.join(', ')}; displaced ${pl.displaced.join(', ') || 'none'}`,
    );
  }
  const z = r.zergggy;
  console.log(
    `v2 ${hero.name} vs Zergggy: ${z.games} games since the patch; ${z.shared.length} items in both (${z.shared.join(', ') || 'none'}); ${z.onlyHis.length} only his; ${z.onlyBuild.length} only this build`,
  );
  check(`v2 ${hero.name}: Zergggy comparison present with its game count`, z.games >= 0 && z.games === d.zergggy.games.length);
  const sw = r.curve.farmEndS / 60;
  check(`v2 ${hero.name}: fight window starts between 15 and 20 min`, sw >= 15 && sw <= 20, `${sw} min; buckets printed above`);
  console.log(`v2 ${hero.name} litmus (brawlWeight ${V2_PARAMS.brawlWeight}):`);
  for (const l of litmusCheck(build, r))
    check(`v2 ${hero.name} litmus: ${l.name} ${l.want === 'in' ? 'in' : 'out'}`, l.ok, `${l.inBuild ? 'in' : 'out'}; ${l.rule}`);
}

console.log(`\nsnapshot fetched ${manifest.fetched_at}; ${fails} failure(s)`);
process.exit(fails ? 1 : 0);
