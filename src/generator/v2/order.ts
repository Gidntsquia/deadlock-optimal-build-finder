// v2 buy order (docs/build-v2.md rules 10-11). Pick the 12 items held at the end first; a Street Brawl item among them
// enters at the buy time of the standard item it pushed out; components keep their own standard time; a walk over the
// order sells (or cuts) items so no more than 12 are ever held. Phases, running totals and the colour spike follow.
import type { Build, BuildItem, Phase, SlotType } from '../../types';
import { PARAMS } from '../stats';
import { LITMUS } from './litmus';
import type { ColourTotal, PlacementRow, SellStat } from './types';

// a spot more than one tier away is no stand-in (a 6,400-soul T4 cannot sit where a T1 was bought)
const MAX_TIER_GAP = 1;
const PHASES: Phase[] = ['early', 'mid', 'late'];
const MAX_PER_PHASE = 11;
export interface Placement { rows: PlacementRow[]; lifted: string[]; displaced: string[]; finals: string[]; standardFinals: string[]; cut: string[]; maxHeld: number }

/** the items held at the end: not a component of a build item, not marked sell-later by the selection; best score wins if more than 12 */
function endState(b: Build, keep: Set<number> = new Set()): BuildItem[] {
  const comps = new Set(b.items.flatMap((o) => (o.upgradesFrom ? [o.upgradesFrom.id] : [])));
  const kept = b.items.filter((o) => !comps.has(o.item.id) && !o.sellFor);
  const rest = b.items.filter((o) => !comps.has(o.item.id) && o.sellFor);
  const pool = [...kept, ...rest.sort((x, y) => y.score - x.score)];
  // a must-have the standard 12 holds (`keep`) keeps its place; the rest go by score
  const ranked = kept.length >= PARAMS.maxItems ? [...kept].sort((x, y) => y.score - x.score) : pool;
  const musts = [...kept, ...rest].filter((o) => keep.has(o.item.id));
  return [...musts, ...ranked.filter((o) => !keep.has(o.item.id))].slice(0, PARAMS.maxItems);
}

