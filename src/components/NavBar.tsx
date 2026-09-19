import { ArrowUpRight, Hammer, ListOrdered, Swords } from 'lucide-react';
import { hrefFor, type Page } from '../route';

export const BRAWL_URL = 'https://gidntsquia.github.io/deadlock-street-brawl-helper/';
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
        <img src={LOGO} alt="" width={32} height={32} />
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
    </header>
  );
}
