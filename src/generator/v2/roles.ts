// Role curve: how much of a hero's game time goes to farming (creep and jungle souls) versus fighting (hero damage,
// kills + assists), per 5-minute bucket, from the panel players' post-patch games (docs/build-v2.md).
import type { RoleCurve, V2Data } from './types';

export const BUCKET_S = 300;
export const BUCKETS = 9; // 0-5 ... 40+ min

/** snapshots are cumulative [t, creepSouls, creepKills, heroDamage, kills+assists]; returns per-minute rates of each interval */
export function intervals(snaps: number[][]) {
  const out: { mid: number; m: [number, number, number, number] }[] = [];
  let prev = [0, 0, 0, 0, 0];
  for (const s of snaps) {
    const dt = (s[0] - prev[0]) / 60;
    if (dt >= 1) out.push({ mid: (prev[0] + s[0]) / 2, m: [(s[1] - prev[1]) / dt, (s[2] - prev[2]) / dt, (s[3] - prev[3]) / dt, (s[4] - prev[4]) / dt] });
    prev = s;
  }
  return out;
}

export function roleCurve(t: V2Data['timelines']): RoleCurve {
  const sums = Array.from({ length: BUCKETS }, () => ({ n: 0, m: [0, 0, 0, 0] }));
  for (const g of t.games)
    for (const iv of intervals(g.snaps)) {
      const b = sums[Math.min(BUCKETS - 1, Math.floor(iv.mid / BUCKET_S))];
      b.n++;
      for (let k = 0; k < 4; k++) b.m[k] += iv.m[k];
    }
  const total = sums.reduce((a, b) => a + b.n, 0) || 1;
  // each measure is divided by its own game-long average, so souls and damage (different units) can be compared
  const avg = [0, 1, 2, 3].map((k) => Math.max(1e-9, sums.reduce((a, b) => a + b.m[k], 0) / total));
  const buckets = sums.map((b, i) => {
    const mean = (k: number) => (b.n ? b.m[k] / b.n / avg[k] : 0);
    const farm = (mean(0) + mean(1)) / 2, fight = (mean(2) + mean(3)) / 2;
    return { startS: i * BUCKET_S, farm, fight, farmShare: farm + fight > 0 ? farm / (farm + fight) : 0.5, intervals: b.n };
  });
  // fight window = the first bucket after minute 5 where fight activity (hero damage, kills+assists, each over its own
  // game-long mean) is above 1.0, its game-long average; the farm window is everything before it
  const lead = buckets.findIndex((b, i) => i > 0 && b.intervals > 0 && b.fight > 1);
  return { source: t.source, games: t.games.length, buckets, farmEndS: lead < 0 ? buckets.length * BUCKET_S : buckets[lead].startS };
}

/** farm share of the game's activity at game time t (linear between bucket centres) */
export function farmShareAt(c: RoleCurve, tS: number): number {
  const x = tS / BUCKET_S - 0.5;
  const i = Math.max(0, Math.min(c.buckets.length - 1, Math.floor(x)));
  const j = Math.min(c.buckets.length - 1, i + 1);
  const f = Math.max(0, Math.min(1, x - i));
  return c.buckets[i].farmShare * (1 - f) + c.buckets[j].farmShare * f;
}

export const fmtMin = (s: number) => `${Math.round(s / 60)} min`;
