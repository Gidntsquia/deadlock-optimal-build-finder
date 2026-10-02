import type { ReactNode } from 'react';
import { img } from '../data/load';
import type { Ability, AbilityProperty, AbilityStep } from '../types';
import { labelFor } from '../text';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';

// One view of an ability card: a whole ability (no point picked) or one point of the build's order.
export type AbilityView = { abilityId: number; point: number | null };

const TIER_COST = ['1', '2', '5'];
const STEP_LABEL = { unlock: 'Unlock', tier1: 'First upgrade', tier2: 'Second upgrade', tier3: 'Third upgrade' } as const;
const LEVEL = { unlock: 0, tier1: 1, tier2: 2, tier3: 3 } as const;

// ---- values ----
const num = (v: unknown) => parseFloat(String(v));
// "20m" carries its unit in the value; most properties carry it in postfix
const unitOf = (v: unknown, p: AbilityProperty | undefined) => p?.postfix ?? String(v).replace(/^[-+\d.\s]+/, '');
const round = (n: number) => String(Math.round(n * 100) / 100);
const fmt = (p: AbilityProperty | undefined, n: number) => {
  const sign = (p?.prefix ?? '').replace('{s:sign}', n >= 0 ? '+' : '');
  return `${sign}${round(n)}${unitOf(p?.value, p)}`;
};
const isOff = (p: AbilityProperty, n: number) => !Number.isFinite(n) || n === 0 || String(p.disable_value) === String(p.value);

/** Property values after the first `bought` upgrade tiers, plus which keys those upgrades changed. */
function upgraded(a: Ability, bought: number) {
  const values: Record<string, number> = {};
  const scales: Record<string, number> = {};
  const changed = new Set<string>();
  for (const [k, p] of Object.entries(a.properties)) {
    values[k] = num(p.value);
    if (p.stat_scale) scales[k] = p.stat_scale;
  }
  for (const tier of a.upgrades.slice(0, bought))
    for (const u of tier) {
      const b = num(u.bonus);
      if (!Number.isFinite(b)) continue;
      changed.add(u.name);
      if (!u.type || u.type === 'EAddToBase') values[u.name] = (values[u.name] || 0) + b;
      else if (u.type === 'EAddToScale') scales[u.name] = (scales[u.name] || 0) + b;
    }
  return { values, scales, changed };
}

// ---- the game's tooltip markup -> React ----
// Keyword colour from the game's class name (it colours the same names: spirit purple, weapon orange, healing green).
function toneOf(el: Element): string {
  const cls = el.getAttribute('class') ?? '';
  if (/diminish/.test(cls)) return 'dim';
  if (/spirit|silence/i.test(cls)) return 'spirit';
  if (/weapon|bullet|melee|fire ?rate/i.test(cls)) return 'weapon';
  if (/heal|regen|health|speed/i.test(cls)) return 'vitality';
  if (/damageamp/i.test(cls)) return 'warn';
  return 'hl';
}
function rich(html: string | undefined): ReactNode {
  if (!html) return null;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  let key = 0;
  const walk = (n: Node): ReactNode => {
    if (n.nodeType === Node.TEXT_NODE) return n.textContent;
    if (n.nodeType !== Node.ELEMENT_NODE) return null;
    const el = n as Element;
    const tag = el.tagName.toLowerCase();
    if (tag === 'br') return <br key={key++} />;
    if (tag === 'img' || tag === 'svg' || tag === 'panel') return null;
    const kids = [...el.childNodes].map(walk);
    if (tag === 'span') {
      const tone = toneOf(el);
      return (
        <span key={key++} className={`ab-${tone}`}>
          {kids}
        </span>
      );
    }
    return kids;
  };
  return [...doc.body.childNodes].map(walk);
}
const plain = (html: string | undefined) => (html ?? '').replace(/<[^>]+>/g, '').trim();

// tile colour from the game's css_class
const toneOfProp = (p: AbilityProperty | undefined) => {
  const c = p?.css_class ?? '';
  if (/tech|spirit/.test(c)) return 'spirit';
  if (/bullet|weapon|fire_rate|melee/.test(c)) return 'weapon';
  if (/heal|health|regen/.test(c)) return 'vitality';
  return 'plain';
};

