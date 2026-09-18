import { useEffect, useMemo, useReducer, useState } from 'react';
import type { Ability, Build, Hero, HeroAnalytics, Item } from './types';
import { img, loadAnalytics, loadCore, type Manifest } from './data/load';
import { generateBuilds } from './generator';
import { computeCoreSet, loadHeldout, validateAgainstPanel, type CoreSet, type HeldoutPurchases, type HeldoutSet } from './validation/heldout';
import { BuildView } from './components/BuildView';
import { log } from './log';

const INFERNUS = 1;

interface CoreState {
  items: Item[];
  heroes: Hero[];
  abilities: Ability[];
  manifest: Manifest | null;
  error: string | null;
}
type CoreAction = { type: 'loaded'; items: Item[]; heroes: Hero[]; abilities: Ability[]; manifest: Manifest } | { type: 'error'; error: string };
function coreReducer(state: CoreState, action: CoreAction): CoreState {
  if (action.type === 'error') return { ...state, error: action.error };
  return { items: action.items, heroes: action.heroes, abilities: action.abilities, manifest: action.manifest, error: null };
}

function useCore() {
  const [state, dispatch] = useReducer(coreReducer, { items: [], heroes: [], abilities: [], manifest: null, error: null });
  useEffect(() => {
    loadCore()
      .then(([items, heroes, abilities, manifest]) => dispatch({ type: 'loaded', items, heroes, abilities, manifest }))
      .catch((e) => {
        log.error('core_load_failed', { message: String(e) });
        dispatch({ type: 'error', error: String(e) });
      });
  }, []);
  return state;
}

// Loading is derived by comparing the fetched-for heroId to the current one, rather than
// set synchronously at the top of the effect — avoids the extra render setState-in-effect warns about.
type AnalyticsState = { status: 'ready'; heroId: number; data: HeroAnalytics } | { status: 'error'; heroId: number; message: string };
function useAnalytics(heroId: number) {
  const [resolved, setResolved] = useState<AnalyticsState | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  useEffect(() => {
    let live = true;
    loadAnalytics(heroId)
      .then((data) => {
        if (live) setResolved({ status: 'ready', heroId, data });
      })
      .catch((e) => {
        log.error('analytics_load_failed', { heroId, message: String(e) });
        if (live) setResolved({ status: 'error', heroId, message: String(e) });
      });
    return () => {
      live = false;
    };
  }, [heroId, retryToken]);
  const state: AnalyticsState | { status: 'loading' } = resolved && resolved.heroId === heroId ? resolved : { status: 'loading' };
  return { state, retry: () => setRetryToken((t) => t + 1) };
}

function useHeldout(heroId: number, manifest: Manifest | null) {
  const [heldout, setHeldout] = useState<{ set: HeldoutSet; data: HeldoutPurchases }[]>([]);
  useEffect(() => {
    const sets = manifest?.validation_sets?.filter((v) => v.hero_id === heroId) ?? [];
    if (!sets.length) return;
    let live = true;
    Promise.allSettled(sets.map((set) => loadHeldout(set).then((data) => ({ set, data })))).then((rs) => {
      if (!live) return;
      const failed = rs.filter((r) => r.status === 'rejected');
      if (failed.length) log.warn('heldout_load_failed', { heroId, count: failed.length });
      setHeldout(rs.flatMap((r) => (r.status === 'fulfilled' && r.value.data.hero_id === heroId ? [r.value] : [])));
    });
    return () => {
      live = false;
    };
  }, [heroId, manifest]);
  return heldout;
}

export default function App() {
  const { items, heroes, abilities, manifest, error } = useCore();
  const [heroId, setHeroId] = useState(INFERNUS);
  const { state: analyticsState, retry } = useAnalytics(heroId);
  const heldout = useHeldout(heroId, manifest);
  const [tab, setTab] = useState(0);

  const hero = heroes.find((h) => h.id === heroId);
  const analytics = analyticsState.status === 'ready' ? analyticsState.data : null;
  const builds: Build[] = useMemo(
    () => (hero && analytics && items.length ? generateBuilds({ hero, abilities, items, analytics }) : []),
    [hero, abilities, items, analytics],
  );
  const panel: { set: HeldoutSet; core: CoreSet }[] = useMemo(
    () => (items.length ? heldout.filter((h) => h.data.hero_id === heroId).map((h) => ({ set: h.set, core: computeCoreSet(h.data, items) })) : []),
    [heldout, items, heroId],
  );
  const validations = useMemo(() => (panel.length ? builds.map((b) => validateAgainstPanel(b, panel)) : []), [builds, panel]);
  const build = builds[Math.min(tab, builds.length - 1)];

  const selectHero = (id: number) => {
    log.info('hero_selected', { heroId: id });
    setHeroId(id);
    setTab(0);
  };

  if (error)
    return (
      <div className="error" role="alert">
        {error}
      </div>
    );
  if (!hero) return <div className="loading">Loading snapshots…</div>;

  return (
    <>
      <header className="app-header">
        <img src={img(hero.images.small)} alt="" />
        <div>
          <h1>{hero.name} build</h1>
          <div className="sub">
            Deadlock Optimal Build Finder, {manifest?.window_days}-day data fetched {manifest?.fetched_at.slice(0, 10)}
          </div>
        </div>
      </header>
      <div className="hero-strip" role="tablist" aria-label="Hero">
        {heroes.map((h) => (
          <button
            key={h.id}
            className={`hero-chip ${h.id === heroId ? 'active' : ''}`}
            onClick={() => selectHero(h.id)}
            role="tab"
            aria-selected={h.id === heroId}
          >
            <img src={img(h.images.small)} alt="" loading="lazy" />
            <span>{h.name}</span>
          </button>
        ))}
      </div>
      <select className="hero-select" value={heroId} onChange={(e) => selectHero(Number(e.target.value))} aria-label="Select hero">
        {heroes.map((h) => (
          <option key={h.id} value={h.id}>
            {h.name}
          </option>
        ))}
      </select>
      {analyticsState.status === 'loading' && <div className="loading">Generating builds…</div>}
      {analyticsState.status === 'error' && (
        <div className="error" role="alert">
          Couldn't load analytics for {hero.name}. {analyticsState.message}
          <div style={{ marginTop: 8 }}>
            <button className="btn" onClick={retry}>
              Retry
            </button>
          </div>
        </div>
      )}
      {builds.length > 1 && (
        <div className="style-tabs" role="tablist" aria-label="Build style">
          {builds.map((b, i) => (
            <button key={b.key} role="tab" aria-selected={i === tab} className={i === tab ? 'active' : ''} onClick={() => setTab(i)}>
              <span>{b.name}</span>
              <small>
                {b.population.style ? `${(b.population.style.share * 100).toFixed(0)}% of games` : ''}
                {validations[i] ? ` · ${(validations[i].agreement * 100).toFixed(0)}% panel` : ''}
              </small>
            </button>
          ))}
        </div>
      )}
      {build && (
        <BuildView
          key={`${heroId}-${build.key}`}
          build={build}
          panel={validations[tab] ?? null}
          heroName={hero.name}
          heroImage={img(hero.images.small)}
          fetchedAt={manifest?.fetched_at.slice(0, 10)}
        />
      )}
      <footer>
        Data: deadlock-api.com (aggregate analytics, assets). Builds are generated deterministically from the local snapshot; see README for the scoring
        function.
      </footer>
    </>
  );
}
