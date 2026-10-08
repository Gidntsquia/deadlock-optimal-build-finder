// v2: an upgrade in the build is bought from its component (docs/build-v2.md rule 11). The component takes no slot of
// its own at the end (the upgrade replaces it) and costs nothing extra in total, so it is always in the build when its
// upgrade is: Grit before Reactive Barrier, Extra Charge before Rapid Recharge.
import type { Build, Item } from '../../types';
import type { SlimStat } from './types';

export function completeChains(build: Build, items: Item[], std: SlimStat[]): string[] {
  const byClass = new Map(items.filter((i) => i.shopable && !i.disabled).map((i) => [i.class_name, i]));
  const stat = new Map(std.map((s) => [s.item_id, s]));
  const maxStd = Math.max(1, ...std.map((s) => s.matches));
  const added: string[] = [];
  for (let changed = true; changed; ) {
    changed = false;
    for (const b of [...build.items]) {
      if (b.upgradesFrom) continue;
      const comp = b.item.component_items.map((c) => byClass.get(c)).find((c): c is Item => !!c);
      if (!comp || build.items.some((o) => o.upgradesFrom?.id === comp.id)) continue;
      let c = build.items.find((o) => o.item.id === comp.id);
      if (!c) {
        const s = stat.get(comp.id);
        const t = Math.min(s?.avg_buy_time_s ?? b.avgBuyTimeS, b.avgBuyTimeS - 1);
        c = {
          item: comp, phase: b.phase, order: 0, runningTotal: 0, paidCost: comp.cost, score: 0, avgBuyTimeS: t,
          usageRate: s ? s.matches / maxStd : 0, winRate: s ? s.wins / s.matches : 0,
          reasons: [`buy it first and upgrade it into ${b.item.name}: it costs nothing extra and takes no slot at the end`],
        };
        build.items.push(c);
        added.push(comp.name);
      }
      c.sellFor = undefined;
      b.upgradesFrom = comp;
      b.paidCost = b.item.cost - comp.cost;
      b.reasons = [`upgrades ${comp.name} already in the build; pays only the ${b.paidCost} soul difference`, ...b.reasons];
      changed = true;
    }
  }
  return added;
}
