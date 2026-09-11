// Verifies the acceptance criteria that can be checked without a browser.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { generateBuilds } from '../src/generator';
import { computeCoreSet, consensusAgreement, panelAgreementAcrossBuilds, validateAgainstPanel } from '../src/validation/heldout';

const read = (p: string) => JSON.parse(readFileSync(`public/data/${p}`, 'utf8'));
let fails = 0;
const check = (name: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) fails++; };

const items = read('items.json'), heroes = read('heroes.json'), abilities = read('abilities.json'), manifest = read('manifest.json');
check('item catalog has >=200 items', items.length >= 200, `${items.length} items, ${items.filter((i: any) => i.shopable && !i.disabled).length} currently shopable`);
check('analytics snapshot for every active hero', heroes.every((h: any) => existsSync(`public/data/analytics/${h.id}.json`)), `${heroes.length} heroes`);
const vsets: any[] = manifest.validation_sets ?? [];
const short = heroes.filter((h: any) => vsets.filter((v) => v.hero_id === h.id && v.matches >= 10).length < 3).map((h: any) => `${h.name} (${vsets.filter((v) => v.hero_id === h.id).length})`);
check('every active hero has >=3 validation sets with >=10 matches', short.length === 0, short.length ? `short: ${short.join(', ')}` : `${vsets.length} sets over ${heroes.length} heroes`);
for (const v of vsets) {
  const z = read(v.file);
  check(`${v.player} ${v.hero}: >=5 matches, all with purchases`, z.matches.length >= 5 && z.matches.every((m: any) => m.items.length > 0), `${z.matches.length} matches`);
  check(`${v.player} ${v.hero}: matchmaking-only, hero matches`, z.hero_id === v.hero_id && z.account_id === v.account_id && z.matches.every((m: any) => [1, 2].includes(m.match_mode) && m.game_mode === 1));
}

// generator must not reference any held-out player or snapshot
const gen = readdirSync('src/generator').map((f) => readFileSync(`src/generator/${f}`, 'utf8')).join('\n');
const heldoutIds = [...new Set(vsets.map((v) => String(v.account_id)))];
check('generator has no held-out player reference', !/validation\//i.test(gen) && !heldoutIds.some((id) => gen.includes(id)), `${heldoutIds.length} account ids checked`);
const readers = execSync("grep -rlE 'HeldoutPurchases>\\(|validation/[0-9]' src || true").toString().trim().split('\n').filter(Boolean);
check('only validation module reads held-out snapshots', readers.every((f) => f.startsWith('src/validation/')), 'files fetching the snapshot: ' + readers.join(', '));

// every hero generates a build, >=12 items each, 3 phases, running totals, 4 real abilities
const infAbilities = new Set(['Napalm', 'Flame Dash', 'Afterburn', 'Concussive Combustion']);
for (const hero of heroes) {
  const analytics = read(`analytics/${hero.id}.json`);
  let ok = true; const why: string[] = [];
  try {
    const builds = generateBuilds({ hero, abilities, items, analytics });
    if (builds.length < 1) { ok = false; why.push('no build'); }
    for (const b of builds) {
      if (b.items.length < 12) { ok = false; why.push(`${b.name}: ${b.items.length} items`); }
      if (new Set(b.items.map((i) => i.phase)).size !== 3) { ok = false; why.push(`${b.name}: phases`); }
      let run = 0; for (const i of b.items) { run += i.paidCost; if (i.runningTotal !== run || !i.item.shop_image_webp) { ok = false; why.push(`${b.name}: totals/image`); break; } }
      const names = new Set(b.abilityOrder.map((s) => s.ability.name));
      if (names.size !== 4 || b.abilityOrder.filter((s) => s.kind === 'unlock').length !== 4) { ok = false; why.push(`${b.name}: abilities ${[...names]}`); }
      if (hero.id === 1 && ![...names].every((n) => infAbilities.has(n))) { ok = false; why.push('infernus names'); }
    }
  } catch (e) { ok = false; why.push(String(e)); }
  check(`hero ${hero.id} ${hero.name} generates`, ok, why.join('; '));
}

// determinism
const a = execSync('npx tsx scripts/generate-cli.ts 1 --json').toString(), b = execSync('npx tsx scripts/generate-cli.ts 1 --json').toString();
check('rerun yields identical Infernus builds', a === b);

// validation report for every hero with a held-out panel
const heroAgreement: { hero: string; agreement: number; consensus: number }[] = [];
for (const hero of heroes) {
  const sets = vsets.filter((v) => v.hero_id === hero.id);
  if (!sets.length) continue;
  const builds = generateBuilds({ hero, abilities, items, analytics: read(`analytics/${hero.id}.json`) });
  const panel = sets.map((set) => ({ set, core: computeCoreSet(read(set.file), items) }));
  let ok = true; const why: string[] = [];
  for (const bld of builds) {
    const val = validateAgainstPanel(bld, panel);
    const okB = val.players.length === sets.length && val.agreement >= 0 && val.agreement <= 1 && val.players.every((p) => p.validation.agreement >= 0 && p.validation.agreement <= 1 && bld.items.every((i) => typeof val.consensusBadges[i.item.id] === 'number'));
    if (!okB) { ok = false; why.push(bld.name); }
  }
  const across = panelAgreementAcrossBuilds(builds, panel);
  const cons = consensusAgreement(builds, panel);
  heroAgreement.push({ hero: hero.name, agreement: across.agreement, consensus: cons.agreement });
  const styleNote = builds.length > 1 ? `; ${builds.length} builds (${builds.map((b) => `${b.name} ${across.perRep.filter((r) => r.buildKey === b.key).length} reps`).join(', ')})` : '';
  check(`${hero.name}: panel of ${sets.length} (${sets.map((s) => s.player).join(', ')}) agreement in [0,1] + badges`, ok, ok ? `agreement ${(across.agreement * 100).toFixed(0)}% (consensus ${(cons.agreement * 100).toFixed(0)}%)${styleNote}` : why.join('; '));
}
if (heroAgreement.length) {
  const sorted = [...heroAgreement].sort((x, y) => x.agreement - y.agreement);
  const med = sorted[Math.floor(sorted.length / 2)].agreement;
  const mean = heroAgreement.reduce((a, h) => a + h.agreement, 0) / heroAgreement.length;
  console.log(`median panel agreement across heroes: ${(med * 100).toFixed(0)}%, mean ${(mean * 100).toFixed(1)}%  (lowest: ${sorted.slice(0, 5).map((h) => `${h.hero} ${(h.agreement * 100).toFixed(0)}%`).join(', ')})`);
  const cs = [...heroAgreement].sort((x, y) => x.consensus - y.consensus);
  const cmed = cs[Math.floor(cs.length / 2)].consensus, cmean = heroAgreement.reduce((a, h) => a + h.consensus, 0) / heroAgreement.length;
  console.log(`median consensus agreement (items core for >=2 reps): ${(cmed * 100).toFixed(0)}%, mean ${(cmean * 100).toFixed(1)}%  (lowest: ${cs.slice(0, 5).map((h) => `${h.hero} ${(h.consensus * 100).toFixed(0)}%`).join(', ')}). Ceiling from the panel itself: npx tsx scripts/ceiling.ts`);
}

console.log(`\nsnapshot fetched ${manifest.fetched_at}; ${fails} failure(s)`);
process.exit(fails ? 1 : 0);
