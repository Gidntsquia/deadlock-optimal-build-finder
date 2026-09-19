import { img } from '../data/load';
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
const TIER = { unlock: 0, tier1: 1, tier2: 2, tier3: 3 } as const;
const STEP_LABEL = { unlock: 'unlock', tier1: 'upgrade 1', tier2: 'upgrade 2', tier3: 'upgrade 3' } as const;

export function BuildView({
  build,
  builds,
  onPickStyle,
  onOpenHeroes,
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
  panel: PanelValidation | null;
  hero: Pick<Hero, 'name' | 'images'>;
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
        <button className="hero-avatar hero-btn" onClick={onOpenHeroes} aria-label={`${hero.name}, change hero`}>
          <img src={img(hero.images.small)} alt="" width={44} height={44} />
        </button>
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
            <ol className="steps">
              {build.abilityOrder.map((s) => (
                <li
                  key={s.index}
                  className={['step', s.kind].join(' ')}
                  data-ability={s.ability.name}
                  title={`${s.ability.name} ${STEP_LABEL[s.kind]}`}
                  aria-label={`${s.ability.name} ${STEP_LABEL[s.kind]}`}
                >
                  <img src={img(s.ability.image_webp)} alt="" width={32} height={32} />
                  <span className="pips" aria-hidden="true">
                    {Array.from({ length: TIER[s.kind] }, (_, i) => (
                      <i key={i} />
                    ))}
                  </span>
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
