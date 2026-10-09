import type { ReactNode } from 'react';
import type { Build, BuildItem } from '../types';
import { fmtMin } from '../generator/v2/roles';
import { fmtSouls } from '../text';
import { V2_PARAMS } from '../generator/v2';
import { img } from '../data/load';
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

const PHASE_NAMES = { early: 'Early', mid: 'Mid', late: 'Late' } as const;

function Pic({ src, ring, size = 40 }: { src?: string; ring?: boolean; size?: number }) {
  return <img className={ring ? 'v2-icon v2-ring' : 'v2-icon'} src={src ? img(src) : undefined} alt="" width={size} height={size} />;
}
const Icon = ({ b, ring, size }: { b: BuildItem; ring?: boolean; size?: number }) => (
  <Pic src={b.item.shop_image_webp || b.item.image_webp} ring={ring} size={size} />
);

/** The v2 generator's section of Details: patch, counts, role curve, colour spend, item reasons, denied lifts, counters, Zergggy. */
export function DetailsV2({ build, heroName, children }: { build: Build; heroName: string; children?: ReactNode }) {
  const r = build.v2;
  if (!r) return null;
  const inBuild = new Set(build.items.map((b) => b.item.id));
  const denied = r.rows.filter((x) => x.denied && x.brawlMatches > 0 && (inBuild.has(x.itemId) || x.popRel >= 0.02));
  const litmus = litmusCheck(build, r);
  const liftedIds = new Set(r.placement.rows.filter((x) => x.lifted).map((x) => x.itemId));
  const finalSet = new Set(r.placement.finals);
  const finals = build.items.filter((b) => finalSet.has(b.item.name));
  const swapName = (b: BuildItem) => r.placement.rows.find((x) => x.itemId === b.item.id)?.took ?? 'the standard pick';
  const swaps = build.items.filter((b) => liftedIds.has(b.item.id));
  const sells = build.items.filter((b) => b.sellFor);
  const lastOf = (ph: string) => {
    const rows = build.items.filter((b) => b.phase === ph);
    const t = rows.length ? (r.placement.rows.find((y) => y.itemId === rows[rows.length - 1].item.id)?.time ?? 0) : 0;
    return Math.round(t / 60);
  };
  const phaseLine = `Early to ${lastOf('early')} min · Mid to ${lastOf('mid')} min · Late after`;
  return (
    <section className="v2-details">
      <div className="v2-block">
        <h3>You end with</h3>
        <ul className="v2-final">
          {finals.map((b) => (
            <li key={b.item.id} className={liftedIds.has(b.item.id) ? 'v2-final-brawl' : undefined}>
              <Icon b={b} ring={liftedIds.has(b.item.id)} />
              <span>{b.item.name}</span>
              {liftedIds.has(b.item.id) && <em className="v2-tag">Brawl</em>}
            </li>
          ))}
        </ul>
        <h3>Street Brawl picks</h3>
        <ul className="v2-bullets">
          {swaps.map((b) => (
            <li key={b.item.id}>
              <Icon b={b} size={28} /> <Pic src={r.placement.rows.find((x) => x.itemId === b.item.id)?.tookImage} size={28} /> {b.item.name} over {swapName(b)}:
              wins more in Street Brawl.
            </li>
          ))}
        </ul>
        {sells.length > 0 && (
          <>
            <h3>Sell on the way</h3>
            <ul className="v2-bullets">
              {sells.map((b) => (
                <li key={b.item.id}>
                  <Icon b={b} size={28} /> <Pic src={b.sellFor!.shop_image_webp || b.sellFor!.image_webp} size={28} /> Sell {b.item.name} when you buy{' '}
                  {b.sellFor!.name}.
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="v2-phases">{phaseLine}</p>
      </div>

      <details className="v2-order">
        <summary>Full order</summary>
        {(['early', 'mid', 'late'] as const).map((ph) => (
          <div key={ph}>
            <h3>{PHASE_NAMES[ph]}</h3>
            <ol className="v2-lines">
              {build.items
                .filter((b) => b.phase === ph)
                .map((b) => {
                  const up = build.items.find((o) => o.upgradesFrom?.id === b.item.id);
                  const brawl = liftedIds.has(b.item.id),
                    sell = !!b.sellFor;
                  const note = b.upgradesFrom ? `Upgrade of ${b.upgradesFrom.name}` : up ? `Upgrades into ${up.item.name}` : '';
                  return (
                    <li key={b.item.id} className={brawl || sell ? 'v2-strong' : note ? 'v2-muted' : undefined}>
                      <Icon b={b} /> <span>{b.item.name}</span> <span>{fmtMin(r.placement.rows.find((y) => y.itemId === b.item.id)?.time ?? 0)}</span>
                      {brawl && <em className="v2-tag">Brawl</em>}
                      {sell && <em className="v2-tag v2-tag-sell">Sell</em>}
                      {!brawl && !sell && note && <small>{note}</small>}
                    </li>
                  );
                })}
            </ol>
          </div>
        ))}
      </details>

      <details className="v2-numbers">
        <summary>Show numbers</summary>
        {children}
        <h3>This build's data</h3>
        <p>
          Patch {r.patch.name}, games since {date(r.patch.since)} only. {r.counts.standard.toLocaleString()} {heroName} standard games (Phantom and above) and{' '}
          {r.counts.brawl.toLocaleString()} Street Brawl games.
        </p>

        <h3>Street Brawl weight and checks</h3>
        <p>
          Street Brawl win rate is a direct score term, weight {V2_PARAMS.brawlWeight} (the only weight in the sweep 0.5, 1, 2, 3, 4, 5, 6 that keeps every
          check below right). Must-have and must-not items:
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
                          : `${pts(x.brawlRaw)} (brawl ${x.heroModeLift === null ? '-' : pts(x.heroModeLift)} minus other heroes' brawl ${x.globalModeLift === null ? '-' : pts(x.globalModeLift)}) x ${x.supportScale.toFixed(2)} standard support x ${x.roleScale} ${x.roleScale === 1 ? 'fight' : 'farm'} window = ${pts(x.brawlLift)}${x.spiritRule ? `; ${x.spiritRule}` : ''}`
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
      </details>
    </section>
  );
}
