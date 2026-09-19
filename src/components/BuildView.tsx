import { heroBackdrop, img } from '../data/load';
import { useRef, useState } from 'react';
import type { Build, Hero, Phase } from '../types';
import type { PanelValidation } from '../validation/heldout';
import { ItemCard } from './ItemCard';
import { ItemTile } from './ItemTile';
import { Details } from './Details';
import { renderBuildPng } from '../export/png';
import { log } from '../log';
import { toast } from 'sonner';

const PHASES: { key: Phase; label: string }[] = [
  { key: 'early', label: 'Early Game' },
  { key: 'mid', label: 'Mid Game' },
  { key: 'late', label: 'Late Game' },
];
const TIER_COST = { tier1: '1', tier2: '2', tier3: '5' } as const;
const STEP_LABEL = { unlock: 'unlock', tier1: 'upgrade 1', tier2: 'upgrade 2', tier3: 'upgrade 3' } as const;

// in-game point glyph: a rounded diamond with a lightning bolt cut out of it (purple for unlock, grey for upgrades)
const PointGlyph = ({ unlock }: { unlock: boolean }) => (
  <svg className={['ap-glyph', unlock ? 'unlock-glyph' : null].filter(Boolean).join(' ')} viewBox="0 0 12 12" aria-hidden="true">
    <path strokeWidth="1.5" strokeLinejoin="round" d="M6 1 11 6 6 11 1 6Z" />
    <path className="ap-bolt" d="M7 2.4 3.6 6.7H5.6L5 9.6 8.4 5.3H6.4Z" />
  </svg>
);
export const SwapCue = () => (
  <span className="hero-cue">
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 5h10L9.5 2.5M14 11H4l2.5 2.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
    <span className="hero-cue-text">Change Hero</span>
  </span>
);

export const HeroArrow = ({ dir, onStep }: { dir: -1 | 1; onStep: (d: -1 | 1) => void }) => (
  <button className={['hero-arrow', dir < 0 ? 'prev' : 'next'].join(' ')} onClick={() => onStep(dir)} aria-label={dir < 0 ? 'Previous hero' : 'Next hero'}>
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d={dir < 0 ? 'M10.5 2.5 5 8l5.5 5.5' : 'M5.5 2.5 11 8l-5.5 5.5'}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  </button>
);

export function BuildView({
  build,
  builds,
  onPickStyle,
  onOpenHeroes,
  onStepHero,
  panel,
  hero,
  windowDays,
  fetchedDate,
  stale,
}: {
  build: Build;
  builds: Build[];
  onPickStyle: (b: Build) => void;
  onOpenHeroes: () => void;
  onStepHero: (d: -1 | 1) => void;
  panel: PanelValidation | null;
  hero: Pick<Hero, 'id' | 'name' | 'images'>;
  windowDays?: number;
  fetchedDate: string | null;
  stale: boolean;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const tileRefs = useRef<Record<number, HTMLButtonElement | HTMLDivElement | null>>({});
  // The dialog stays mounted so its close transition has content; lastOpenIndex keeps that content valid while it closes.
  const [lastOpenIndex, setLastOpenIndex] = useState(0);
  const selectIndex = (i: number) => {
    setOpenIndex(i);
    setLastOpenIndex(i);
  };
  const title = `${hero.name} - ${build.name}`;
  const abilities = [...new Map(build.abilityOrder.map((s) => [s.ability.id, s.ability])).values()];
  const sharePng = async () => {
    setBusy(true);
    const toastId = toast.loading('Saving image');
    try {
      const blob = await renderBuildPng(build, { heroName: hero.name, heroImage: img(hero.images.small), img });
      const name = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      const file = new File([blob], `${name}.png`, { type: 'image/png' });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.share && nav.canShare?.({ files: [file] })) {
        try {
          await nav.share({ files: [file], title });
          toast.success('Shared', { id: toastId });
          return;
        } catch {
          /* cancelled: fall through to download */
        }
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast.success('Image saved', { id: toastId });
    } catch (e) {
      log.error('png_export_failed', { message: String(e) });
      toast.error(`Image export failed: ${e}`, { id: toastId });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="frame-head">
        <div className="hero-mini">
          <HeroArrow dir={-1} onStep={onStepHero} />
          <button className="hero-avatar hero-btn" onClick={onOpenHeroes} aria-label={`${hero.name}, change hero`}>
            <img src={img(hero.images.small)} alt="" width={44} height={44} style={heroBackdrop(hero.id)} />
            <SwapCue />
          </button>
          <HeroArrow dir={1} onStep={onStepHero} />
        </div>
        <h1>{title}</h1>
        {builds.length > 1 && (
          <div className="pills style-switch" role="group" aria-label="Build">
            {builds.map((b) => (
              <button key={b.key} className="pill style-pill" aria-pressed={b.key === build.key} onClick={() => onPickStyle(b)}>
                {b.name.replace(/ build$/, '')}
              </button>
            ))}
          </div>
        )}
        <div className="actions">
          <button className="pill share-btn" onClick={sharePng} disabled={busy}>
            Share
          </button>
          <Details build={build} panel={panel} heroName={hero.name} windowDays={windowDays} fetchedDate={fetchedDate} />
        </div>
      </div>
      <div className={['board-wrap', stale ? 'stale' : null].filter(Boolean).join(' ')} aria-busy={stale}>
        <div className="board">
          {PHASES.map((p) => {
            const rows = build.items.filter((b) => b.phase === p.key);
            if (!rows.length) return null;
            return (
              <section className="row" key={p.key} aria-label={p.label}>
                <h2 className="row-head">{p.label}</h2>
                <div className="tiles">
                  {rows.map((b) => (
                    <ItemTile
                      key={b.item.id}
                      ref={(el) => {
                        tileRefs.current[b.item.id] = el;
                      }}
                      item={b.item}
                      total={b.runningTotal}
                      cost={b.paidCost}
                      onClick={() => selectIndex(build.items.indexOf(b))}
                    />
                  ))}
                </div>
              </section>
            );
          })}
          <section className="row abilities" aria-label="Ability Order">
            <h2 className="row-head">Ability Order</h2>
            <ol
              className="ap-grid"
              data-order={JSON.stringify(build.abilityOrder.map((s) => [s.ability.name, s.kind]))}
              style={{ '--ap-cols': build.abilityOrder.length } as React.CSSProperties}
            >
              {abilities.map((a) => (
                <li key={a.id} className="ap-row" data-ability={a.name} aria-label={a.name}>
                  <span className="ap-icon">
                    <img src={img(a.image_webp)} alt="" width={32} height={32} />
                  </span>
                  {build.abilityOrder
                    .filter((s) => s.ability.id === a.id)
                    .map((s) => (
                      <span
                        key={s.index}
                        role="img"
                        className={['ap-mark', s.kind].join(' ')}
                        data-ability={a.name}
                        data-index={s.index}
                        style={{ gridColumn: s.index + 2 }}
                        aria-label={`${a.name} ${STEP_LABEL[s.kind]}, point ${s.index + 1}`}
                      >
                        <PointGlyph unlock={s.kind === 'unlock'} />
                        {s.kind === 'unlock' ? null : TIER_COST[s.kind]}
                      </span>
                    ))}
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
      <ItemCard
        open={openIndex !== null}
        items={build.items}
        index={openIndex ?? lastOpenIndex}
        onClose={() => setOpenIndex(null)}
        onNavigate={selectIndex}
        returnFocus={(itemId) => tileRefs.current[itemId]?.focus()}
      />
    </>
  );
}
