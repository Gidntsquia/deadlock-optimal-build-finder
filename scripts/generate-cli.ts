// CLI: generate builds from the local snapshot and (optionally) validate against the held-out panel of top players for that hero (if any).
// Usage: npm run generate [-- <hero_id>] [--json]
import { readFileSync } from 'node:fs';
import { generateBuilds, buildV2, V2_PARAMS, litmusCheck } from '../src/generator';
import { computeCoreSet, consensusThreshold, validateAgainstPanel } from '../src/validation/heldout';

const read = (p: string) => JSON.parse(readFileSync(`public/data/${p}`, 'utf8'));
const args = process.argv.slice(2);
const heroId = Number(args.find((a) => /^\d+$/.test(a)) ?? 1);
const asJson = args.includes('--json');

const items = read('items.json'),
  heroes = read('heroes.json'),
  abilities = read('abilities.json');
const hero = heroes.find((h: any) => h.id === heroId);
if (!hero) throw new Error(`hero ${heroId} not in snapshot`);
const analytics = read(`analytics/${heroId}.json`);
const useV2 = args.includes('--v2');
const v2 = useV2 ? { data: read(`v2/${heroId}.json`), modes: read('v2/modes.json') } : null;
if (v2 && args.includes('--sweep')) {
  const keep = V2_PARAMS.brawlWeight;
  for (const w of [0.5, 1, 1.5, 2, 3, 4]) {
    V2_PARAMS.brawlWeight = w;
    const o = buildV2({ hero, heroes, abilities, items, analytics, data: v2.data, modes: v2.modes });
    const l = litmusCheck(o.build, o.report);
    console.log(
      `\nweight ${w}: ${l.filter((x) => x.ok).length}/${l.length} litmus ok${
        l.filter((x) => !x.ok).length
          ? ' - missed: ' +
            l
              .filter((x) => !x.ok)
              .map((x) => x.name)
              .join(', ')
          : ''
      }`,
    );
    console.log('  items: ' + o.build.items.map((i) => i.item.name).join(', '));
    console.log('  litmus: ' + l.map((x) => `${x.name} ${x.inBuild ? 'in' : 'out'}${x.ok ? '' : ' (WRONG)'}`).join('; '));
  }
  V2_PARAMS.brawlWeight = keep;
  process.exit(0);
}
const v2Out = v2 ? buildV2({ hero, heroes, abilities, items, analytics, data: v2.data, modes: v2.modes }) : null;
const builds = v2Out ? [v2Out.build] : generateBuilds({ hero, abilities, items, analytics });

