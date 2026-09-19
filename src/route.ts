/** Two in-app pages under the Vite base path: the build finder (`<base>`) and the tier list (`<base>tier-list/`). */
export type Page = 'build' | 'tiers';

const BASE = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
export const TIER_PATH = `${BASE}tier-list/`;
export const BUILD_PATH = BASE;

export function pageFromPath(pathname: string): Page {
  const rest = pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname.replace(/^\//, '');
  return rest.replace(/\/+$/, '') === 'tier-list' ? 'tiers' : 'build';
}

// The build page keeps its hero and style in ?hero=&style=; remember them so the nav's "Build Finder"
// entry returns to the build you left instead of the default one.
let lastBuildSearch = typeof window === 'undefined' ? '' : pageFromPath(window.location.pathname) === 'build' ? window.location.search : '';
export const rememberBuildSearch = (search: string) => {
  lastBuildSearch = search;
};
export const hrefFor = (page: Page) => (page === 'tiers' ? TIER_PATH : BUILD_PATH + lastBuildSearch);
