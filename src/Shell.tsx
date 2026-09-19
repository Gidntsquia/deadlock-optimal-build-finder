import { useEffect, useState } from 'react';
import App from './App';
import { NavBar } from './components/NavBar';
import { TierList } from './pages/TierList';
import { BUILD_PATH, hrefFor, pageFromPath, rememberBuildSearch, TIER_PATH, type Page } from './route';

/** Owns which page is showing. Page = URL path under the Vite base; nav clicks push history, Back/Forward pop it. */
export default function Shell() {
  const [page, setPage] = useState<Page>(() => pageFromPath(window.location.pathname));
  useEffect(() => {
    const onPop = () => setPage(pageFromPath(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  useEffect(() => {
    document.title = page === 'tiers' ? 'Tier List – Deadlock Builds' : 'Deadlock Optimal Build Finder';
  }, [page]);

  const go = (p: Page) => {
    if (p === page) return;
    // leaving the build page: keep its ?hero=&style= so the nav can bring the same build back
    if (page === 'build') rememberBuildSearch(window.location.search);
    window.history.pushState({}, '', p === 'tiers' ? TIER_PATH : hrefFor('build'));
    setPage(p);
    window.scrollTo(0, 0);
  };
  const openHero = (slug: string) => {
    window.history.pushState({}, '', `${BUILD_PATH}?hero=${slug}`);
    setPage('build');
    window.scrollTo(0, 0);
  };
  return (
    <>
      <NavBar page={page} onNavigate={go} />
      {page === 'tiers' ? <TierList onPickHero={openHero} /> : <App />}
    </>
  );
}
