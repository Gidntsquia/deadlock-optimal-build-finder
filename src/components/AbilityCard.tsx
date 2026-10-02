import { useMemo, useState, type ReactNode } from 'react';
import { img } from '../data/load';
import type { Ability, AbilityProperty, AbilityStep, BuildItem } from '../types';
import { boostsAt, heldItems, itemBoosts, timeline, type Boosts, type HeroLevels, type Moment } from '../abilityProgress';
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
// two decimals for small values (0.15s), fewer once spirit power makes them big (101 damage)
const round = (n: number) => {
  const d = Math.abs(n) >= 100 ? 1 : Math.abs(n) >= 10 ? 10 : 100;
  return String(Math.round(n * d) / d);
};
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

// charge counts and the delay between charges often carry no scale tag in the data; go by name for those
const BY_NAME: Record<string, string> = { AbilityCharges: 'EMaxChargesIncrease', AbilityCooldownBetweenCharge: 'ETechCooldownBetweenChargeUses' };
const kinds = (k: string, p: AbilityProperty) => {
  const own = Array.isArray(p.scale) ? p.scale : [p.scale];
  return BY_NAME[k] && !own.includes(BY_NAME[k]) ? [...own, BY_NAME[k]] : own;
};
const shareOf = (cuts: number[]) => 1 - cuts.reduce((m, c) => m * (1 - c), 1);

