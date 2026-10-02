import { Fragment, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { img } from '../data/load';
import type { Ability, AbilityProperty, AbilityStep, BuildItem } from '../types';
import { isImbueItem } from '../generator/build';
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

const kinds = (p: AbilityProperty) => (Array.isArray(p.scale) ? p.scale : [p.scale]);
const shareOf = (cuts: number[]) => 1 - cuts.reduce((m, c) => m * (1 - c), 1);

/** Values with what the hero has at this point of the build: spirit power, cooldown, duration, range, charges. */
function withBoosts(a: Ability, values: Record<string, number>, scales: Record<string, number>, b: Boosts) {
  const out = { ...values };
  const charged = (values.AbilityCharges ?? 0) > 1;
  const spirit = (b.spirit + (charged ? b.chargedSpirit : 0)) * (1 + b.spiritPct / 100);
  const cdr = [...b.cdr, charged ? b.chargedCdr / 100 : 0, a.ability_type === 'ultimate' ? b.ultCdr / 100 : 0].filter(Boolean);
  for (const [k, p] of Object.entries(a.properties)) {
    if (!Number.isFinite(out[k])) continue;
    for (const s of kinds(p)) {
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

  // imbue items: each goes on one ability, the one the build names (imbueOn) unless the player moves it here
  const recommended = useMemo(() => new Map(items.flatMap((b) => (b.imbueOn ? [[b.item.id, b.imbueOn.ability.id] as const] : []))), [items]);
  const [imbuedOn, setImbuedOn] = useState(recommended);
  const [seenItems, setSeenItems] = useState(items);
  if (seenItems !== items) {
    setSeenItems(items);
    setImbuedOn(recommended);
  }
  const held = heldItems(moments, pos).map((b) => b.item);
  // every imbue item in the build keeps its row from the start (so the card keeps its size); it shows once bought
  const imbues = items.map((b) => b.item).filter((i, n, all) => isImbueItem(i) && all.findIndex((o) => o.id === i.id) === n);
  const boostsFor = (p: number, h: typeof held) =>
    boostsAt(
      hero,
      moments[p].souls,
      h,
      h.filter((i) => itemBoosts(i).imbue && imbuedOn.get(i.id) === a.id),
    );
  const boosts = boostsFor(pos, held);
  const { values } = withBoosts(a, upg.values, scales, boosts);
  // the end of the build: every point and item in, usually the card at its tallest
  const last = moments.length - 1;
  const levelAtPos = (p: number) => Math.max(0, ...ownPoints.filter((s) => posOf(s.index) <= p).map((s) => LEVEL[s.kind]));
  const endUpg = upgraded(a, levelAtPos(last));
  const endValues = withBoosts(
    a,
    endUpg.values,
    endUpg.scales,
    boostsFor(
      last,
      heldItems(moments, last).map((x) => x.item),
    ),
  ).values;
  // what the hero has at moment p, as the short lines under the slider
  const gainsAt = (p: number) => {
    const b =
      p === pos
        ? boosts
        : boostsFor(
            p,
            heldItems(moments, p).map((x) => x.item),
          );
    const u = p === pos ? upg : upgraded(a, levelAtPos(p));
    const { spirit, cdr, charged } = withBoosts(a, u.values, u.scales, b);
    return [
      `Level ${b.level}`,
      spirit ? `Spirit power ${round(spirit)}` : null,
      cdr ? `Cooldown -${round(cdr * 100)}%` : null,
      b.duration ? `Duration +${round(b.duration)}%` : null,
      b.range ? `Range +${round(b.range)}%` : null,
      (charged ? b.charges : b.newCharges) ? `Charges +${charged ? b.charges : b.newCharges}` : null,
    ].filter((g): g is string => !!g);
  };
  const gains = gainsAt(pos);
  // every moment's lines, laid under the shown ones unseen, so the box is as tall as its tallest moment and the card keeps its size
  const lockedAt = (p: number) => ownPoints.length > 0 && !ownPoints.some((s) => posOf(s.index) <= p);
  const allGains = [...new Set(moments.map((_, p) => [...gainsAt(p), ...(lockedAt(p) ? ['Not unlocked yet'] : [])].join('|')))];
  // items sold to make room for this buy
  const soldFor = (b: BuildItem) => items.filter((o) => o.sellFor?.id === b.item.id);
  const say = (m: Moment) =>
    m.kind === 'start'
      ? 'Start of the game'
      : m.kind === 'item'
        ? [`Bought ${m.item.item.name}`, ...soldFor(m.item).map((b) => `sold ${b.item.name}`)].join(', ')
        : m.kind === 'level'
          ? `Level ${m.level}`
          : `Point ${m.point + 1}: ${order[m.point].ability.name} ${STEP_LABEL[order[m.point].kind].toLowerCase()}`;

  const prop = (k: string) => a.properties[k];
  // the stat lines and effect tiles for one set of values; drawn for now, and unseen for the end of the build to hold the card's size
  const statsView = (values: Record<string, number>, changed: Set<string>, scales: Record<string, number>) => {
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
    return (
      <>
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
      </>
    );
  };

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

  // the card never shrinks while the slider moves: it keeps the tallest height it has had for this ability at this width
  const sheet = useRef<HTMLDivElement>(null);
  const tallest = useRef({ key: '', h: 0 });
  useLayoutEffect(() => {
    const el = sheet.current;
    if (!el) return;
    const key = `${a.id}:${window.innerWidth}`;
    if (tallest.current.key !== key) {
      tallest.current = { key, h: 0 };
      el.style.minHeight = '';
    }
    const h = el.getBoundingClientRect().height;
    if (h > tallest.current.h) {
      tallest.current.h = h;
      el.style.minHeight = `${h}px`;
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        ref={sheet}
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

        {moment.kind === 'start' && (
          <div className="ab-point">
            <span>Start of the game</span>
          </div>
        )}
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
              {soldFor(moment.item).map((b) => (
                <Fragment key={b.item.id}>
                  , sold <b>{b.item.name}</b>
                </Fragment>
              ))}
            </span>
          </div>
        )}
        {moment.kind === 'level' && (
          <div className="ab-point">
            <span>
              Reached <b>level {moment.level}</b>
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
          <div className="ab-gains-box">
            <div className="ab-gains">
              {gains.map((g) => (
                <span key={g}>{g}</span>
              ))}
              {!unlocked && <span className="ab-locked">Not unlocked yet</span>}
            </div>
            {allGains.map((g) => (
              <div className="ab-gains ab-sizer" aria-hidden="true" key={g}>
                {g.split('|').map((x) => (
                  <span key={x}>{x}</span>
                ))}
              </div>
            ))}
          </div>
          {imbues.length > 0 && (
            <div className="ab-imbues">
              {imbues.map((i) => {
                const have = held.includes(i);
                const on = imbuedOn.get(i.id) === a.id;
                return (
                  <label key={i.id} className={have ? undefined : 'unseen'} aria-hidden={have ? undefined : true}>
                    <input
                      type="checkbox"
                      disabled={!have}
                      checked={have && on}
                      onChange={() =>
                        setImbuedOn((was) => {
                          const next = new Map(was);
                          if (on) next.delete(i.id);
                          else next.set(i.id, a.id); // one ability per item: moving it here takes it off the other
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

        <div className="ab-stack">
          <div>{statsView(values, changed, scales)}</div>
          <div className="ab-sizer" aria-hidden="true" inert>
            {statsView(endValues, endUpg.changed, endUpg.scales)}
          </div>
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
