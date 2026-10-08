// Litmus items the user fixed for Infernus (plans/PLAN.md pass 2). A miss is a verify failure.
import type { Build } from '../../types';
import type { V2Report } from './types';

export const LITMUS: { name: string; want: 'in' | 'out'; noDeny?: boolean }[] = [
  { name: 'Mercurial Magnum', want: 'in' },
  { name: 'Titanic Magazine', want: 'in', noDeny: true },
  { name: 'Healbane', want: 'in', noDeny: true },
  { name: 'Mystic Vulnerability', want: 'in', noDeny: true },
  { name: 'Escalating Exposure', want: 'in' },
  { name: 'Greater Expansion', want: 'out' },
  { name: 'Mystic Expansion', want: 'out' },
];

export interface LitmusResult { name: string; want: 'in' | 'out'; inBuild: boolean; ok: boolean; rule: string }
export function litmusCheck(build: Build, report: V2Report): LitmusResult[] {
  const names = new Set(build.items.map((i) => i.item.name));
  return LITMUS.map((l) => {
    const inBuild = names.has(l.name), row = report.rows.find((r) => r.name === l.name);
    const denied = l.noDeny && row?.denied ? ` DENIED: ${row.denied}` : '';
    const ok = (l.want === 'in') === inBuild && !denied;
    const rule = row ? `${row.denied ?? `brawl term ${(row.brawlLift * 100).toFixed(1)} pts (raw ${(row.brawlRaw * 100).toFixed(1)} x support ${row.supportScale.toFixed(2)} x role ${row.roleScale})`}; std ${(row.stdDelta * 100).toFixed(1)} pts, ${(row.popRel * 100).toFixed(0)}% of top item's games${denied}` : 'not in the standard data';
    return { name: l.name, want: l.want, inBuild, ok, rule };
  });
}