/** Values with what the hero has at this point of the build: spirit power, cooldown, duration, range, charges. */
function withBoosts(a: Ability, values: Record<string, number>, scales: Record<string, number>, b: Boosts) {
  const out = { ...values };
  const charged = (values.AbilityCharges ?? 0) > 1;
  const spirit = (b.spirit + (charged ? b.chargedSpirit : 0)) * (1 + b.spiritPct / 100);
  const cdr = [...b.cdr, charged ? b.chargedCdr / 100 : 0, a.ability_type === 'ultimate' ? b.ultCdr / 100 : 0].filter(Boolean);
  for (const [k, p] of Object.entries(a.properties)) {
    if (!Number.isFinite(out[k])) continue;
    for (const s of kinds(k, p)) {
      if (s === 'ETechPower' && scales[k]) out[k] += scales[k] * spirit;
      else if (s === 'ETechCooldown') out[k] *= 1 - shareOf(cdr);
      else if (s === 'ETechDuration') out[k] *= 1 + b.duration / 100;
      else if (s === 'ETechRange') out[k] *= 1 + b.range / 100;
      else if (s === 'ETechRadius') out[k] *= 1 + b.radius / 100;
      else if (s === 'EMaxChargesIncrease') out[k] += charged ? b.charges : b.newCharges;
      else if (s === 'ETechCooldownBetweenChargeUses') out[k] *= 1 - b.betweenChargeCdr / 100;
    }
  }
  return { values: out, spirit, cdr: shareOf(cdr), charged };
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
  hero,
  items,
}: {
  open: boolean;
  view: AbilityView;
  abilities: Ability[]; // the hero's four, in grid order
  order: AbilityStep[]; // the build's ability order
  hero: HeroLevels;
  items: BuildItem[]; // the build's items, in buy order
  onClose: () => void;
  onNavigate: (v: AbilityView) => void;
  returnFocus: (v: AbilityView) => void;
}) {
  const a = abilities.find((x) => x.id === view.abilityId) ?? abilities[0];
  // Build progress: a slider over every item buy and ability point. A point view starts at that point;
  // an ability view starts at the start of the game (and keeps its place when Previous/Next change ability).
  const moments = useMemo(() => timeline(items, order, hero), [items, order, hero]);
  const posOf = (point: number) => moments.findIndex((m) => m.kind === 'point' && m.point === point);
  const startPos = view.point === null ? 0 : posOf(view.point);
  const [pos, setPos] = useState(startPos);
  const [seen, setSeen] = useState({ view, open });
  if (seen.view !== view || seen.open !== open) {
    setSeen({ view, open });
    if (view.point !== null || (open && !seen.open)) setPos(startPos);
  }
  const moment: Moment = moments[pos] ?? moments[0];
  const step = moment.kind === 'point' ? order[moment.point] : null;
  const ownPoints = order.filter((s) => s.ability.id === a.id);
  const ownDone = ownPoints.filter((s) => posOf(s.index) <= pos);
  // tiers bought so far (the order buys them in turn); the one bought at this moment is lit as current
  const level = Math.max(0, ...ownDone.map((s) => LEVEL[s.kind]));
  const here = step && step.ability.id === a.id ? LEVEL[step.kind] : null;
  const unlocked = ownDone.length > 0 || ownPoints.length === 0;
  const upg = upgraded(a, level);
  const { changed, scales } = upg;

  // imbue items held now: the player picks whether this ability is the one they went on
  const [imbued, setImbued] = useState<Set<string>>(() => new Set());
  const held = heldItems(moments, pos).map((b) => b.item);
  const imbues = held.filter((i) => itemBoosts(i).imbue);
  const onThis = imbues.filter((i) => imbued.has(`${a.id}:${i.id}`));
  const boosts = boostsAt(hero, moment.souls, held, onThis);
  const { values, spirit, cdr, charged } = withBoosts(a, upg.values, scales, boosts);
  const gains = [
    `Level ${boosts.level}`,
    spirit ? `Spirit power ${round(spirit)}` : null,
    cdr ? `Cooldown -${round(cdr * 100)}%` : null,
    boosts.duration ? `Duration +${round(boosts.duration)}%` : null,
    boosts.range ? `Range +${round(boosts.range)}%` : null,
    (charged ? boosts.charges : boosts.newCharges) ? `Charges +${charged ? boosts.charges : boosts.newCharges}` : null,
  ].filter((g): g is string => !!g);
  const say = (m: Moment) =>
    m.kind === 'start'
      ? 'Start of the game'
      : m.kind === 'item'
        ? `Bought ${m.item.item.name}`
        : `Point ${m.point + 1}: ${order[m.point].ability.name} ${STEP_LABEL[order[m.point].kind].toLowerCase()}`;

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

  // point view: the next or previous ability point from where the slider is
  const pointFrom = (d: -1 | 1) => {
    const ps = order.map((s) => ({ s, at: posOf(s.index) }));
    return d > 0 ? ps.find((p) => p.at > pos)?.s : ps.filter((p) => p.at < pos).pop()?.s;
  };
  const step1 = (d: -1 | 1) => {
    if (view.point !== null) {
      const next = pointFrom(d);
      if (next) onNavigate({ abilityId: next.ability.id, point: next.index });
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
        // focus the card itself so the arrow keys step points; Tab reaches the slider
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement | null)?.focus();
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          returnFocus(view);
        }}
        onKeyDown={(e) => {
          if ((e.target as HTMLElement).tagName === 'INPUT') return;
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

        {moment.kind === 'point' && step && (
          <div className="ab-point">
            <span className={['ab-point-chip', step.kind === 'unlock' ? 'unlock' : null].filter(Boolean).join(' ')}>
              <PointGlyph />
              {step.kind === 'unlock' ? null : TIER_COST[LEVEL[step.kind] - 1]}
            </span>
            <span>
              Point {moment.point + 1} of {order.length}:{' '}
              <b>{step.ability.id === a.id ? STEP_LABEL[step.kind] : `${step.ability.name} ${STEP_LABEL[step.kind].toLowerCase()}`}</b>
            </span>
          </div>
        )}
        {moment.kind === 'item' && (
          <div className="ab-point ab-bought">
            <img src={img(moment.item.item.shop_image_webp || moment.item.item.image_webp)} alt="" width={24} height={24} />
            <span>
              Bought <b>{moment.item.item.name}</b>
            </span>
          </div>
        )}

        <div className="ab-progress">
          <label className="ab-progress-head" htmlFor="ab-progress">
            <span>Build progress</span>
            <span>{moment.souls.toLocaleString('en-US')} souls</span>
          </label>
          <div className="ab-track">
            <input
              id="ab-progress"
              type="range"
              min={0}
              max={moments.length - 1}
              value={pos}
              aria-valuetext={say(moment)}
              onChange={(e) => setPos(Number(e.target.value))}
            />
            <div className="ab-track-marks" aria-hidden="true">
              {ownPoints.map((s) => (
                <span
                  key={s.index}
                  className={['ab-track-mark', posOf(s.index) <= pos ? 'done' : null].filter(Boolean).join(' ')}
                  style={{ left: `${(posOf(s.index) / Math.max(1, moments.length - 1)) * 100}%` }}
                >
                  <PointGlyph />
                </span>
              ))}
            </div>
          </div>
          <div className="ab-gains">
            {gains.map((g) => (
              <span key={g}>{g}</span>
            ))}
            {!unlocked && <span className="ab-locked">Not unlocked yet</span>}
          </div>
          {imbues.length > 0 && (
            <div className="ab-imbues">
              {imbues.map((i) => {
                const k = `${a.id}:${i.id}`;
                return (
                  <label key={i.id}>
                    <input
                      type="checkbox"
                      checked={imbued.has(k)}
                      onChange={() =>
                        setImbued((was) => {
                          const next = new Set(was);
                          if (!next.delete(k)) next.add(k);
                          return next;
                        })
                      }
                    />
                    {i.name} on this ability
                  </label>
                );
              })}
            </div>
          )}
        </div>

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
            const isHere = here === t + 1;
            const bought = t < level;
            const at = ownPoints.find((s) => s.kind === `tier${t + 1}`)?.index;
            return (
              <li key={t} className={['ab-tier', bought ? 'bought' : null, isHere ? 'here' : null].filter(Boolean).join(' ')}>
                <span className="ab-tier-cost">
                  <PointGlyph />
                  {TIER_COST[t]}
                </span>
                <div className="ab-tier-text">{tierText(a, t)}</div>
                {at !== undefined && <span className="ab-tier-when">{isHere ? 'This point' : `Point ${at + 1}`}</span>}
              </li>
            );
          })}
        </ol>

        <div className="ab-nav">
          <button className="pill" onClick={() => step1(-1)} disabled={view.point === null ? abilities.indexOf(a) === 0 : !pointFrom(-1)}>
            Previous
          </button>
          <button className="pill" onClick={() => step1(1)} disabled={view.point === null ? abilities.indexOf(a) === abilities.length - 1 : !pointFrom(1)}>
            Next
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
