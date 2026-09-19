import { ArrowUpRight, Hammer, ListOrdered, Swords } from 'lucide-react';
import { hrefFor, type Page } from '../route';

export const BRAWL_URL = 'https://gidntsquia.github.io/deadlock-street-brawl-helper/';
export const CREDIT_URL = 'https://github.com/GidntSquia';
export function GithubMark() {
  return (
    <svg className="credit-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.05-.49.05-.49.8.06 1.23.83 1.23.83.71 1.22 1.87.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.65-.89-3.65-3.95 0-.87.31-1.59.83-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.66 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}
const LOGO = `${(import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'}favicon.svg`;

/** Top bar on every page: logo + name, then Build Finder / Tier List (in-app) and Street Brawl (its own site). */
export function NavBar({ page, onNavigate }: { page: Page; onNavigate: (p: Page) => void }) {
  const inApp = (p: Page, label: string, icon: React.ReactNode) => (
    <a
      className="nav-link"
      href={hrefFor(p)}
      aria-current={page === p ? 'page' : undefined}
      onClick={(e) => {
        // let ctrl/cmd/middle clicks open a new tab as usual
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        onNavigate(p);
      }}
    >
      {icon}
      <span>{label}</span>
    </a>
  );
  return (
    <header className="nav">
      <a
        className="nav-brand"
        href={hrefFor('build')}
        aria-label="Deadlock Builds, build finder"
        onClick={(e) => {
          if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          onNavigate('build');
        }}
      >
        <img src={LOGO} alt="" width={24} height={24} />
        <span className="nav-name">Deadlock Builds</span>
      </a>
      <nav className="nav-links" aria-label="Main">
        {inApp('build', 'Build Finder', <Hammer aria-hidden="true" />)}
        {inApp('tiers', 'Tier List', <ListOrdered aria-hidden="true" />)}
        <a className="nav-link" href={BRAWL_URL}>
          <Swords aria-hidden="true" />
          <span>Street Brawl</span>
          <ArrowUpRight className="nav-out" aria-hidden="true" />
        </a>
      </nav>
      <a className="nav-credit" href={CREDIT_URL}>
        <GithubMark />
        by GidntSquia
      </a>
    </header>
  );
}