if (asJson) {
  console.log(
    JSON.stringify(
      builds.map((b) => ({
        key: b.key,
        items: b.items.map((i) => [i.item.id, i.phase, i.runningTotal]),
        abilities: b.abilityOrder.map((s) => [s.ability.id, s.kind]),
      })),
    ),
  );
  process.exit(0);
}
if (v2Out && args.includes('--explain')) {
  const r = v2Out.report;
  console.log(`# v2 explain: patch ${r.patch.name}, ${r.counts.standard} games on the top standard item, ${r.counts.brawl} on the top brawl item`);
  console.log(`fight window starts ${Math.round(r.curve.farmEndS / 60)} min (${r.curve.source}, ${r.curve.games} games)`);
  console.log('item                      cat           std%   popRel  stdΔ    brawlΔ  modeG   term   rule (term = (brawlΔ - modeG) x support x role scale)');
  const f = (x: number | null) => (x === null ? '   -  ' : `${(x * 100).toFixed(1).padStart(6)}`);
  for (const x of r.rows)
    console.log(
      `${x.name.padEnd(25)} ${x.category.padEnd(13)} ${String(x.stdMatches).padStart(5)} ${(x.popRel * 100).toFixed(0).padStart(5)}% ${f(x.stdDelta)} ${f(x.brawlRel)} ${f(x.globalModeLift)} ${f(x.brawlLift)}  ${x.denied ?? `x${x.supportScale.toFixed(2)} support (min(1, popRel/0.20)) x${x.roleScale} role${x.spiritRule ? '; ' + x.spiritRule : ''}`}`,
    );
}
if (v2Out && args.includes('--explain')) {
  const pl = v2Out.report.placement;
  console.log(`\n# order: brawl-lifted [${pl.lifted.join(', ')}]; displaced [${pl.displaced.join(', ')}]; most items held at once ${pl.maxHeld}`);
  for (const x of pl.rows) console.log(`  ${String(x.slot).padStart(2)} ${x.name.padEnd(25)} ${x.source}`);
}
const fmt = (s: number) => {
  const t = Math.round(s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
const vsets: any[] = (read('manifest.json').validation_sets ?? []).filter((v: any) => v.hero_id === heroId);
const panel = vsets.map((set) => ({ set, core: computeCoreSet(read(set.file), items) }));
const need = consensusThreshold(panel.length);
console.log(`# ${hero.name} — ${builds.length} builds.`);
const pop = builds[0]?.population;
if (pop)
  console.log(
    `population: ${pop.kind === 'top' ? `high-rank lobbies (avg badge >= ${pop.minBadge})` : 'all ranks'}, ${pop.matches.toLocaleString()} matches on the most-bought item; ability sequences from ${pop.abilitySequenceKind === 'top' ? 'high-rank' : 'all-rank'} data`,
  );
for (const b of builds)
  if (b.population.abilitySequenceItem) console.log(`${b.name}: ability order from games where ${b.population.abilitySequenceItem.name} was bought`);
for (const b of builds) {
  const v = panel.length ? validateAgainstPanel(b, panel) : null;
  console.log(`\n## ${b.name}  total ${b.totalCost}${v ? `  | panel agreement ${(v.agreement * 100).toFixed(0)}% over ${v.players.length} player(s)` : ''}`);
  for (const i of b.items)
    console.log(
      `  ${String(i.order).padStart(2)} ${i.phase.padEnd(5)} ${i.item.name.padEnd(24)} T${i.item.item_tier} ${i.item.item_slot_type.padEnd(8)} ${String(i.paidCost).padStart(5)}${i.upgradesFrom ? '↑' : ' '}Σ${String(i.runningTotal).padStart(6)}  ${fmt(i.avgBuyTimeS)}${i.sellFor ? ` sell→${i.sellFor.name}` : ''}${i.corrupt ? ` CORRUPT#${i.corrupt.rank}(+${(i.corrupt.gain * 100).toFixed(1)} n${i.corrupt.matches})` : ''} wr${(i.winRate * 100).toFixed(1)} use${(i.usageRate * 100).toFixed(0)} sc${i.score.toFixed(2)} ${v ? ((v.consensusBadges[i.item.id] ?? 0) >= need ? `CORE ${v.consensusBadges[i.item.id]}/${v.players.length}` : `-    ${v.consensusBadges[i.item.id] ?? 0}/${v.players.length}`) : ''}`,
    );
  console.log('  abilities: ' + b.abilityOrder.map((s) => `${s.ability.name}[${s.kind}]`).join(' > '));
  if (v) {
    console.log('  panel:  player            games(W)  lifetime  agree  core');
    for (const p of v.players)
      console.log(
        `          ${p.set.player.padEnd(16)} ${`${p.core.matches}(${p.core.wins})`.padStart(8)}  ${String(p.set.selection?.total_hero_matches ?? '-').padStart(8)}  ${`${(p.validation.agreement * 100).toFixed(0)}%`.padStart(5)}  ${p.validation.sharedCount}/${p.core.core.length}`,
      );
    if (v.missingConsensus.length)
      console.log(
        `  missing consensus (core for >=${need}/${v.players.length}): ${v.missingConsensus.map((m) => `${m.item.name} ${m.reps}/${v.players.length} (${(m.frequency * 100).toFixed(0)}%)`).join(', ')}`,
      );
  }
}
if (v2Out) {
  const r = v2Out.report;
  console.log('\n# role curve (farm share of activity per 5 min)');
  for (const b of r.curve.buckets)
    console.log(
      `  ${String(b.startS / 60).padStart(2)} min  farm ${b.farm.toFixed(2)}  fight ${b.fight.toFixed(2)}  farm share ${(b.farmShare * 100).toFixed(0)}%  (${b.intervals} intervals)`,
    );
  console.log(`  source: ${r.curve.source}, ${r.curve.games} games; farm window ends ${r.curve.farmEndS / 60} min`);
  console.log('\n# colour spend');
  for (const c of r.colours)
    console.log(
      `  ${c.slot.padEnd(9)} ${String(c.total).padStart(6)}  ${c.crossing ? `${c.crossing.name} crosses ${c.crossing.threshold}` : 'no spike reached'}`,
    );
  console.log('\n# Zergggy ' + `(${r.zergggy.games} games since the patch; ${r.zergggy.sinceTotal} on the hero)`);
  console.log(`  shared: ${r.zergggy.shared.join(', ')}`);
  for (const x of r.zergggy.onlyHis) console.log(`  only his: ${x.name} - ${x.reason}`);
  for (const x of r.zergggy.onlyBuild) console.log(`  only build: ${x.name} - ${x.reason}`);
  console.log('\n# counters');
  for (const e of r.enemies) {
    console.log(`  vs ${e.name} (${e.games} games)`);
    for (const s of e.swaps) console.log(`     + ${s.name}${s.replaces ? ` for ${s.replaces}` : ''} [${s.source}] ${s.reason}`);
  }
  for (const n of r.notes) console.log('  note: ' + n);
}
for (const { set, core } of panel) {
  console.log(
    `\n# ${core.player}'s ${core.hero} core set (${core.matches} matches, ${core.wins} wins${set.selection ? `; rank ${set.selection.rank}, ${set.selection.total_hero_matches} lifetime games, score ${set.selection.score.toFixed(2)}` : ''}):`,
  );
  for (const c of core.core) console.log(`  ${c.item.name.padEnd(24)} ${(c.frequency * 100).toFixed(0)}%  median buy ${fmt(c.medianBuyTimeS)}`);
  console.log(`  experiments (<30%): ${core.experiments.map((c) => `${c.item.name} ${(c.frequency * 100).toFixed(0)}%`).join(', ')}`);
}
