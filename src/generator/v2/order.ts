// v2 buy order (docs/build-v2.md rule 10): an item in the build only because of its Street Brawl term takes the spot of the
// standard item it displaced; the 12-slot sells, phases, running totals and colour spike are then recomputed on that order.
import type { Build, BuildItem, Phase, SlotType } from '../../types';
import { PARAMS } from '../stats';
import type { ColourTotal, PlacementRow, SellStat } from './types';

// a spot more than one tier away is no stand-in (a 6,400-soul T4 cannot sit where a T1 was bought): such an item goes to the next rule
const MAX_TIER_GAP = 1;
const PHASES: Phase[] = ['early', 'mid', 'late'];
export interface Placement { rows: PlacementRow[]; lifted: string[]; displaced: string[]; maxHeld: number }

export function reorder(build: Build, baseline: Build, sell: SellStat[], thresholds: number[]): { placement: Placement; colours: ColourTotal[] } {
  const baseIds = new Set(baseline.items.map((b) => b.item.id)), finalIds = new Set(build.items.map((b) => b.item.id));
  // only items kept to the end take or give up a spot: a component (Grit under Reactive Barrier) rides with its upgrade
  const compIds = (b: Build) => new Set(b.items.flatMap((o) => (o.upgradesFrom ? [o.upgradesFrom.id] : [])));
  const comps = compIds(build), baseComps = compIds(baseline);
  const lifted = build.items.filter((b) => !baseIds.has(b.item.id) && !comps.has(b.item.id));
  const displaced = baseline.items.filter((b) => !finalIds.has(b.item.id) && !baseComps.has(b.item.id));
  const key = new Map<number, number>(build.items.map((b) => [b.item.id, b.avgBuyTimeS]));
  const source = new Map<number, string>();
  const free = [...displaced];
  const take = (b: BuildItem, d: BuildItem) => { key.set(b.item.id, d.avgBuyTimeS); source.set(b.item.id, `took ${d.item.name}'s spot`); free.splice(free.indexOf(d), 1); };
  const dist = (b: BuildItem, d: BuildItem) => [Math.abs(b.item.item_tier - d.item.item_tier), Math.abs(b.item.cost - d.item.cost)];
  const nearest = (b: BuildItem, pool: BuildItem[]) => [...pool].filter((d) => dist(b, d)[0] <= MAX_TIER_GAP).sort((x, y) => { const a = dist(b, x), c = dist(b, y); return a[0] - c[0] || a[1] - c[1] || x.item.id - y.item.id; })[0];
  const todo: BuildItem[] = [];
  for (const b of [...lifted].sort((x, y) => y.item.cost - x.item.cost || x.item.id - y.item.id)) {
    const d = nearest(b, free.filter((f) => f.item.item_slot_type === b.item.item_slot_type));
    if (d) take(b, d); else todo.push(b);
  }
  for (const b of todo) {
    const d = nearest(b, free);
    if (d) take(b, d);
  }
  const phaseOf = (t: number): Phase => (t < PARAMS.phaseTimeS.early ? 'early' : t < PARAMS.phaseTimeS.mid ? 'mid' : 'late');
  for (const b of todo) {
    if (source.has(b.item.id)) continue;
    const ph = phaseOf(b.avgBuyTimeS), mates = build.items.filter((o) => !lifted.includes(o) && phaseOf(key.get(o.item.id)!) === ph).sort((x, y) => key.get(x.item.id)! - key.get(y.item.id)!);
    const after = mates.find((o) => o.item.cost > b.item.cost);
    key.set(b.item.id, after ? key.get(after.item.id)! - 0.001 : (mates.length ? key.get(mates[mates.length - 1].item.id)! + 0.001 : b.avgBuyTimeS));
    source.set(b.item.id, 'placed by cost in its phase');
  }

  // a component is bought at its own standard time, or just before its upgrade's spot if that comes first
  for (let changed = true; changed; ) {
    changed = false;
    for (const b of build.items) {
      const c = b.upgradesFrom && build.items.find((o) => o.item.id === b.upgradesFrom!.id);
      if (!c || key.get(c.item.id)! < key.get(b.item.id)!) continue;
      key.set(c.item.id, key.get(b.item.id)! - 0.001); changed = true;
    }
  }
  for (const b of build.items) {
    const up = build.items.find((o) => o.upgradesFrom?.id === b.item.id);
    if (up && !source.has(b.item.id) && !baseIds.has(b.item.id)) source.set(b.item.id, `bought first, upgrades into ${up.item.name}`);
  }
  // sell points again, same rule as build.ts: sell the earliest sell-later item held when a purchase would pass the slot count
  const sellOk = new Set(sell.filter((s) => s.buyers >= PARAMS.sellMinBuyers && s.sold / s.buyers >= PARAMS.sellMinShare).map((s) => s.item_id));
  const rateOf = new Map(sell.map((s) => [s.item_id, s.sold / s.buyers]));
  const wasSold = new Set(build.items.filter((b) => b.sellFor).map((b) => b.item.id));
  const strip = (r: string) => !r.startsWith('some top players sell it later');
  let items: BuildItem[] = [], maxHeld = 0, running = 0;
  const waits = new Set<BuildItem>();
  const cash: Record<string, number> = {};
  const crossing: Record<string, ColourTotal['crossing']> = {};
  // walk the order; if a buy would pass 12 held with nothing to sell, a component bought early waits until just before
  // its upgrade (it holds a slot the whole time in between) and the walk runs again
  for (let pass = 0; pass <= build.items.length; pass++) {
    items = [...build.items].sort((a, b) => key.get(a.item.id)! - key.get(b.item.id)! || a.item.cost - b.item.cost || a.item.id - b.item.id);
    for (const c of waits) { // a component that waits is bought together with its upgrade
      const ci = items.indexOf(c), up = items.findIndex((o) => o.upgradesFrom?.id === c.item.id);
      if (up > ci + 1) { items.splice(ci, 1); items.splice(up - 1, 0, c); }
    }
    for (let i = 0; i < items.length; i++) { // a component is listed before the item that upgrades from it
      const up = items.findIndex((c, k) => k < i && c.upgradesFrom?.id === items[i].item.id);
      if (up >= 0) { const [c] = items.splice(i, 1); items.splice(up, 0, c); }
    }
    for (const b of items) { b.sellFor = undefined; b.sellRate = undefined; b.reasons = b.reasons.filter(strip); b.spike = undefined; }
    const held: BuildItem[] = [];
    maxHeld = 0; running = 0;
    for (const k of Object.keys(crossing)) delete crossing[k];
    Object.assign(cash, { weapon: 0, vitality: 0, spirit: 0 });
    let delay: BuildItem | null = null;
    items.forEach((b, i) => {
      if (b.upgradesFrom) { const k = held.findIndex((h) => h.item.id === b.upgradesFrom!.id); if (k >= 0) held.splice(k, 1); }
      if (!b.upgradesFrom && held.length >= PARAMS.maxItems) {
        const laterComp = new Set(items.slice(i + 1).map((o) => o.upgradesFrom?.id));
        // items top players really sell first (post-patch sell stats), then ones the selection marked sell-later
        const free = (h: BuildItem) => !laterComp.has(h.item.id);
        let k = held.findIndex((h) => sellOk.has(h.item.id) && free(h));
        if (k < 0) k = held.findIndex((h) => wasSold.has(h.item.id) && free(h));
        // a component bought right before its upgrade: the sale comes at the component, on the way to the upgrade
        const next = items[i + 1]?.upgradesFrom?.id === b.item.id ? items[i + 1].item : null;
        if (k >= 0) {
          const [out] = held.splice(k, 1);
          out.sellFor = b.item; out.sellRate = rateOf.get(out.item.id);
          out.reasons = [`some top players sell it later to make room; sell it when you buy ${b.item.name}${next ? ` (on the way to ${next.name})` : ''}`, ...out.reasons];
          cash[out.item.item_slot_type] -= out.item.cost; // the whole item leaves, component value included
        } else if (!delay) {
          const ups = held.map((h) => ({ h, at: items.findIndex((o, j) => j > i && o.upgradesFrom?.id === h.item.id) })).filter((x) => x.at > i + 1);
          const far = ups.sort((x, y) => y.at - x.at)[0];
          if (far) delay = far.h;
        }
      }
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
    });
    if (!delay) break;
    const d: BuildItem = delay, up = items.find((o) => o.upgradesFrom?.id === d.item.id)!;
    key.set(d.item.id, key.get(up.item.id)! - 0.0001);
    waits.add(d);
    source.set(d.item.id, `${source.get(d.item.id) ?? 'standard time'}; waits until just before ${up.item.name} to keep 12 slots`);
  }
  if (new Set(items.map((b) => b.phase)).size < 3) items.forEach((b, i) => { b.phase = i < items.length / 3 ? 'early' : i < (2 * items.length) / 3 ? 'mid' : 'late'; });
  build.items = items; build.totalCost = running;
  const colours: ColourTotal[] = (['weapon', 'vitality', 'spirit'] as SlotType[]).map((slot) => ({ slot, total: cash[slot], crossing: crossing[slot] ?? null }));
  const rows: PlacementRow[] = items.map((b) => ({ itemId: b.item.id, name: b.item.name, slot: b.order, source: source.get(b.item.id) ?? 'standard time', lifted: lifted.includes(b) }));
  return { placement: { rows, lifted: lifted.map((b) => b.item.name), displaced: displaced.map((b) => b.item.name), maxHeld }, colours };
}