export function reorder(build: Build, baseline: Build, sell: SellStat[], thresholds: number[]): { placement: Placement; colours: ColourTotal[] } {
  const stdFinals = endState(baseline);
  const must = new Set(LITMUS.filter((l) => l.want === 'in').map((l) => l.name));
  const finals = endState(build, new Set([...stdFinals, ...endState(build)].filter((b) => must.has(b.item.name)).map((b) => b.item.id)));
  const finalIds = new Set(finals.map((b) => b.item.id)), stdIds = new Set(stdFinals.map((b) => b.item.id));
  const lifted = finals.filter((b) => !stdIds.has(b.item.id));
  const pushed = stdFinals.filter((b) => !finalIds.has(b.item.id));
  const key = new Map<number, number>(build.items.map((b) => [b.item.id, b.avgBuyTimeS]));
  const source = new Map<number, string>();
  const tookFrom = new Map<number, string>();
  const free = [...pushed];
  const dist = (b: BuildItem, d: BuildItem) => [Math.abs(b.item.item_tier - d.item.item_tier), Math.abs(b.item.cost - d.item.cost)];
  const nearest = (b: BuildItem, pool: BuildItem[]) => [...pool].filter((d) => dist(b, d)[0] <= MAX_TIER_GAP).sort((x, y) => { const a = dist(b, x), c = dist(b, y); return a[0] - c[0] || a[1] - c[1] || x.item.id - y.item.id; })[0];
  const take = (b: BuildItem, d: BuildItem) => { key.set(b.item.id, d.avgBuyTimeS); source.set(b.item.id, `took ${d.item.name}'s spot (${Math.round(d.avgBuyTimeS / 60)} min)`); tookFrom.set(b.item.id, d.item.name); free.splice(free.indexOf(d), 1); };
  const todo: BuildItem[] = [];
  for (const b of [...lifted].sort((x, y) => y.item.cost - x.item.cost || x.item.id - y.item.id)) {
    const d = nearest(b, free.filter((f) => f.item.item_slot_type === b.item.item_slot_type)) ?? nearest(b, free);
    if (d) take(b, d); else todo.push(b);
  }
  // no pushed-out item is close enough in tier: sit just after the standard end item nearest in price that stays in the build
  for (const b of todo) {
    const stay = stdFinals.filter((d) => finalIds.has(d.item.id));
    const d = [...stay].sort((x, y) => Math.abs(x.item.cost - b.item.cost) - Math.abs(y.item.cost - b.item.cost) || x.item.id - y.item.id)[0];
    if (d) { key.set(b.item.id, d.avgBuyTimeS + 0.001); source.set(b.item.id, `took ${d.item.name}'s spot (${Math.round(d.avgBuyTimeS / 60)} min, same price)`); tookFrom.set(b.item.id, d.item.name); }
  }

  // components: own standard time, moved earlier only when it would fall after its upgrade
  for (let changed = true; changed; ) {
    changed = false;
    for (const b of build.items) {
      const c = b.upgradesFrom && build.items.find((o) => o.item.id === b.upgradesFrom!.id);
      if (!c || key.get(c.item.id)! < key.get(b.item.id)!) continue;
      key.set(c.item.id, key.get(b.item.id)! - 0.001); changed = true;
    }
  }
  const upOf = (c: BuildItem) => build.items.find((o) => o.upgradesFrom?.id === c.item.id);

  // spill: selected items outside the final 12 stay only if bought before the first item of a higher tier of their colour, and before the last final buy
  const lastFinal = Math.max(...finals.map((b) => key.get(b.item.id)!));
  const spill = build.items.filter((b) => !finalIds.has(b.item.id) && !upOf(b));
  const finalOrChain = new Set<number>();
  for (const f of finals) for (let x: BuildItem | undefined = f; x; x = x.upgradesFrom && build.items.find((o) => o.item.id === x!.upgradesFrom!.id)) finalOrChain.add(x.item.id);
  const dropped = new Set<number>(), cut: string[] = [];
  const dropSpill = (b: BuildItem, why: string) => { dropped.add(b.item.id); cut.push(b.item.name); source.set(b.item.id, why); };
  for (const b of spill) {
    const nextTier = Math.min(...finals.filter((f) => f.item.item_slot_type === b.item.item_slot_type && f.item.item_tier > b.item.item_tier).map((f) => key.get(f.item.id)!));
    if (key.get(b.item.id)! > lastFinal || key.get(b.item.id)! >= nextTier) dropSpill(b, 'dropped: bought too late to be sold usefully');
  }
  // an upgrade that is dropped leaves its component as an ordinary item
  const live = () => build.items.filter((b) => !dropped.has(b.item.id));
  const fixChains = () => { for (const b of build.items) if (b.upgradesFrom && dropped.has(b.item.id)) b.upgradesFrom = undefined; };

  const phaseOf = (t: number): Phase => (t < PARAMS.phaseTimeS.early ? 'early' : t < PARAMS.phaseTimeS.mid ? 'mid' : 'late');
  const sellOk = new Set(sell.filter((s) => s.buyers >= PARAMS.sellMinBuyers && s.sold / s.buyers >= PARAMS.sellMinShare).map((s) => s.item_id));
  const rateOf = new Map(sell.map((s) => [s.item_id, s.sold / s.buyers]));
  const strip = (r: string) => !r.startsWith('some top players sell it later');
  let items: BuildItem[] = [], maxHeld = 0, running = 0;
  const cash: Record<string, number> = {};
  const crossing: Record<string, ColourTotal['crossing']> = {};
  const protect = new Set(LITMUS.filter((l) => l.want === 'in').map((l) => l.name)); // a spill item the user named is cut last
  const original = [...build.items];
  const upgrades = new Map(original.filter((b) => b.upgradesFrom).map((b) => [b.item.id, b.upgradesFrom!]));
  for (let pass = 0; pass <= original.length * 2; pass++) {
    for (const b of original) b.upgradesFrom = dropped.has(b.item.id) ? undefined : upgrades.get(b.item.id);
    items = live().sort((a, b) => key.get(a.item.id)! - key.get(b.item.id)! || a.item.cost - b.item.cost || a.item.id - b.item.id);
    for (let i = 0; i < items.length; i++) { // a component is always listed before the item that upgrades from it
      const up = items.findIndex((c, k) => k < i && c.upgradesFrom?.id === items[i].item.id);
      if (up >= 0) { const [c] = items.splice(i, 1); items.splice(up, 0, c); }
    }
    for (const b of items) { b.sellFor = undefined; b.sellRate = undefined; b.reasons = b.reasons.filter(strip); b.spike = undefined; }
    const held: BuildItem[] = [];
    maxHeld = 0; running = 0;
    for (const k of Object.keys(crossing)) delete crossing[k];
    Object.assign(cash, { weapon: 0, vitality: 0, spirit: 0 });
    let stuck: BuildItem | null = null, delayComp: BuildItem | null = null;
    for (let i = 0; i < items.length && !stuck && !delayComp; i++) {
      const b = items[i];
      if (b.upgradesFrom) { const k = held.findIndex((h) => h.item.id === b.upgradesFrom!.id); if (k >= 0) held.splice(k, 1); }
      if (!b.upgradesFrom && held.length >= PARAMS.maxItems) {
        const laterComp = new Set(items.slice(i + 1).map((o) => o.upgradesFrom?.id));
        const can = (h: BuildItem) => !finalOrChain.has(h.item.id) && !laterComp.has(h.item.id);
        const pick = (pred: (h: BuildItem) => boolean) => held.filter((h) => can(h) && pred(h)).sort((x, y) => x.score - y.score || x.item.id - y.item.id)[0];
        const out = pick((h) => sellOk.has(h.item.id)) ?? pick(() => true);
        if (out) {
          held.splice(held.indexOf(out), 1);
          out.sellFor = b.item; out.sellRate = rateOf.get(out.item.id);
          out.reasons = [`some top players sell it later to make room; sell it when you buy ${b.item.name}`, ...out.reasons];
          cash[out.item.item_slot_type] -= out.item.cost;
        } else {
          const lowSpill = items.slice(i + 1).filter((o) => !finalOrChain.has(o.item.id) && !upOf(o)).sort((x, y) => Number(protect.has(x.item.name)) - Number(protect.has(y.item.name)) || x.score - y.score)[0];
          if (lowSpill) stuck = lowSpill;
          else { // last resort: a component bought early waits until just before its upgrade
            const ups = held.map((h) => ({ h, at: items.findIndex((o, j) => j > i && o.upgradesFrom?.id === h.item.id) })).filter((x) => x.at > i + 1).sort((x, y) => y.at - x.at);
            delayComp = ups[0]?.h ?? null;
          }
        }
      }
      if (stuck || delayComp) break;
      held.push(b); maxHeld = Math.max(maxHeld, held.length);
      b.order = i + 1; b.paidCost = b.item.cost - (b.upgradesFrom?.cost ?? 0); running += b.paidCost; b.runningTotal = running;
      const slot = b.item.item_slot_type as SlotType, before = cash[slot];
      cash[slot] += b.paidCost;
      for (const t of thresholds) if (before < t && cash[slot] >= t) {
        b.spike = { slot, threshold: t };
        if (t === thresholds[thresholds.length - 1] && !crossing[slot]) crossing[slot] = { itemId: b.item.id, name: b.item.name, threshold: t };
      }
      b.phase = phaseOf(key.get(b.item.id)!);
      const prev = items[i - 1]?.phase; // phases never step back along the order
      if (prev && PHASES.indexOf(prev) > PHASES.indexOf(b.phase)) b.phase = prev;
    }
    if (stuck) { dropSpill(stuck, 'dropped: no slot to sell for it'); continue; }
    if (delayComp) {
      const d: BuildItem = delayComp, up = upOf(d)!;
      key.set(d.item.id, key.get(up.item.id)! - 0.0001);
      source.set(d.item.id, `${source.get(d.item.id) ?? 'standard time'}; waits until just before ${up.item.name} to keep 12 slots`);
      continue;
    }
    break;
  }
  fixChains();
  // a phase row on screen holds about 11 tiles: the tail of an over-full phase moves to the next one
  for (const [i, ph] of PHASES.slice(0, 2).entries()) {
    const inPh = items.filter((b) => b.phase === ph);
    for (const b of inPh.slice(MAX_PER_PHASE)) b.phase = PHASES[i + 1];
  }
  if (new Set(items.map((b) => b.phase)).size < 3) items.forEach((b, i) => { b.phase = i < items.length / 3 ? 'early' : i < (2 * items.length) / 3 ? 'mid' : 'late'; });
  build.items = items; build.totalCost = running;
  const colours: ColourTotal[] = (['weapon', 'vitality', 'spirit'] as SlotType[]).map((slot) => ({ slot, total: cash[slot], crossing: crossing[slot] ?? null }));
  for (const b of items) { const up = items.find((o) => o.upgradesFrom?.id === b.item.id); if (up && !source.has(b.item.id)) source.set(b.item.id, `bought first, upgrades into ${up.item.name}`); }
  const liftedIds = new Set(lifted.map((b) => b.item.id));
  const rows: PlacementRow[] = items.map((b) => ({
    itemId: b.item.id, name: b.item.name, slot: b.order, source: source.get(b.item.id) ?? 'standard time', lifted: liftedIds.has(b.item.id),
    took: tookFrom.get(b.item.id), soldFor: b.sellFor?.name, time: key.get(b.item.id)!,
  }));
  return { placement: { rows, lifted: lifted.map((b) => b.item.name), displaced: pushed.map((b) => b.item.name), finals: finals.map((b) => b.item.name), standardFinals: stdFinals.map((b) => b.item.name), cut, maxHeld }, colours };
}
