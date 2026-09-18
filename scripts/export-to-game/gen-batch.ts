// One-off: generate every build style for a list of heroes and write
// scripts/export-to-game/hero_<class_name>-<style-key>.json for each, ready for export_to_game.py --apply.
import { readFileSync, writeFileSync } from 'node:fs';
import { generateBuilds } from '../../src/generator';
import { toGameBuildJson } from '../../src/export/game-json';

const read = (p: string) => JSON.parse(readFileSync(`public/data/${p}`, 'utf8'));
const items = read('items.json'), heroes = read('heroes.json'), abilities = read('abilities.json');

const heroIds = process.argv.slice(2).map(Number);

for (const heroId of heroIds) {
  const hero = heroes.find((h: any) => h.id === heroId);
  if (!hero) throw new Error(`hero ${heroId} not in snapshot`);
  const analytics = read(`analytics/${heroId}.json`);
  const builds = generateBuilds({ hero, abilities, items, analytics });
  if (builds.length === 0) throw new Error(`no builds generated for hero ${heroId}`);

  for (const build of [...builds].sort((a, b) => (b.population.style?.share ?? 1) - (a.population.style?.share ?? 1))) {
    const json = toGameBuildJson(build, hero);
    const styleKey = build.population.style?.key ?? 'standard';
    const outPath = `scripts/export-to-game/${hero.class_name}-${styleKey}.json`;
    writeFileSync(outPath, JSON.stringify(json, null, 2));
    console.log(`${hero.name} (${heroId}) -> ${outPath}  [${build.name}, ${json.categories.reduce((n, c) => n + c.item_ids.length, 0)} items, tags=${json.tags}]`);
  }
}