// in-game point glyph (same shape as the ability grid's chips)
const PointGlyph = () => (
  <svg className="ab-glyph" viewBox="0 0 12 12" aria-hidden="true">
    <path strokeWidth="1.5" strokeLinejoin="round" d="M6 1 11 6 6 11 1 6Z" />
    <path className="ap-bolt" d="M7 2.4 3.6 6.7H5.6L5 9.6 8.4 5.3H6.4Z" />
  </svg>
);

/** Upgrade text for one tier: the game's own line, or one written from the stat bonuses when it has none. */
function tierText(a: Ability, t: number): ReactNode {
  const own = a.tier_desc?.[t];
  if (own) return rich(own);
  const lines = (a.upgrades[t] ?? []).map((u) => {
    const p = a.properties[u.name];
    const b = num(u.bonus);
    const label = labelFor(u.name, p?.label);
    if (u.type === 'EAddToScale') return `${label} grows ${round(b)} more per spirit power`;
    if (u.type === 'EMultiplyBase' || u.type === 'EMultiplyScale') return `${label} improved`;
    const sign = b >= 0 ? '+' : '';
    return `${sign}${round(b)}${unitOf(u.bonus, p)} ${label}`;
  });
  return lines.map((l, i) => <div key={i}>{l}</div>);
}

