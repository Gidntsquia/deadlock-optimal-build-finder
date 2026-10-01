import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { img, loadItemTierData, loadTierData } from '../data/load';
import { buildItemTierRows, buildTierRows, MIN_ITEM_MATCHES, TIERS, type HeroStats, type ItemStats, type ItemTierRow } from '../tiers';
import { slugify } from '../slug';
import { hrefFor } from '../route';
import type { Hero, Item } from '../types';
import { log } from '../log';
import { CREDIT_URL, GithubMark } from '../components/NavBar';
import { CORRUPT_FRAME } from '../export/png';
import { ItemCard } from '../components/ItemCard';
import { fmtSouls } from '../text';

function fmtDate(iso: string) {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric' }).format(d);
  const month = new Intl.DateTimeFormat('en-US', { month: 'short' }).format(d);
  return `${day} ${month} ${new Intl.DateTimeFormat('en-GB', { year: 'numeric' }).format(d)}`;
}

type List = 'heroes' | 'items' | 'corrupted';
const LISTS: { key: List; label: string }[] = [
  { key: 'heroes', label: 'Heroes' },
  { key: 'items', label: 'Items' },
  { key: 'corrupted', label: 'Corrupted Items' },
];
const listFromUrl = (): List => {
  const l = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('list');
  return l === 'items' || l === 'corrupted' ? l : 'heroes';
};
const BANDS = 'S+ is 4 points or more above that average, S 2–4 above, A 0–2 above, B 0–2 below, C 2–4 below, D more than 4 below.';

const pct = (n: number) => `${n.toFixed(1)}%`;

/**
 * Largest icon size (px) at which every row's icons, wrapped, fit the list's height. Desktop only: the list fills
 * the screen and never scrolls. Reads the gaps and paddings from the rendered rows so CSS stays the one source.
 */
function fitIconSize(list: HTMLElement, counts: number[]) {
  const row = list.querySelector<HTMLElement>('.tier-row');
  const ul = row?.querySelector<HTMLElement>('.tier-items');
  if (!row || !ul) return null;
  const rs = getComputedStyle(row);
  const us = getComputedStyle(ul);
  const px = (v: string) => parseFloat(v) || 0;
  const gap = px(us.columnGap);
  const rowGap = px(getComputedStyle(list).rowGap);
  const width = ul.clientWidth - px(us.paddingLeft) - px(us.paddingRight);
  const chrome = px(us.paddingTop) + px(us.paddingBottom) + px(rs.borderTopWidth) + px(rs.borderBottomWidth);
  const height = list.clientHeight - rowGap * (counts.length - 1);
  for (let size = 120; size > 32; size--) {
    const per = Math.max(1, Math.floor((width + gap) / (size + gap)));
    const used = counts.reduce((h, c) => h + Math.ceil(c / per) * (size + gap) - gap + chrome, 0);
    if (used <= height) return size;
  }
  return 32;
}

