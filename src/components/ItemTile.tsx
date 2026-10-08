import { forwardRef } from 'react';
import { img } from '../data/load';
import { CORRUPT_FRAME } from '../export/png';
import type { Item } from '../types';

const ROMAN = ['', 'I', 'II', 'III', 'IV'];

// One shop-style item card: slot-coloured art, roman tier flag top-right, name plate below.
export const ItemTile = forwardRef<
  HTMLButtonElement | HTMLDivElement,
  {
    item: Item;
    onClick?: () => void;
    total?: number;
    cost?: number;
    sell?: string; // bought early and sold later to free the slot: the name of the item it makes room for
    spike?: boolean; // this buy takes its colour's spend past a spike (a mark only: no words on the build screen)
    corrupt?: number | true; // swap for the corrupted copy at the Broker, in this order (1 first); true = the corrupted frame alone
  }
>(function ItemTile({ item, onClick, total, cost, sell, corrupt, spike }, ref) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      ref={ref as never}
      className={['tile', item.item_slot_type, spike ? 'spike' : null, corrupt !== undefined ? 'corrupted' : null, sell ? 'sold' : null]
        .filter(Boolean)
        .join(' ')}
      onClick={onClick}
      data-cost={cost ?? item.cost}
      data-total={total}
      title={sell ? `Sell later, when you buy ${sell}` : undefined}
    >
      <span className="art">
        <img src={img(item.shop_image_webp || item.image_webp)} alt="" loading="lazy" width={96} height={96} />
        {corrupt !== undefined && <img className="corrupt-frame" src={img(CORRUPT_FRAME)} alt="" width={96} height={96} />}
      </span>
      <span className="tier">
        <span>{ROMAN[item.item_tier] ?? item.item_tier}</span>
      </span>
      {typeof corrupt === 'number' && (
        <span className="corrupt-tag">
          <b>
            <span className="sr-only">corrupt </span>
            {corrupt}
          </b>
        </span>
      )}
      {sell && (
        <span className="sell-tag">
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M8 2 2 8M8 2H4M8 2v4" />
          </svg>
          <span className="sr-only">sell later</span>
        </span>
      )}
      {item.is_active_item && (
        <span className="active-tag">
          <b>ACTIVE</b>
        </span>
      )}
      <span className="plate">{item.name}</span>
    </Tag>
  );
});
