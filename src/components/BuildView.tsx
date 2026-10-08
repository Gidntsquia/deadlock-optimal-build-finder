import { heroBackdrop, img } from '../data/load';
import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Build, Hero, Phase } from '../types';
import type { PanelValidation } from '../validation/heldout';
import { ItemCard } from './ItemCard';
import { ItemTile } from './ItemTile';
import { Details } from './Details';
import { AbilityCard, type AbilityView } from './AbilityCard';
import { abilityRows, renderBuildPng } from '../export/png';
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
// small badge on the phone avatar; the avatar button itself is the click target
const SwapBadge = () => (
  <span className="hero-cue" aria-hidden="true">
    <svg viewBox="0 0 16 16">
      <path d="M2 5h10L9.5 2.5M14 11H4l2.5 2.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </span>
);

// Phone: the point chips are too narrow to tap one by one, so each ability row is one button
// and the tap position picks the point (keyboard activation opens the whole ability).
const PHONE = '(max-width: 899px)';
const subscribePhone = (cb: () => void) => {
  const m = window.matchMedia(PHONE);
  m.addEventListener('change', cb);
  return () => m.removeEventListener('change', cb);
};
const usePhone = () => useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE).matches);

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
  sinceDate,
  fetchedDate,
  stale,
}: {
  build: Build;
  builds: Build[];
  onPickStyle: (b: Build) => void;
  onOpenHeroes: () => void;
  onStepHero: (d: -1 | 1) => void;
  panel: PanelValidation | null;
  hero: Pick<Hero, 'id' | 'name' | 'images' | 'abilities' | 'level_info' | 'standard_level_up_upgrades'>;
  windowDays?: number;
  sinceDate: string | null;
  fetchedDate: string | null;
  stale: boolean;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  // Detailed view: sell and corrupt marks on the tiles. Off by default; remembered per browser.
  const [detailed, setDetailed] = useState(() => {
    try {
      return localStorage.getItem('detailed') === '1';
    } catch {
      return false;
    }
  });
  const toggleDetailed = () => {
    const next = !detailed;
    setDetailed(next);
    try {
      localStorage.setItem('detailed', next ? '1' : '0');
    } catch {
      /* storage blocked: the choice lasts this visit only */
    }
  };
  // the item sheet shows the base item outside detailed view, like the tiles do
  const cardItems = useMemo(() => (detailed ? build.items : build.items.map((b) => ({ ...b, corrupt: undefined }))), [detailed, build.items]);
  const switchRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const el = switchRef.current;
    if (!el) return;
    const place = () => {
      const on = el.querySelector<HTMLElement>('.style-pill[aria-pressed="true"]');
      if (!on) return;
      el.style.setProperty('--thumb-x', `${on.offsetLeft}px`);
      el.style.setProperty('--thumb-w', `${on.offsetWidth}px`);
      el.dataset.ready = '1';
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [build.key, builds.length]);
  const tileRefs = useRef<Record<number, HTMLButtonElement | HTMLDivElement | null>>({});
  // The dialog stays mounted so its close transition has content; lastOpenIndex keeps that content valid while it closes.
  const [lastOpenIndex, setLastOpenIndex] = useState(0);
  const selectIndex = (i: number) => {
    setOpenIndex(i);
    setLastOpenIndex(i);
  };
  // ability card: same keep-content-while-closing pattern as the item sheet
  const [abilityView, setAbilityView] = useState<AbilityView | null>(null);
  const [lastAbilityView, setLastAbilityView] = useState<AbilityView | null>(null);
  const showAbility = (v: AbilityView) => {
    setAbilityView(v);
    setLastAbilityView(v);
  };
  const abilityRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const abilityKey = (v: AbilityView) => (v.point === null ? `a${v.abilityId}` : `p${v.point}`);
  const phone = usePhone();
  const pickPoint = (e: React.MouseEvent<HTMLButtonElement>, abilityId: number) => {
    const marks = [...(e.currentTarget.parentElement?.querySelectorAll<HTMLElement>('.ap-mark') ?? [])];
    const hit = e.detail ? marks.find((m) => ((r) => e.clientX >= r.left && e.clientX <= r.right)(m.getBoundingClientRect())) : undefined;
    showAbility({ abilityId, point: hit ? Number(hit.dataset.index) : null });
  };
  const title = `${hero.name} - ${build.name}`;
  const abilities = abilityRows(build, hero.abilities);
  const sharePng = async () => {
    setBusy(true);
    const toastId = toast.loading('Saving image');
    try {
      const blob = await renderBuildPng(build, { heroName: hero.name, heroImage: img(hero.images.small), abilitySlots: hero.abilities, img, detailed });
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
            <SwapBadge />
          </button>
          <HeroArrow dir={1} onStep={onStepHero} />
        </div>
        <h1 title={title}>{title}</h1>
        {builds.length > 1 && (
          <div className="pills style-switch" role="group" aria-label="Build" ref={switchRef}>
            <span className="style-thumb" aria-hidden="true" />
            {builds.map((b) => (
              <button key={b.key} className="pill style-pill" aria-pressed={b.key === build.key} onClick={() => onPickStyle(b)}>
                {b.name.replace(/ build$/, '')}
              </button>
            ))}
          </div>
        )}
        <div className="actions">
          <button className="pill detail-btn" aria-pressed={detailed} onClick={toggleDetailed} title="Show which items to sell later and which to corrupt">
            Detailed
          </button>
          <button className="pill share-btn" onClick={sharePng} disabled={busy}>
            Share
          </button>
          <Details build={build} panel={panel} heroName={hero.name} windowDays={windowDays} sinceDate={sinceDate} fetchedDate={fetchedDate} />
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
                      sell={detailed ? b.sellFor?.name : undefined}
                      corrupt={detailed ? b.corrupt?.rank : undefined}
                      spike={!!b.spike}
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
                  {phone ? (
                    <>
                      <button
                        className="ap-row-btn"
                        ref={(el) => {
                          abilityRefs.current[`a${a.id}`] = el;
                        }}
                        onClick={(e) => pickPoint(e, a.id)}
                        aria-label={`${a.name}, show ability and upgrades`}
                      />
                      <span className="ap-icon">
                        <img src={img(a.image_webp)} alt="" width={32} height={32} />
                      </span>
                    </>
                  ) : (
                    <button
                      className="ap-icon"
                      ref={(el) => {
                        abilityRefs.current[`a${a.id}`] = el;
                      }}
                      onClick={() => showAbility({ abilityId: a.id, point: null })}
                      aria-label={`${a.name}, show ability`}
                    >
                      <img src={img(a.image_webp)} alt="" width={32} height={32} />
                    </button>
                  )}
                  {build.abilityOrder
                    .filter((s) => s.ability.id === a.id)
                    .map((s) => {
                      const props = {
                        className: ['ap-mark', s.kind].join(' '),
                        'data-ability': a.name,
                        'data-index': s.index,
                        style: { gridColumn: s.index + 2 },
                        'aria-label': `${a.name} ${STEP_LABEL[s.kind]}, point ${s.index + 1}`,
                      };
                      const chip = (
                        <span className="ap-chip">
                          <PointGlyph unlock={s.kind === 'unlock'} />
                          {s.kind === 'unlock' ? null : TIER_COST[s.kind]}
                        </span>
                      );
                      return phone ? (
                        <span key={s.index} role="img" {...props}>
                          {chip}
                        </span>
                      ) : (
                        <button
                          key={s.index}
                          {...props}
                          ref={(el) => {
                            abilityRefs.current[`p${s.index}`] = el;
                          }}
                          onClick={() => showAbility({ abilityId: a.id, point: s.index })}
                        >
                          {chip}
                        </button>
                      );
                    })}
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
      <ItemCard
        open={openIndex !== null}
        items={cardItems}
        index={openIndex ?? lastOpenIndex}
        onClose={() => setOpenIndex(null)}
        onNavigate={selectIndex}
        returnFocus={(itemId) => tileRefs.current[itemId]?.focus()}
      />
      {lastAbilityView && (
        <AbilityCard
          open={abilityView !== null}
          view={lastAbilityView}
          abilities={abilities}
          order={build.abilityOrder}
          hero={hero}
          items={build.items}
          onClose={() => setAbilityView(null)}
          onNavigate={showAbility}
          returnFocus={(v) => (abilityRefs.current[abilityKey(v)] ?? abilityRefs.current[`a${v.abilityId}`])?.focus()}
        />
      )}
    </>
  );
}
