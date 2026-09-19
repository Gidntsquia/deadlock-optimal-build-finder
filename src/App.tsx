import { useEffect, useMemo, useReducer, useState } from 'react';
import type { Ability, Build, Hero, HeroAnalytics, Item } from './types';
import { heroBackdrop, img, loadAnalytics, loadCore, preloadImage, type Manifest } from './data/load';
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
import { BuildView, HeroArrow, SwapCue } from './components/BuildView';
import { HeroPicker } from './components/HeroPicker';
import { slugify } from './slug';
import { pageFromPath } from './route';
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

// Builds are a pure function of (hero, abilities, items, analytics); keyed by the analytics object so
// a build made during prefetch is the same one the screen shows after the click.
const buildsCache = new WeakMap<HeroAnalytics, Build[]>();
function buildsFor(hero: Hero, abilities: Ability[], items: Item[], analytics: HeroAnalytics): Build[] {
  let b = buildsCache.get(analytics);
  if (!b) {
    b = generateBuilds({ hero, abilities, items, analytics });
    buildsCache.set(analytics, b);
  }
  return b;
}

function preloadBuildImages(builds: Build[]) {
  for (const b of builds) {
    for (const it of b.items) preloadImage(it.item.shop_image_webp || it.item.image_webp);
    for (const s of b.abilityOrder) preloadImage(s.ability.image_webp);
  }
}

/** Everything one click away is fetched, generated and decoded ahead of time: the current hero's
 * other styles, and each neighbour's data, standard build and portrait. Runs when idle. */
