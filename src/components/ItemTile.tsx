import { forwardRef } from 'react';
import { img } from '../data/load';
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
  }
>(function ItemTile({ item, onClick, total, cost }, ref) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag ref={ref as never} className={`tile ${item.item_slot_type}`} onClick={onClick} data-cost={cost ?? item.cost} data-total={total}>
      <span className="art">
        <img src={img(item.shop_image_webp || item.image_webp)} alt="" loading="lazy" width={96} height={96} />
      </span>
      <span className="tier">
        <span>{ROMAN[item.item_tier] ?? item.item_tier}</span>
      </span>
      {item.is_active_item && (
        <span className="active-tag">
          <b>ACTIVE</b>
        </span>
      )}
      <span className="plate">{item.name}</span>
    </Tag>
  );
});