function ItemRows({ rows, corrupted }: { rows: ItemTierRow[]; corrupted: boolean }) {
  const shown = rows.filter((r) => r.items.length);
  const flat = shown.flatMap((r) => r.items.map((e) => ({ ...e, tier: r.tier })));
  const [open, setOpen] = useState<number | null>(null);
  const [last, setLast] = useState(0);
  const buttons = useRef(new Map<number, HTMLButtonElement>());
  const listRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<number | null>(null);
  const counts = shown.map((r) => r.items.length).join();
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const wide = window.matchMedia('(min-width: 900px)');
    const fit = () => setSize(wide.matches ? fitIconSize(list, counts.split(',').map(Number)) : null);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(list);
    wide.addEventListener('change', fit);
    return () => {
      ro.disconnect();
      wide.removeEventListener('change', fit);
    };
  }, [counts]);
  const show = (i: number) => {
    setOpen(i);
    setLast(i);
  };
  const cur = flat[open ?? last];
  const avg = cur ? cur.rate - cur.edge : 0;
  return (
    <>
      <div className="tier-rows items" ref={listRef} style={size ? ({ '--icon': `${size}px` } as CSSProperties) : undefined}>
        {shown.map((r) => (
          <section key={r.tier.key} className="tier-row" data-tier={r.tier.key} aria-label={`${r.tier.key} tier, ${r.tier.name}`}>
            <h2 className="tier-tag">
              <b>{r.tier.key}</b>
              <span>{r.tier.name}</span>
            </h2>
            <ul className="tier-items">
              {r.items.map(({ item }) => (
                <li key={item.id}>
                  <button
                    type="button"
                    ref={(el) => {
                      if (el) buttons.current.set(item.id, el);
                      else buttons.current.delete(item.id);
                    }}
                    className={['tier-item', item.item_slot_type, corrupted ? 'corrupted' : null].filter(Boolean).join(' ')}
                    title={item.name}
                    aria-haspopup="dialog"
                    onClick={() => show(flat.findIndex((e) => e.item.id === item.id))}
                  >
                    <img src={img(item.shop_image_webp || item.image_webp)} alt={item.name} width={48} height={48} />
                    {corrupted && <img className="corrupt-frame" src={img(CORRUPT_FRAME)} alt="" width={48} height={48} />}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {cur && (
        <ItemCard
          open={open !== null}
          items={flat}
          index={open ?? last}
          corrupted={corrupted}
          onClose={() => setOpen(null)}
          onNavigate={show}
          returnFocus={(id) => buttons.current.get(id)?.focus()}
          extra={
            <div className="tt-section tier-stats" data-tier={cur.tier.key}>
              <h3>Tier list</h3>
              <div className="tier-stats-head">
                <b className="tier-badge">{cur.tier.key}</b>
                <p>
                  {cur.tier.name}: wins {cur.edge >= 0 ? 'more' : 'less'} often than the average {corrupted ? 'corrupted ' : ''}item at{' '}
                  {fmtSouls(cur.item.cost)} souls.
                </p>
              </div>
              <div className="stat-line">
                <span>Win rate</span>
                <b>{pct(cur.rate)}</b>
              </div>
              <div className="stat-line">
                <span>
                  Average for {corrupted ? 'corrupted ' : ''}items at {fmtSouls(cur.item.cost)} souls
                </span>
                <b>{pct(avg)}</b>
              </div>
              <div className="stat-line">
                <span>Difference</span>
                <b>
                  {cur.edge >= 0 ? '+' : ''}
                  {cur.edge.toFixed(1)} points
                </b>
              </div>
              <div className="stat-line">
                <span>Games</span>
                <b>{fmtSouls(cur.matches)}</b>
              </div>
              <p className="tier-stats-rank">
                Number {(open ?? last) + 1} of {flat.length} on this list.
              </p>
            </div>
          }
        />
      )}
    </>
  );
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
  const [list, setList] = useState<List>(listFromUrl);
  // item data loads in the background so the hero list never waits on the 900 KB item catalog
  const [itemData, setItemData] = useState<{ items: Item[]; stats: ItemStats } | { error: string } | null>(null);
  useEffect(() => {
    loadItemTierData()
      .then(([items, stats]) => setItemData({ items, stats }))
      .catch((e) => {
        log.error('item_tier_load_failed', { message: String(e) });
        setItemData({ error: String(e) });
      });
  }, []);
  const itemRows = useMemo(
    () =>
      itemData && 'stats' in itemData
        ? { items: buildItemTierRows(itemData.items, itemData.stats.items), corrupted: buildItemTierRows(itemData.items, itemData.stats.corrupted) }
        : null,
    [itemData],
  );
  const pick = (l: List) => {
    setList(l);
    const url = new URL(window.location.href);
    if (l === 'heroes') url.searchParams.delete('list');
    else url.searchParams.set('list', l);
    window.history.replaceState(window.history.state, '', url);
  };
  const days = data && 'stats' in data ? data.stats.window_days : 30;
  const corruptedSince =
    itemData && 'stats' in itemData ? fmtDate(new Date((itemData.stats.corrupted_since_unix_timestamp + 12 * 3600) * 1000).toISOString()) : null;

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
        <div className="tier-switch" role="group" aria-label="Which tier list">
          {LISTS.map((l) => (
            <button key={l.key} type="button" aria-pressed={list === l.key} onClick={() => pick(l.key)}>
              {l.label}
            </button>
          ))}
        </div>
        <p>
          {list === 'heroes' && <>Heroes ranked by win rate in Phantom and above games over the last {days} days.</>}
          {list === 'items' && (
            <>Items on every hero, ranked by win rate against items of the same price, in Phantom and above games over the last {days} days.</>
          )}
          {list === 'corrupted' && (
            <>
              Corrupted items on every hero, ranked by win rate against corrupted items of the same price, in games of 30 minutes or more since{' '}
              {corruptedSince ?? 'they came out'}.
            </>
          )}
          {data && 'stats' in data && <> Data from {fmtDate(data.stats.fetched_at)}.</>}
        </p>
      </div>
      {list !== 'heroes' && itemData && 'error' in itemData && (
        <div className="error" role="alert">
          {itemData.error}
        </div>
      )}
      {list !== 'heroes' && !itemData && (
        <div className="tier-rows" aria-hidden="true">
          {TIERS.map((t) => (
            <div key={t.key} className="tier-skel" />
          ))}
        </div>
      )}
      {list !== 'heroes' && itemRows && <ItemRows rows={itemRows[list]} corrupted={list === 'corrupted'} />}
      {list === 'heroes' && !data && (
        <div className="tier-rows" aria-hidden="true">
          {TIERS.map((t) => (
            <div key={t.key} className="tier-skel" />
          ))}
        </div>
      )}
      {list === 'heroes' && data && (
        <div className="tier-rows" style={{ '--n': Math.max(1, ...rows.map((r) => r.heroes.length)) } as CSSProperties}>
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
                        <img src={img(hero.images.small ?? hero.images.card)} alt="" width={72} height={72} />
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
        <div className="tier-foot">
          <details className="tier-rule">
            <summary>How tiers are set</summary>
            {list === 'heroes' && (
              <p>
                Win rate is wins divided by games, counting only Phantom and above games. S+ is 54% or more, S 52–54%, A 50–52%, B 48–50%, C 46–48%, D under
                46%. Best win rate comes first inside a tier.
              </p>
            )}
            {list !== 'heroes' && (
              <p>
                Pricier items are bought later, in games that are often already won, so each item is compared with the average win rate of
                {list === 'corrupted' ? ' corrupted items' : ' items'} at its price. {BANDS} Items with fewer than {MIN_ITEM_MATCHES} games are left out.
                {list === 'corrupted' ? ' Corrupted items count every rank, because they are new.' : ' Only Phantom and above games count.'} Best first inside a
                tier.
              </p>
            )}
          </details>
          <span className="tier-credit">
            <GithubMark />
            Made by <a href={CREDIT_URL}>GidntSquia</a>
          </span>
        </div>
      )}
    </main>
  );
}
