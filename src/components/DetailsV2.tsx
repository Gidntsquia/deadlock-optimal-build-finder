import type { Build } from '../types';
import { fmtMin } from '../generator/v2/roles';
import { fmtSouls } from '../text';
import { V2_PARAMS } from '../generator/v2';
import { litmusCheck } from '../generator/v2/litmus';

const pct = (n: number, d = 0) => `${(n * 100).toFixed(d)}%`;
const pts = (n: number) => `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)} pts`;
const COLOUR = { weapon: 'Weapon', vitality: 'Vitality', spirit: 'Spirit' } as const;
const CAT: Record<string, string> = {
  clearSpeed: 'clear speed',
  souls: 'souls',
  laneSustain: 'lane sustain',
  weaponDamage: 'weapon damage',
  spiritDamage: 'spirit damage',
  survivability: 'survivability',
  mobility: 'mobility',
  actives: 'actives',
  utility: 'utility',
};
const date = (unix: number) => {
  const d = new Date(unix * 1000);
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}-${d.getUTCFullYear()}`;
};

/** The v2 generator's section of Details: patch, counts, role curve, colour spend, item reasons, denied lifts, counters, Zergggy. */
export function DetailsV2({ build, heroName }: { build: Build; heroName: string }) {
  const r = build.v2;
  if (!r) return null;
  const inBuild = new Set(build.items.map((b) => b.item.id));
  const denied = r.rows.filter((x) => x.denied && x.brawlMatches > 0 && (inBuild.has(x.itemId) || x.popRel >= 0.02));
  const litmus = litmusCheck(build, r);
  return (
    <section className="v2-details">
      <h3>This build's rules</h3>
      <p>
        Patch {r.patch.name}, games since {date(r.patch.since)} only. {r.counts.standard.toLocaleString()} {heroName} standard games (Phantom and above) and{' '}
        {r.counts.brawl.toLocaleString()} Street Brawl games.
      </p>

      <h3>Street Brawl weight and checks</h3>
      <p>
        Street Brawl win rate is a direct score term, weight {V2_PARAMS.brawlWeight} (the lowest weight in the sweep 0.5, 1, 1.5, 2, 3, 4 that keeps every check
        below right). Must-have and must-not items:
      </p>
      <ul className="litmus">
        {litmus.map((l) => (
          <li key={l.name}>
            {l.name}: {l.inBuild ? 'in' : 'out'} (wanted {l.want}) {l.ok ? 'ok' : 'MISSED'} - {l.rule}
          </li>
        ))}
      </ul>

      <h3>Farm then fight</h3>
      <p>
        {r.curve.source === 'panel'
          ? `From ${r.curve.games} games by the top ${heroName} players.`
          : `From ${r.curve.games} games, all players (the top players have too few).`}{' '}
        The fight window starts at minute {Math.round(r.curve.farmEndS / 60)}, the first 5-minute stretch after minute 5 where fight activity (damage, kills,
        assists) is above its game-long average. The Street Brawl term counts in full there and half before it. Early items are chosen for farming, later ones
        for fighting.
      </p>
      <table className="panel-table">
        <thead>
          <tr>
            <th>Minutes</th>
            <th>Farm</th>
            <th>Fight</th>
            <th>Farm share</th>
          </tr>
        </thead>
        <tbody>
          {r.curve.buckets.map((b) => (
            <tr key={b.startS}>
              <td>
                {fmtMin(b.startS)}-{fmtMin(b.startS + 300)}
              </td>
              <td>{b.farm.toFixed(2)}</td>
              <td>{b.fight.toFixed(2)}</td>
              <td>{pct(b.farmShare)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Colour spend</h3>
      <ul>
        {r.colours.map((c) => (
          <li key={c.slot}>
            {COLOUR[c.slot as keyof typeof COLOUR] ?? c.slot}: {fmtSouls(c.total)}
            {c.crossing ? `, passes ${fmtSouls(c.crossing.threshold)} at ${c.crossing.name}` : ', stays under the spike'}
          </li>
        ))}
      </ul>
      <p>{r.spikeSource}</p>

      <h3>Why each item</h3>
      <div className="details-scroll">
        <table className="panel-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Kind</th>
              <th>Role</th>
              <th>Standard</th>
              <th>Brawl term</th>
              <th>Spike</th>
            </tr>
          </thead>
          <tbody>
            {build.items.map((b) => {
              const x = r.rows.find((y) => y.itemId === b.item.id);
              return (
                <tr key={b.item.id}>
                  <td>{b.item.name}</td>
                  <td>{x ? CAT[x.category] : ''}</td>
                  <td>{x?.roleNote ?? ''}</td>
                  <td>{x ? `${pts(x.stdDelta)} win rate, ${pct(x.popRel)} of top item's games` : ''}</td>
                  <td>
                    {x
                      ? x.denied
                        ? `none: ${x.denied}`
                        : `${pts(x.brawlRaw)} (brawl ${x.heroModeLift === null ? '-' : pts(x.heroModeLift)} minus game-mode ${x.globalModeLift === null ? '-' : pts(x.globalModeLift)}) x ${x.supportScale.toFixed(2)} standard support x ${x.roleScale} ${x.roleScale === 1 ? 'fight' : 'farm'} window = ${pts(x.brawlLift)}${x.spiritRule ? `; ${x.spiritRule}` : ''}`
                      : ''}
                  </td>
                  <td>{b.spike ? `takes ${b.spike.slot} past ${fmtSouls(b.spike.threshold)}` : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {denied.length > 0 && (
        <>
          <h3>Street Brawl terms that were zeroed</h3>
          <ul>
            {denied.map((x) => (
              <li key={x.itemId}>
                {x.name}: {x.denied}
                {inBuild.has(x.itemId) ? ' (still in the build)' : ''}
              </li>
            ))}
          </ul>
        </>
      )}

      <h3>Against the most-played enemies</h3>
      {r.enemies.map((e) => (
        <div key={e.heroId}>
          <p>
            <b>{e.name}</b> ({e.games.toLocaleString()} games)
          </p>
          {e.swaps.length === 0 ? (
            <p>No swap has enough games and a clear gain.</p>
          ) : (
            <ul>
              {e.swaps.map((s) => (
                <li key={s.itemId}>
                  {s.name}
                  {s.replaces ? ` for ${s.replaces}` : ''} - {s.reason} [{s.source}, {s.games} games]
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}

      <h3>Zergggy</h3>
      <p>
        {r.zergggy.games} {r.zergggy.games === 1 ? 'game' : 'games'} since the patch (of {r.zergggy.sinceTotal} {heroName} games). In both:{' '}
        {r.zergggy.shared.join(', ') || 'nothing'}.
      </p>
      {r.zergggy.onlyHis.length > 0 && <p>Only his: {r.zergggy.onlyHis.map((x) => `${x.name} (${x.reason})`).join('; ')}</p>}
      {r.zergggy.onlyBuild.length > 0 && <p>Only this build: {r.zergggy.onlyBuild.map((x) => `${x.name} (${x.reason})`).join('; ')}</p>}

      {r.notes.map((n) => (
        <p key={n}>{n}</p>
      ))}
    </section>
  );
}