function usePrefetch(hero: Hero | undefined, heroes: Hero[], items: Item[], abilities: Ability[], manifest: Manifest | null, analytics: HeroAnalytics | null) {
  useEffect(() => {
    if (!hero || !items.length) return;
    let live = true;
    const idle = (fn: () => void) => {
      const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
      if (w.requestIdleCallback) w.requestIdleCallback(fn, { timeout: 1500 });
      else window.setTimeout(fn, 50);
    };
    if (analytics) idle(() => live && preloadBuildImages(buildsFor(hero, abilities, items, analytics)));
    const i = heroes.findIndex((h) => h.id === hero.id);
    for (const d of [1, -1]) {
      const n = heroes[(i + d + heroes.length) % heroes.length];
      if (!n || n.id === hero.id) continue;
      preloadImage(n.images.card ?? n.images.small);
      preloadImage(n.images.small);
      for (const set of manifest?.validation_sets?.filter((v) => v.hero_id === n.id) ?? []) loadHeldout(set).catch(() => {});
      loadAnalytics(n.id)
        .then((a) => {
          if (live) idle(() => live && preloadBuildImages(buildsFor(n, abilities, items, a).slice(0, 1)));
        })
        .catch(() => {});
    }
    return () => {
      live = false;
    };
  }, [hero, heroes, items, abilities, manifest, analytics]);
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
function useUrlState(active: boolean) {
  const readParams = () => new URLSearchParams(window.location.search);
  const [heroSlug, setHeroSlug] = useState(() => readParams().get('hero') ?? '');
  const [styleSlug, setStyleSlug] = useState(() => readParams().get('style') ?? '');

  useEffect(() => {
    const onPopState = () => {
      // App stays mounted behind the tier list; ignore history moves that land on another page
      if (pageFromPath(window.location.pathname) !== 'build') return;
      const p = readParams();
      setHeroSlug(p.get('hero') ?? '');
      setStyleSlug(p.get('style') ?? '');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // coming back from the tier list (e.g. after picking a hero there): follow the URL
  useEffect(() => {
    if (!active) return;
    const p = readParams();
    setHeroSlug(p.get('hero') ?? '');
    setStyleSlug(p.get('style') ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

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

export default function App({ active = true }: { active?: boolean }) {
  const { items, heroes, abilities, manifest, error } = useCore();
  const { heroSlug, styleSlug, pickHero, pickStyle } = useUrlState(active);

  // unknown/absent slug falls back to Infernus; matching is by name so URLs stay readable
  const hero = heroes.find((h) => slugify(h.name) === heroSlug) ?? heroes.find((h) => h.id === INFERNUS);
  const heroId = hero?.id ?? INFERNUS;
  const { state: analyticsState, retry } = useAnalytics(heroId);
  const heldout = useHeldout(heroId, manifest);

  const analytics = analyticsState.status === 'ready' ? analyticsState.data : null;
  const builds: Build[] = useMemo(
    () => (hero && analytics && items.length ? buildsFor(hero, abilities, items, analytics) : []),
    [hero, abilities, items, analytics],
  );
  usePrefetch(hero, heroes, items, abilities, manifest, analytics);
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
    hero: Hero;
  } | null>(null);
  if (build && hero && (lastGood?.build !== build || lastGood.panel !== (validations[tab] ?? null))) {
    setLastGood({ build, panel: validations[tab] ?? null, hero });
  }
  const shownBuild = build ?? lastGood?.build;
  const isStale = !build && !!lastGood;

  const selectHero = (h: Hero) => {
    log.info('hero_selected', { heroId: h.id });
    setSlide((s) => ({ dir: 0, n: s.n }));
    pickHero(slugify(h.name));
  };
  const [slide, setSlide] = useState<{ dir: -1 | 0 | 1; n: number }>({ dir: 0, n: 0 });
  // the portrait that just left, drawn on top while it slides out
  const [leaving, setLeaving] = useState<{ hero: Hero; dir: -1 | 1; n: number } | null>(null);
  const pickFromList = (h: Hero) => {
    setLeaving(null);
    selectHero(h);
  };
  const stepHero = (d: -1 | 1) => {
    const i = heroes.findIndex((h) => h.id === heroId);
    const next = heroes[(i + d + heroes.length) % heroes.length];
    if (next) {
      if (hero) setLeaving((l) => ({ hero, dir: d, n: (l?.n ?? 0) + 1 }));
      selectHero(next);
      setSlide((s) => ({ dir: d, n: s.n + 1 }));
    }
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

  const [heroesOpen, setHeroesOpen] = useState(false);

  if (error)
    return (
      <div className="error" role="alert">
        {error}
      </div>
    );
  if (!hero)
    return (
      <main className="screen">
        <aside className="hero-side" />
        <div className="frame">
          <div className="frame-head" />
          <BoardSkeleton />
        </div>
      </main>
    );

  // while the next hero loads, the frame keeps showing the last build (dimmed) under its own hero
  const shownHero = build || !lastGood ? hero : lastGood.hero;
  return (
    <>
      <main className="screen">
        <aside className="hero-side">
          <div className="hero-card">
            <button className="hero-face hero-btn" onClick={() => setHeroesOpen(true)} aria-label={`${hero.name}, change hero`}>
              <img
                key={hero.id}
                className="hero-slide"
                data-slide={slide.dir || undefined}
                src={img(hero.images.card ?? hero.images.small)}
                alt=""
                width={280}
                height={380}
                style={heroBackdrop(hero.id)}
              />
              {leaving && (
                <img
                  key={leaving.n}
                  className="hero-leave"
                  data-slide={leaving.dir}
                  src={img(leaving.hero.images.card ?? leaving.hero.images.small)}
                  alt=""
                  aria-hidden="true"
                  width={280}
                  height={380}
                  style={heroBackdrop(leaving.hero.id)}
                  onAnimationEnd={() => setLeaving(null)}
                />
              )}
              <span className="hero-name">{hero.name}</span>
              <SwapCue />
            </button>
            <HeroArrow dir={-1} onStep={stepHero} />
            <HeroArrow dir={1} onStep={stepHero} />
          </div>
        </aside>
        <div className="frame">
          {analyticsState.status === 'error' && (
            <div className="error" role="alert">
              {hero.name} failed to load. {analyticsState.message}
              <div>
                <button className="pill" onClick={retry}>
                  Retry
                </button>{' '}
                <button className="pill hero-retry-pick" onClick={() => setHeroesOpen(true)}>
                  Select Hero
                </button>
              </div>
            </div>
          )}
          {analyticsState.status !== 'error' && !shownBuild && (
            <>
              <div className="frame-head" />
              <BoardSkeleton />
            </>
          )}
          {analyticsState.status !== 'error' && shownBuild && (
            <BuildView
              key={shownBuild.key + shownHero.name}
              build={shownBuild}
              builds={build ? builds : [shownBuild]}
              onPickStyle={selectStyle}
              onOpenHeroes={() => setHeroesOpen(true)}
              onStepHero={stepHero}
              panel={build ? (validations[tab] ?? null) : (lastGood?.panel ?? null)}
              hero={shownHero}
              windowDays={manifest?.window_days}
              fetchedDate={fetchedDate}
              stale={isStale}
            />
          )}
        </div>
      </main>
      <HeroPicker open={heroesOpen} onOpenChange={setHeroesOpen} heroes={heroes} heroId={heroId} onPick={pickFromList} />
      <Toaster />
    </>
  );
}
