import { useMemo, useRef, useState } from 'react';
import type { Hero } from '../types';
import { img } from '../data/load';

function Grid({
  heroes,
  activeId,
  filter,
  onFilter,
  onPick,
  gridRef,
  listboxId,
}: {
  heroes: Hero[];
  activeId: number;
  filter: string;
  onFilter: (v: string) => void;
  onPick: (h: Hero) => void;
  gridRef: React.RefObject<HTMLDivElement | null>;
  listboxId: string;
}) {
  const matches = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? heroes.filter((h) => h.name.toLowerCase().includes(q)) : heroes;
  }, [heroes, filter]);
  // focusIdx resets whenever the filter text changes; tagging it with the filter it was
  // computed for and deriving during render avoids a synchronous setState in an effect.
  const [focusState, setFocusState] = useState({ filter, idx: 0 });
  const focusIdx = focusState.filter === filter ? focusState.idx : 0;
  const setFocusIdx = (updater: (i: number) => number) => setFocusState({ filter, idx: updater(focusState.filter === filter ? focusState.idx : 0) });

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const pick = matches[focusIdx] ?? matches[0];
      if (pick) onPick(pick);
      return;
    }
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusIdx((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusIdx((i) => Math.max(i - 1, 0));
    }
  };

  return (
    <div className="hero-picker-body">
      <input
        className="hero-filter"
        placeholder="Search heroes…"
        value={filter}
        onChange={(e) => onFilter(e.target.value)}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded="true"
        aria-controls={listboxId}
        aria-activedescendant={matches[focusIdx] ? `hero-opt-${matches[focusIdx].id}` : undefined}
        autoFocus
      />
      <div className="hero-grid" role="listbox" aria-label="Heroes" id={listboxId} ref={gridRef}>
        {matches.map((h, i) => (
          <button
            key={h.id}
            id={`hero-opt-${h.id}`}
            role="option"
            aria-selected={h.id === activeId}
            className={`hero-opt ${h.id === activeId ? 'active' : ''} ${i === focusIdx ? 'focus' : ''}`}
            onClick={() => onPick(h)}
          >
            <img src={img(h.images.small)} alt="" loading="lazy" width={36} height={36} />
            <span>{h.name}</span>
          </button>
        ))}
        {matches.length === 0 && <div className="hero-empty muted">No heroes match "{filter}"</div>}
      </div>
    </div>
  );
}

/** Replaces the old chip-strip + <select> pair: one control per viewport, same filter+grid underneath. */
export function HeroPicker({ heroes, heroId, onPick }: { heroes: Hero[]; heroId: number; onPick: (h: Hero) => void }) {
  const active = heroes.find((h) => h.id === heroId);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const gridRef = useRef<HTMLDivElement>(null);

  const pick = (h: Hero) => {
    onPick(h);
    setOpen(false);
    setFilter('');
  };

  return (
    <>
      {/* phone: header button opens a full-height sheet */}
      <button className="hero-picker-trigger" onClick={() => setOpen(true)} aria-haspopup="dialog">
        {active && <img src={img(active.images.small)} alt="" width={28} height={28} />}
        <span>{active?.name ?? 'Choose hero'}</span>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div
          className="hero-sheet-backdrop"
          onClick={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
          }}
        >
          <div className="hero-sheet" role="dialog" aria-modal="true" aria-label="Choose hero" onClick={(e) => e.stopPropagation()}>
            <div className="hero-sheet-head">
              <h2>Choose hero</h2>
              <button className="sheet-close" onClick={() => setOpen(false)} aria-label="Close">
                ×
              </button>
            </div>
            <Grid heroes={heroes} activeId={heroId} filter={filter} onFilter={setFilter} onPick={pick} gridRef={gridRef} listboxId="hero-listbox-phone" />
          </div>
        </div>
      )}
      {/* desktop: inline compact grid, always visible */}
      <div className="hero-picker-desktop">
        <Grid heroes={heroes} activeId={heroId} filter={filter} onFilter={setFilter} onPick={pick} gridRef={gridRef} listboxId="hero-listbox-desktop" />
      </div>
    </>
  );
}
