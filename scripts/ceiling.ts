// Upper bound on panel agreement: for every hero, a build made from the panel's own core sets (the
// items core for the most reps, weighted by selection score, ordered by the reps' median buy times).
// No generator could beat this without seeing the panel, so it says how far the real numbers can rise.
// Run: npx tsx scripts/ceiling.ts
import { readFileSync } from 'node:fs';
import type { Build } from '../src/types';
import { generateBuilds } from '../src/generator';
import { computeCoreSet, consensusAgreement, panelAgreementAcrossBuilds } from '../src/validation/heldout';

const read = (p: string) => JSON.parse(readFileSync(`public/data/${p}`, 'utf8'));
const items = read('items.json'), heroes = read('heroes.json'), abilities = read('abilities.json'), manifest = read('manifest.json');
const vsets: any[] = manifest.validation_sets ?? [];
const perHero = heroes.map((hero: any) => ({ hero, analytics: read(`analytics/${hero.id}.json`), panel: vsets.filter((v) => v.hero_id === hero.id).map((set) => ({ set, core: computeCoreSet(read(set.file), items) })) })).filter((h: any) => h.panel.length);

function oracle(h: any, n: number): Build {
  const acc = new Map<number, { item: any; f: number; t: number[] }>();
  for (const p of h.panel) { const w = p.set.selection?.score ?? 1; for (const c of p.core.core) { const a = acc.get(c.item.id) ?? { item: c.item, f: 0, t: [] }; a.f += w * c.frequency; a.t.push(c.medianBuyTimeS); acc.set(c.item.id, a); } }
  const picked = [...acc.values()].sort((a, b) => b.f - a.f).slice(0, n).map((a) => ({ item: a.item, t: [...a.t].sort((x, y) => x - y)[a.t.length >> 1] })).sort((a, b) => a.t - b.t);
  return { key: 'oracle', name: 'oracle', tagline: '', heroId: h.hero.id, items: picked.map((p, i) => ({ item: p.item, order: i + 1 })), totalCost: 0, abilityOrder: [], abilityOrderSupport: 0, population: { kind: 'top', minBadge: null, matches: 0, abilitySequenceKind: 'top' } } as unknown as Build;
}
const summary = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return `mean ${(100 * s.reduce((a, b) => a + b, 0) / s.length).toFixed(1)}%  median ${(100 * s[s.length >> 1]).toFixed(1)}%  min ${(100 * s[0]).toFixed(1)}%`; };

const gen = perHero.map((h: any) => generateBuilds({ hero: h.hero, abilities, items, analytics: h.analytics }));
console.log(`generator, per-rep panel:      ${summary(perHero.map((h: any, i: number) => panelAgreementAcrossBuilds(gen[i], h.panel).agreement))}`);
console.log(`generator, consensus (>=2 reps): ${summary(perHero.map((h: any, i: number) => consensusAgreement(gen[i], h.panel).agreement))}`);
for (const n of [16, 20]) {
  const o = perHero.map((h: any) => [oracle(h, n)]);
  console.log(`oracle ${n} items, per-rep panel:      ${summary(perHero.map((h: any, i: number) => panelAgreementAcrossBuilds(o[i], h.panel).agreement))}`);
  console.log(`oracle ${n} items, consensus (>=2 reps): ${summary(perHero.map((h: any, i: number) => consensusAgreement(o[i], h.panel).agreement))}`);
}
