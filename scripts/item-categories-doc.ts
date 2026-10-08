// Writes docs/item-categories.md: every shopable item with the category the v2 generator gives it and what decided it.
import { readFileSync, writeFileSync } from 'node:fs';
import { categorize } from '../src/generator/v2/categories';
import { roleCurve } from '../src/generator/v2/roles';

const read = (p: string) => JSON.parse(readFileSync(`public/data/${p}`, 'utf8'));
const items = read('items.json').filter((i: any) => i.shopable && !i.disabled);
const d = read('v2/1.json');
const curve = roleCurve(d.timelines);
const buy = new Map<number, number>(d.standard.item_stats.map((r: any) => [r.item_id, r.avg_buy_time_s]));
const rows = items
  .map((i: any) => ({ i, c: categorize(i, buy.get(i.id) ?? null, curve.farmEndS) }))
  .sort((a: any, b: any) => a.c.primary.localeCompare(b.c.primary) || a.i.item_slot_type.localeCompare(b.i.item_slot_type) || a.i.name.localeCompare(b.i.name));
const counts = new Map<string, number>();
for (const r of rows) counts.set(r.c.primary, (counts.get(r.c.primary) ?? 0) + 1);
const out = [
  '# Item categories',
  '',
  `Written by \`npx tsx scripts/item-categories-doc.ts\` from \`public/data/items.json\` (${rows.length} shopable items). The v2 generator (\`src/generator/v2/categories.ts\`) sorts each item by its own stat lines; the property with the largest weighted value decides the category. An item with no deciding stat line is "utility", and its farm/fight side follows when Infernus players buy it (\`data\` in the Source column).`,
  '',
  'Standard-only categories (souls, clear speed, lane sustain) never get a Street Brawl lift.',
  '',
  [...counts].map(([c, n]) => `${c}: ${n}`).join(', '),
  '',
  '| Item | Slot | Tier | Category | Also | Deciding properties | Source |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  ...rows.map(
    ({ i, c }: any) =>
      `| ${i.name} | ${i.item_slot_type} | ${i.item_tier} | ${c.primary} | ${c.all.filter((x: string) => x !== c.primary).join(', ') || '-'} | ${c.deciding.join(', ')} | ${c.source} |`,
  ),
  '',
];
writeFileSync('docs/item-categories.md', out.join('\n'));
console.log(`wrote ${rows.length} items`, Object.fromEntries(counts));