export function AbilityCard({
  open,
  view,
  abilities,
  order,
  onClose,
  onNavigate,
  returnFocus,
}: {
  open: boolean;
  view: AbilityView;
  abilities: Ability[]; // the hero's four, in grid order
  order: AbilityStep[]; // the build's ability order
  onClose: () => void;
  onNavigate: (v: AbilityView) => void;
  returnFocus: (v: AbilityView) => void;
}) {
  const a = abilities.find((x) => x.id === view.abilityId) ?? abilities[0];
  const step = view.point === null ? null : order[view.point];
  // tiers bought at this point: none for the plain ability view
  const level = step ? LEVEL[step.kind] : 0;
  const { values, scales, changed } = upgraded(a, level);
  const ownPoints = order.filter((s) => s.ability.id === a.id);

  const prop = (k: string) => a.properties[k];
  const shown = (k: string) => {
    const p = prop(k);
    return !!p && !isOff({ ...p, value: values[k] }, values[k]);
  };
  const valueOf = (k: string) => fmt(prop(k), values[k]);
  const upClass = (k: string) => (changed.has(k) ? 'ab-up' : undefined);

  const head = [
    'AbilityCooldown',
    ...(values.AbilityCharges > 1 ? ['AbilityCharges', 'AbilityCooldownBetweenCharge'] : []),
    'AbilityDuration',
    'AbilityCastRange',
    ...(a.tooltip?.header ?? []),
  ]
    .filter((k, i, all) => all.indexOf(k) === i)
    .filter(shown);
  const sections = (a.tooltip?.sections ?? []).filter((s) => !s.requires || changed.has(s.requires));

  const step1 = (d: -1 | 1) => {
    if (view.point !== null) {
      const next = view.point + d;
      if (next >= 0 && next < order.length) onNavigate({ abilityId: order[next].ability.id, point: next });
    } else {
      const i = abilities.indexOf(a) + d;
      if (i >= 0 && i < abilities.length) onNavigate({ abilityId: abilities[i].id, point: null });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        className="sheet sheet-content ability-sheet max-[899px]:translate-none"
        aria-describedby={undefined}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          returnFocus(view);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') {
            e.preventDefault();
            step1(1);
          } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            step1(-1);
          }
        }}
      >
        <div className="ab-head">
          <span className="ab-icon">
            <img src={img(a.image_webp)} alt="" width={48} height={48} />
          </span>
          <div className="ab-title">
            <DialogTitle asChild>
              <h2>{a.name}</h2>
            </DialogTitle>
            {a.quip && <p className="ab-quip">{plain(a.quip)}</p>}
          </div>
        </div>

        {step && (
          <div className="ab-point">
            <span className={['ab-point-chip', step.kind === 'unlock' ? 'unlock' : null].filter(Boolean).join(' ')}>
              <PointGlyph />
              {step.kind === 'unlock' ? null : TIER_COST[level - 1]}
            </span>
            <span>
              Point {view.point! + 1} of {order.length}: <b>{STEP_LABEL[step.kind]}</b>
            </span>
          </div>
        )}

        {head.length > 0 && (
          <div className="ab-stats-head">
            {head.map((k) => (
              <span key={k} className={['ab-hstat', upClass(k)].filter(Boolean).join(' ')}>
                {prop(k)?.icon && <img src={img(prop(k)!.icon)} alt="" width={16} height={16} />}
                <b>{valueOf(k)}</b>
                <span>{labelFor(k, prop(k)?.label)}</span>
              </span>
            ))}
          </div>
        )}

        <div className="ab-body">
          {sections.length === 0 && <p className="ab-text">{rich(a.description || a.passive || a.active)}</p>}
          {sections.map((s, i) => {
            const blocks = s.blocks
              .map((b) => ({ ...b, props: b.props.filter((p) => shown(p.key) || (p.status && p.status_value && shown(p.status_value))) }))
              .filter((b) => b.props.length);
            const basic = (s.basic ?? []).filter(shown);
            return (
              <div className={['ab-section', s.requires ? 'ab-unlocked' : null].filter(Boolean).join(' ')} key={i}>
                {s.text && <p className="ab-text">{rich(s.text)}</p>}
                {blocks.length > 0 && (
                  <div className="ab-blocks">
                    {blocks.map((b, j) => (
                      <div className="ab-block" key={j}>
                        {b.title && <h3>{plain(b.title)}</h3>}
                        <div className="ab-tiles">
                          {b.props.map((pp) => {
                            const p = prop(pp.key);
                            const status = !!(pp.status && pp.status_value);
                            const key = status ? pp.status_value! : pp.key;
                            const icon = pp.icon ?? p?.icon;
                            const scale = !status && p?.scale === 'ETechPower' ? scales[pp.key] : undefined;
                            return (
                              <div className={['ab-tile', toneOfProp(p), upClass(key)].filter(Boolean).join(' ')} key={pp.key}>
                                {icon && <img src={img(icon)} alt="" width={20} height={20} />}
                                <b>{valueOf(key)}</b>
                                <span>{status ? pp.status : labelFor(pp.key, p?.label)}</span>
                                {!status && pp.status_value && shown(pp.status_value) && <small>for {valueOf(pp.status_value)}</small>}
                                {scale ? <small className="ab-spirit">+{round(scale)} per spirit power</small> : null}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {basic.length > 0 && (
                  <div className="ab-basic">
                    {basic.map((k) => (
                      <div key={k} className={upClass(k)}>
                        <span>{labelFor(k, prop(k)?.label)}</span>
                        <b>{valueOf(k)}</b>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <ol className="ab-tiers" aria-label="Upgrades">
          {[0, 1, 2].map((t) => {
            const bought = t < level;
            const here = step && level === t + 1;
            const at = ownPoints.find((s) => s.kind === `tier${t + 1}`)?.index;
            return (
              <li key={t} className={['ab-tier', bought ? 'bought' : null, here ? 'here' : null].filter(Boolean).join(' ')}>
                <span className="ab-tier-cost">
                  <PointGlyph />
                  {TIER_COST[t]}
                </span>
                <div className="ab-tier-text">{tierText(a, t)}</div>
                {at !== undefined && <span className="ab-tier-when">{here ? 'This point' : `Point ${at + 1}`}</span>}
              </li>
            );
          })}
        </ol>

        <div className="ab-nav">
          <button className="pill" onClick={() => step1(-1)} disabled={view.point === null ? abilities.indexOf(a) === 0 : view.point === 0}>
            Previous
          </button>
          <button
            className="pill"
            onClick={() => step1(1)}
            disabled={view.point === null ? abilities.indexOf(a) === abilities.length - 1 : view.point === order.length - 1}
          >
            Next
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
