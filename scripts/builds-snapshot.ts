// Prints every hero's v1 build (item ids, order, ability order) as JSON, one line per hero/build. `npm run verify` uses the same
// text to prove v2 left the other heroes alone: diff this output against a run from an earlier commit.
import { readFileSync } from 'node:fs';
import { generateBuilds } from '../src/generator';
const read = (p: string) => JSON.parse(readFileSync(`public/data/${p}`, 'utf8'));
const items = read('items.json'),
  heroes = read('heroes.json'),
  abilities = read('abilities.json');
for (const hero of heroes) {
  const builds = generateBuilds({ hero, abilities, items, analytics: read(`analytics/${hero.id}.json`) });
  for (const b of builds)
    console.log(
      JSON.stringify([
        hero.id,
        b.key,
        b.items.map((i) => [i.item.id, i.phase, i.runningTotal, i.reasons.join('|'), i.score]),
        b.abilityOrder.map((s) => [s.ability.id, s.kind]),
      ]),
    );
}
