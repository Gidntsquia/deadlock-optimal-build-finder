import { useMemo, useState } from 'react';
import type { Hero } from '../types';
import { img } from '../data/load';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';

function Grid({ heroes, activeId, onPick }: { heroes: Hero[]; activeId: number; onPick: (h: Hero) => void }) {
  const [filter, setFilter] = useState('');
  const matches = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? heroes.filter((h) => h.name.toLowerCase().includes(q)) : heroes;
  }, [heroes, filter]);
  // focusIdx resets whenever the filter text changes; tagging it with the filter it was
  // computed for and deriving during render avoids a synchronous setState in an effect.
  const [focusState, setFocusState] = useState({ filter, idx: 0 });
  const focusIdx = focusState.filter === filter ? focusState.idx : 0;
  const move = (d: number) => setFocusState({ filter, idx: Math.max(0, Math.min(focusIdx + d, matches.length - 1)) });

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const pick = matches[focusIdx] ?? matches[0];
      if (pick) onPick(pick);
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
    }
  };

  return (
    <>
      <input
        className="hero-filter"
        placeholder="Search"
        aria-label="Search heroes"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded="true"
        aria-controls="hero-listbox"
        aria-activedescendant={matches[focusIdx] ? `hero-opt-${matches[focusIdx].id}` : undefined}
        autoFocus
      />
      <div className="hero-grid" role="listbox" aria-label="Heroes" id="hero-listbox">
        {matches.map((h, i) => (
          <button
            key={h.id}
            id={`hero-opt-${h.id}`}
            role="option"
            aria-selected={h.id === activeId}
            className={['hero-opt', h.id === activeId ? 'active' : null, i === focusIdx ? 'focus' : null].filter(Boolean).join(' ')}
            onClick={() => onPick(h)}
          >
            <img src={img(h.images.small)} alt="" loading="lazy" width={48} height={48} />
            <span>{h.name}</span>
          </button>
        ))}
        {matches.length === 0 && <div className="hero-empty">No heroes found</div>}
      </div>
    </>
  );
}

export function HeroPicker({
  open,
  onOpenChange,
  heroes,
  heroId,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  heroes: Hero[];
  heroId: number;
  onPick: (h: Hero) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sheet sheet-content hero-dialog max-[899px]:translate-none" aria-describedby={undefined}>
        <DialogTitle asChild>
          <h2 className="sheet-title">Select Hero</h2>
        </DialogTitle>
        <Grid
          heroes={heroes}
          activeId={heroId}
          onPick={(h) => {
            onPick(h);
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
