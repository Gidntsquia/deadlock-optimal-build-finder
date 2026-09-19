import type { BuildItem } from '../types';
import { cleanText, fmtSouls, labelFor } from '../text';
import { ItemTile } from './ItemTile';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';

const SLOT_LABEL = { weapon: 'Weapon', vitality: 'Vitality', spirit: 'Spirit' } as const;
const HIDE = new Set(['AbilityUnitTargetLimit']);
// the assets API uses a `{s:sign}` token for "show a + on positive values"
const fmtPrefix = (prefix: string | undefined, v: unknown) => (prefix ?? '').replace('{s:sign}', Number(v) >= 0 ? '+' : '');
const isZero = (v: unknown) => ['0', '0.0', '-1', '-1.0', '', 'undefined'].includes(String(v));
// Raw `section_type` values from the assets API, mapped to headings a player would recognize.
const SECTION_LABEL: Record<string, string> = { innate: 'Stats', passive: 'Passive', active: 'Active' };
const sectionHeading = (t: string | undefined) => SECTION_LABEL[t ?? ''] ?? (t ? t.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Effect');

export function ItemCard({
  open,
  items,
  index,
  onClose,
  onNavigate,
  returnFocus,
}: {
  open: boolean;
  items: BuildItem[];
  index: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
  returnFocus: (itemId: number) => void;
}) {
  const bi = items[index];
  const it = bi.item;

  // Stat lines: properties the tooltip marks as shown, in tooltip order; fallback to all non-zero props.
  const ordered: string[] = [];
  for (const s of it.tooltip_sections)
    for (const a of s.section_attributes ?? [])
      for (const k of [...(a.important_properties ?? []), ...(a.elevated_properties ?? []), ...(a.properties ?? [])]) if (!ordered.includes(k)) ordered.push(k);
  const keys = (ordered.length ? ordered : Object.keys(it.properties)).filter((k) => it.properties[k] && !HIDE.has(k) && !isZero(it.properties[k].value));

  const shownTexts = new Set(it.tooltip_sections.flatMap((s) => (s.section_attributes ?? []).map((a) => cleanText(a.loc_string))));

  const goPrev = () => index > 0 && onNavigate(index - 1);
  const goNext = () => index < items.length - 1 && onNavigate(index + 1);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        className="sheet sheet-content item-sheet max-[899px]:translate-none"
        aria-describedby={undefined}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          returnFocus(it.id);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') {
            e.preventDefault();
            goNext();
          } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            goPrev();
          }
        }}
      >
        <div className="sheet-head">
          <ItemTile item={it} />
          <div>
            <DialogTitle asChild>
              <h2>{it.name}</h2>
            </DialogTitle>
            <div className="chips">
              <span className="chip">{SLOT_LABEL[it.item_slot_type]}</span>
              <span className="chip">Tier {it.item_tier}</span>
              <span className="chip souls">{fmtSouls(it.cost)}</span>
            </div>
          </div>
        </div>

        {keys.length > 0 && (
          <div className="tt-section">
            <h3>Stats</h3>
            {keys.map((k) => {
              const p = it.properties[k];
              return (
                <div className="stat-line" key={k}>
                  <span>{labelFor(k, p.label)}</span>
                  <b>
                    {fmtPrefix(p.prefix, p.value)}
                    {String(p.value)}
                    {p.postfix ?? ''}
                  </b>
                </div>
              );
            })}
          </div>
        )}

        {it.tooltip_sections.map((s, i) => {
          const texts = (s.section_attributes ?? []).map((a) => cleanText(a.loc_string)).filter(Boolean);
          if (!texts.length) return null;
          return (
            <div className="tt-section" key={i}>
              <h3>{sectionHeading(s.section_type)}</h3>
              {texts.map((t, j) => (
                <p key={j}>{t}</p>
              ))}
            </div>
          );
        })}
        {Object.entries(it.description)
          .filter(([, v]) => v && !shownTexts.has(cleanText(v)))
          .map(([k, v]) => (
            <div className="tt-section" key={k}>
              <h3>{sectionHeading(k)}</h3>
              <p>{cleanText(v)}</p>
            </div>
          ))}
      </DialogContent>
    </Dialog>
  );
}
