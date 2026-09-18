// Experiment: does a matchup (enemy-counter) scoring term produce better builds? Hard-coded
// scenarios only (plans/matchup-builds.md step 4) — no UI, no full hero x enemy grid.
// Usage: npm run matchup-experiment
// Requires public/data/analytics/matchups/<heroId>-{badge70,allranks}.json for every scenario hero,
// written by: node scripts/fetch-data.mjs --matchups "<heroId>:<e1,e2,...>;..."
import { readFileSync } from 'node:fs';
import { generateBuild } from '../src/generator/build';
import { ARCHETYPES, PARAMS } from '../src/generator/stats';
import type { Ability, Hero, HeroAnalytics, Item, MatchupStats } from '../src/types';

const read = (p: string) => JSON.parse(readFileSync(`public/data/${p}`, 'utf8'));

const items: Item[] = read('items.json');
const heroes: Hero[] = read('heroes.json');
const abilities: Ability[] = read('abilities.json');
const heroName = new Map(heroes.map((h) => [h.id, h.name]));

interface Scenario { label: string; heroId: number; enemies: number[] }

// Real hero ids from public/data/heroes.json. Expected-answer scenarios use widely known counter
// items: Healbane / anti-heal vs heavy sustain, bullet-resist vs gun-heavy teams, spirit-resist vs
// spirit-heavy teams. Sinclair is a low-pick hero (thin baseline usage), included to see whether
// shrinkage correctly washes out the term when matchup samples are also thin for a low-pick hero.
const SCENARIOS: Scenario[] = [
  { label: 'Abrams vs heavy-healing team (Ivy, Kelvin, Pocket)', heroId: 6, enemies: [20, 12, 50] },
  { label: 'Abrams vs all-gun team (Vindicta, Grey Talon, Holliday)', heroId: 6, enemies: [3, 17, 14] },
  { label: 'Abrams vs all-spirit team (Lash, Viscous, Paradox)', heroId: 6, enemies: [31, 35, 10] },
  { label: 'Sinclair (low-pick hero) vs mixed team (Vindicta, Grey Talon, Ivy)', heroId: 60, enemies: [3, 17, 20] },
];

const WEIGHTS_TO_TRY = [0.25, 0.5, 1];
const POPULATIONS: { key: string; suffix: string }[] = [
  { key: 'badge>=70', suffix: 'badge70' },
  { key: 'all-ranks', suffix: 'allranks' },
];

const enemyLabel = (ids: number[]) => ids.map((e) => heroName.get(e) ?? `#${e}`).join(', ');

function buildFor(heroId: number, matchup?: { enemies: number[]; stats: MatchupStats }) {
  const hero = heroes.find((h) => h.id === heroId)!;
  const analytics: HeroAnalytics = read(`analytics/${heroId}.json`);
  return generateBuild({ hero, abilities, items, analytics, matchup }, ARCHETYPES[0]);
}

function itemSet(build: ReturnType<typeof buildFor>) {
  return new Set(build.items.map((i) => i.item.id));
}

function usageWeightedWinRate(build: ReturnType<typeof buildFor>, stats: MatchupStats, enemies: number[]) {
  // usage-weighted mean matchup-conditioned win rate of this build's item set: for each item in the
  // build, its win rate against the known enemies (pooled), weighted by the build's usage rate for
  // that item; items with no matchup rows are skipped (not counted for or against).
  let num = 0, den = 0;
  for (const bi of build.items) {
    let w = 0, m = 0;
    for (const e of enemies) {
      const rows = stats.vs[String(e)];
      const r = rows?.find((x) => x.item_id === bi.item.id);
      if (r) { w += r.wins; m += r.matches; }
    }
    if (!m) continue;
    num += (w / m) * bi.usageRate;
    den += bi.usageRate;
  }
  return den ? num / den : null;
}

function main() {
  const baselineWeight = PARAMS.weights.matchup;
  console.log(`matchup-experiment: ${SCENARIOS.length} scenario(s), weights ${WEIGHTS_TO_TRY.join(', ')}, populations ${POPULATIONS.map((p) => p.key).join(' / ')}\n`);

  for (const sc of SCENARIOS) {
    console.log(`\n${'='.repeat(80)}\n${sc.label}  (hero ${sc.heroId}, enemies ${enemyLabel(sc.enemies)})\n${'='.repeat(80)}`);
    PARAMS.weights.matchup = 0;
    const baseline = buildFor(sc.heroId);
    const baselineSet = itemSet(baseline);
    console.log(`baseline (weight 0): ${baseline.items.map((i) => i.item.name).join(', ')}`);

    for (const pop of POPULATIONS) {
      let stats: MatchupStats;
      try {
        stats = read(`analytics/matchups/${sc.heroId}-${pop.suffix}.json`);
      } catch {
        console.log(`\n  [${pop.key}] population file missing — run: node scripts/fetch-data.mjs --matchups "${sc.heroId}:${sc.enemies.join(',')}"`);
        continue;
      }
      console.log(`\n  -- population: ${pop.key} (min_badge=${stats.population.min_badge ?? 'none'}, window_days=${stats.population.window_days}) --`);
      const baseWr = usageWeightedWinRate(baseline, stats, sc.enemies);
      console.log(`  baseline usage-weighted matchup win rate: ${baseWr === null ? 'n/a (no data)' : (baseWr * 100).toFixed(1) + '%'}`);

      for (const w of WEIGHTS_TO_TRY) {
        PARAMS.weights.matchup = w;
        const build = buildFor(sc.heroId, { enemies: sc.enemies, stats });
        const set = itemSet(build);
        const added = build.items.filter((i) => !baselineSet.has(i.item.id));
        const removed = baseline.items.filter((i) => !set.has(i.item.id));
        const wr = usageWeightedWinRate(build, stats, sc.enemies);
        console.log(`\n  weight ${w}:`);
        if (!added.length && !removed.length) {
          console.log('    no swaps vs baseline');
        } else {
          for (const bi of added) {
            const sampleSizes = sc.enemies.map((e) => `${heroName.get(e)}=${stats.vs[String(e)]?.find((x) => x.item_id === bi.item.id)?.matches ?? 0}`).join(', ');
            const reasons = bi.reasons
              .filter((r) => r.includes('enemy hero'))
              .map((r) => r.replace(/against enemy hero ([\d, ]+)/, (_m, ids: string) => `against ${ids.split(',').map((id) => heroName.get(Number(id.trim())) ?? id.trim()).join(', ')}`))
              .join('; ') || 'no per-enemy reason (lift <=0.1)';
            console.log(`    + ${bi.item.name.padEnd(24)} ${reasons}; vs-sample sizes: ${sampleSizes}`);
          }
          for (const bi of removed) console.log(`    - ${bi.item.name}`);
        }
        console.log(`    usage-weighted matchup win rate: ${wr === null ? 'n/a' : (wr * 100).toFixed(1) + '%'}${baseWr !== null && wr !== null ? `  (delta ${((wr - baseWr) * 100).toFixed(1)}pp)` : ''}`);
      }
    }
  }
  PARAMS.weights.matchup = baselineWeight;
}

main();
