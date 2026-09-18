import { useEffect, useMemo, useReducer, useState } from 'react';
import type { Ability, Build, Hero, HeroAnalytics, Item } from './types';
import { img, loadAnalytics, loadCore, type Manifest } from './data/load';
import { generateBuilds } from './generator';
import {
  computeCoreSet,
  loadHeldout,
  validateAgainstPanel,
  type CoreSet,
  type HeldoutPurchases,
  type HeldoutSet,
  type PanelValidation,
} from './validation/heldout';
import { BuildView } from './components/BuildView';
import { HeroPicker } from './components/HeroPicker';
import { slugify } from './slug';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
import { BoardSkeleton } from './components/BoardSkeleton';
import { Toaster } from './components/ui/sonner';
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

/** `?hero=<slug>&style=<style key>` in the URL, kept in sync with back/forward navigation.
 * Both fields are derived from `location.search` at render time; a `popstate` listener is the
 * only thing that calls setState, and only in response to that external event — never
 * synchronously inside the effect body. */
function useUrlState() {
  const readParams = () => new URLSearchParams(window.location.search);
  const [heroSlug, setHeroSlug] = useState(() => readParams().get('hero') ?? '');
  const [styleSlug, setStyleSlug] = useState(() => readParams().get('style') ?? '');

  useEffect(() => {
    const onPopState = () => {
      const p = readParams();
      setHeroSlug(p.get('hero') ?? '');
      setStyleSlug(p.get('style') ?? '');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const pickHero = (slug: string) => {
    setHeroSlug(slug);
    setStyleSlug('');
    const params = readParams();
    if (slug) params.set('hero', slug);
    else params.delete('hero');
    params.delete('style');
    const qs = params.toString();
    window.history.pushState({}, '', qs ? `?${qs}` : window.location.pathname);
  };
  const pickStyle = (slug: string) => {
    setStyleSlug(slug);
    const params = readParams();
    if (slug) params.set('style', slug);
    else params.delete('style');
    const qs = params.toString();
    window.history.pushState({}, '', qs ? `?${qs}` : window.location.pathname);
  };
  return { heroSlug, styleSlug, pickHero, pickStyle };
}

export default function App() {
  const { items, heroes, abilities, manifest, error } = useCore();
  const { heroSlug, styleSlug, pickHero, pickStyle } = useUrlState();

  // unknown/absent slug falls back to Infernus; matching is by name so URLs stay readable
  const hero = heroes.find((h) => slugify(h.name) === heroSlug) ?? heroes.find((h) => h.id === INFERNUS);
  const heroId = hero?.id ?? INFERNUS;
  const { state: analyticsState, retry } = useAnalytics(heroId);
  const heldout = useHeldout(heroId, manifest);

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
  const tab = styleSlug
    ? Math.max(
        0,
        builds.findIndex((b) => b.population.style?.key === styleSlug),
      )
    : 0;
  const build = builds[Math.min(tab, builds.length - 1)];

  // Kept so a hero switch dims the previous build in place instead of collapsing to a loading
  // line while the new one generates. This is the React-documented "adjust state during render"
  // pattern (a plain conditional setState call in the render body, not inside an effect), so it
  // doesn't trip the set-state-in-effect rule and never causes an extra flicker frame.
  const [lastGood, setLastGood] = useState<{
    build: Build;
    panel: PanelValidation | null;
    heroName: string;
    heroImage?: string;
    fetchedAt?: string;
  } | null>(null);
  if (build && lastGood?.build.key !== build.key) {
    setLastGood({
      build,
      panel: validations[tab] ?? null,
      heroName: hero?.name ?? '',
      heroImage: hero ? img(hero.images.small) : undefined,
      fetchedAt: manifest?.fetched_at.slice(0, 10),
    });
  }
  const shownBuild = build ?? lastGood?.build;
  const isStale = !build && !!lastGood;

  const selectHero = (h: Hero) => {
    log.info('hero_selected', { heroId: h.id });
    pickHero(slugify(h.name));
  };
  const selectStyle = (b: Build) => pickStyle(b.population.style?.key ?? '');

  // en-GB's "short" month gives "Sept" (4 letters) for September; build the day/month/year
  // pieces separately so the month abbreviation is always exactly 3 letters, e.g. "4 Sep 2026".
  const fetchedDate = manifest?.fetched_at
    ? (() => {
        const d = new Date(manifest.fetched_at);
        const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric' }).format(d);
        const month = new Intl.DateTimeFormat('en-US', { month: 'short' }).format(d);
        const year = new Intl.DateTimeFormat('en-GB', { year: 'numeric' }).format(d);
        return `${day} ${month} ${year}`;
      })()
    : null;

  const styleTooltip = (b: Build) => {
    const style = b.population.style;
    if (!style) return undefined;
    return style.seed ? `Games where ${style.seed.name} was bought.` : `Leaves out games built around ${style.exclude.map((i) => i.name).join(', ')}.`;
  };

  if (error)
    return (
      <div className="error" role="alert">
        {error}
      </div>
    );
  if (!hero) return <BoardSkeleton />;

  return (
    <>
      <header className="app-header">
        <img src={img(hero.images.small)} alt="" width={40} height={40} />
        <div>
          <h1>{hero.name} build</h1>
          <div className="sub">
            Last {manifest?.window_days} days{fetchedDate ? ` · data from ${fetchedDate}` : ''}
          </div>
        </div>
      </header>
      <HeroPicker heroes={heroes} heroId={heroId} onPick={selectHero} />
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
      {(() => {
        const boardArea = (
          <>
            {!shownBuild && analyticsState.status === 'loading' && <BoardSkeleton />}
            {shownBuild && (
              <div className={['board-wrap', 'fade', isStale ? 'stale' : null].filter(Boolean).join(' ')} aria-busy={isStale}>
                <BuildView
                  key={shownBuild.key}
                  build={shownBuild}
                  panel={build ? (validations[tab] ?? null) : (lastGood?.panel ?? null)}
                  heroName={build ? hero.name : (lastGood?.heroName ?? hero.name)}
                  heroImage={build ? img(hero.images.small) : lastGood?.heroImage}
                  fetchedAt={build ? manifest?.fetched_at.slice(0, 10) : lastGood?.fetchedAt}
                />
              </div>
            )}
          </>
        );
        if (builds.length <= 1) return boardArea;
        return (
          <Tabs
            value={build?.key}
            onValueChange={(key) => {
              const picked = builds.find((b) => b.key === key);
              if (picked) selectStyle(picked);
            }}
            className="style-tabs-wrap"
          >
            <TabsList className="style-tabs" aria-label="Build style">
              {builds.map((b, i) => (
                <TabsTrigger key={b.key} value={b.key} className="style-tab" title={styleTooltip(b)}>
                  <span>{b.name}</span>
                  <small>
                    {b.population.style ? `${(b.population.style.share * 100).toFixed(0)}% of games` : ''}
                    {validations[i] ? ` · ${(validations[i].agreement * 100).toFixed(0)}% match` : ''}
                  </small>
                </TabsTrigger>
              ))}
            </TabsList>
            {/* forceMount: the board is the real content of the active tab, not remounted on
                switch, so the dimmed "old build while loading" state (item 6) keeps working and
                Radix's aria-controls on each trigger points at an element that actually exists
                (fixes an axe aria-valid-attr-value violation from an unassociated TabsList). */}
            <TabsContent value={build?.key ?? ''} forceMount>
              {boardArea}
            </TabsContent>
          </Tabs>
        );
      })()}
      <footer>
        Data from <a href="https://deadlock-api.com">deadlock-api.com</a>. See the{' '}
        <a href="https://github.com/Gidntsquia/deadlock-optimal-build-finder#readme">README</a> for how builds are put together.
      </footer>
      <Toaster />
    </>
  );
}
