import { useEffect, useMemo, useState } from 'react';
import { img, loadTierData } from '../data/load';
import { buildTierRows, TIERS, type HeroStats } from '../tiers';
import { slugify } from '../slug';
import { hrefFor } from '../route';
import type { Hero } from '../types';
import { log } from '../log';

function fmtDate(iso: string) {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric' }).format(d);
  const month = new Intl.DateTimeFormat('en-US', { month: 'short' }).format(d);
  return `${day} ${month} ${new Intl.DateTimeFormat('en-GB', { year: 'numeric' }).format(d)}`;
}

export function TierList({ onPickHero }: { onPickHero: (slug: string) => void }) {
  const [data, setData] = useState<{ heroes: Hero[]; stats: HeroStats } | { error: string } | null>(null);
  useEffect(() => {
    loadTierData()
      .then(([heroes, stats]) => setData({ heroes, stats }))
      .catch((e) => {
        log.error('tier_load_failed', { message: String(e) });
        setData({ error: String(e) });
      });
  }, []);
  const rows = useMemo(() => (data && 'stats' in data ? buildTierRows(data.heroes, data.stats) : []), [data]);

  if (data && 'error' in data)
    return (
      <main className="tiers">
        <div className="error" role="alert">
          {data.error}
        </div>
      </main>
    );
  return (
    <main className="tiers">
      <div className="tiers-head">
        <h1>Tier List</h1>
        <p>
          Heroes ranked by win rate in Phantom and above games over the last {data && 'stats' in data ? data.stats.window_days : 30} days.
          {data && 'stats' in data && <> Data from {fmtDate(data.stats.fetched_at)}.</>}
        </p>
      </div>
      {!data && (
        <div className="tier-rows" aria-hidden="true">
          {TIERS.map((t) => (
            <div key={t.key} className="tier-skel" />
          ))}
        </div>
      )}
      {data && (
        <div className="tier-rows">
          {rows
            .filter((r) => r.heroes.length)
            .map((r) => (
              <section key={r.tier.key} className="tier-row" data-tier={r.tier.key} aria-label={`${r.tier.key} tier, ${r.tier.name}`}>
                <h2 className="tier-tag">
                  <b>{r.tier.key}</b>
                  <span>{r.tier.name}</span>
                </h2>
                <ul className="tier-heroes">
                  {r.heroes.map(({ hero }) => (
                    <li key={hero.id}>
                      <a
                        className="tier-hero"
                        href={`${hrefFor('build').split('?')[0]}?hero=${slugify(hero.name)}`}
                        onClick={(e) => {
                          if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                          e.preventDefault();
                          onPickHero(slugify(hero.name));
                        }}
                      >
                        <img src={img(hero.images.small ?? hero.images.card)} alt="" width={72} height={72} loading="lazy" />
                        <span>{hero.name}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
        </div>
      )}
      {data && (
        <details className="tier-rule">
          <summary>How tiers are set</summary>
          <p>
            Win rate is wins divided by games, counting only Phantom and above games. S+ is 54% or more, S 52–54%, A 50–52%, B 48–50%, C 46–48%, D under 46%.
            Best win rate comes first inside a tier.
          </p>
        </details>
      )}
    </main>
  );
}
