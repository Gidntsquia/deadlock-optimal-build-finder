// Draws a build board to a PNG for sharing: the same teal frame, parchment rows, slot-coloured tiles, tier flags and
// ability order as the on-screen BuildView, and like it, no numbers. Item images are same-origin snapshot files, so the canvas is not
// tainted and toBlob works.
import type { Build, Phase } from '../types';

const C = {
  room: '#0e1a19',
  board: '#cbbd9f',
  edge: '#a89873',
  head: '#b7a986',
  ink: '#2b241a',
  soft: '#6b5e46',
  teal: '#62b6c8',
  tealInk: '#1b3a44',
  // [art, tier flag, name plate]
  slot: { weapon: ['#e6ad5f', '#c98a3a', '#f1dcb4'], vitality: ['#a6cf6e', '#7fae47', '#dcebbf'], spirit: ['#b992e4', '#9a6fd0', '#e4d5f5'] } as Record<
    string,
    [string, string, string]
  >,
  rowHead: '#564d3d',
  rowHeadInk: '#f4ead3',
  rowBody: '#bfb08f',
  unlock: '#a06be0',
  glyph: '#a9a39a',
  navy: '#2b3d70',
  navyTrack: '#1a2a58',
  navyInk: '#e9edf8',
  iconBg: '#f3ead6',
};
const ROMAN = ['', 'I', 'II', 'III', 'IV'];
const PHASES: { key: Phase; label: string }[] = [
  { key: 'early', label: 'Early Game' },
  { key: 'mid', label: 'Mid Game' },
  { key: 'late', label: 'Late Game' },
];
const TIER_COST = { tier1: '1', tier2: '2', tier3: '5' } as const;
const FONT = 'Nunito, "Segoe UI", system-ui, sans-serif';

const loadImg = (src?: string) =>
  new Promise<HTMLImageElement | null>((res) => {
    if (!src) return res(null);
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => res(null);
    i.src = src;
  });

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
function wrap(g: CanvasRenderingContext2D, text: string, max: number): string[] {
  const words = text.split(' '),
    lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (g.measureText(t).width > max && cur) {
      lines.push(cur);
      cur = w;
    } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

export interface PngOptions {
  heroName: string;
  heroImage?: string;
  img: (p?: string) => string | undefined;
  scale?: number;
}

export async function renderBuildPng(build: Build, o: PngOptions): Promise<Blob> {
  const scale = o.scale ?? 2,
    COLS = 11,
    TILE = 80,
    GAP = 8,
    TILE_H = TILE + 34,
    EDGE = 12,
    PAD = 12,
    HEAD = 56,
    ROW_HEAD = 28,
    inner = COLS * TILE + (COLS - 1) * GAP,
    W = EDGE + PAD + 8 + inner + 8 + PAD + 8;
  const phases = PHASES.map((p) => ({ ...p, rows: build.items.filter((b) => b.phase === p.key) })).filter((p) => p.rows.length);
  const abilities = [...new Map(build.abilityOrder.map((s) => [s.ability.id, s.ability])).values()];
  const tileImgs = new Map(
    await Promise.all(build.items.map(async (b) => [b.item.id, await loadImg(o.img(b.item.shop_image_webp || b.item.image_webp))] as const)),
  );
  const abImgs = new Map(await Promise.all(abilities.map(async (a) => [a.id, await loadImg(o.img(a.image_webp))] as const)));
  const heroImg = await loadImg(o.heroImage);
  try {
    await (document as unknown as { fonts?: { load: (f: string) => Promise<unknown> } }).fonts?.load(`800 16px ${FONT}`);
  } catch {
    /* fallback font */
  }

  const rowH = (n: number) => ROW_HEAD + 8 + Math.ceil(n / COLS) * (TILE_H + GAP);
  const AB = 40,
    AP_ROW = 40;
  const apH = ROW_HEAD + 8 + abilities.length * AP_ROW + 8;
  const boardH = PAD + phases.reduce((a, p) => a + rowH(p.rows.length) + 8, 0) + apH + PAD;
  const H = HEAD + boardH + 8;
  const cv = document.createElement('canvas');
  cv.width = W * scale;
  cv.height = H * scale;
  const g = cv.getContext('2d')!;
  g.scale(scale, scale);

  // teal frame with the build title
  g.fillStyle = C.teal;
  g.fillRect(0, 0, W, H);
  let tx = EDGE + 4;
  if (heroImg) {
    g.save();
    g.beginPath();
    g.arc(tx + 20, HEAD / 2, 20, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = C.room;
    g.fill();
    g.drawImage(heroImg, tx, HEAD / 2 - 20, 40, 40);
    g.restore();
    tx += 52;
  }
  g.fillStyle = C.tealInk;
  g.font = `800 22px ${FONT}`;
  g.textBaseline = 'middle';
  g.fillText(`${o.heroName} - ${build.name}`, tx, HEAD / 2 + 1);
  g.textBaseline = 'alphabetic';

  // parchment board
  const bx = EDGE,
    bw = W - EDGE - 8;
  let y = HEAD;
  roundRect(g, bx, y, bw, boardH, 4);
  g.fillStyle = C.board;
  g.fill();
  y += PAD;
  const rx = bx + PAD,
    rw = bw - PAD * 2;
  const rowFrame = (label: string, h: number, body: string, headBg: string, headInk: string) => {
    g.save();
    roundRect(g, rx, y, rw, h, 4);
    g.clip();
    g.fillStyle = body;
    g.fillRect(rx, y, rw, h);
    g.fillStyle = headBg;
    g.fillRect(rx, y, rw, ROW_HEAD);
    g.restore();
    g.fillStyle = headInk;
    g.font = `800 15px ${FONT}`;
    g.fillText(label, rx + 12, y + 19);
  };
  for (const p of phases) {
    const h = rowH(p.rows.length);
    rowFrame(p.label, h, C.rowBody, C.rowHead, C.rowHeadInk);
    p.rows.forEach((b, i) => {
      const x = rx + 8 + (i % COLS) * (TILE + GAP),
        ty = y + ROW_HEAD + 8 + Math.floor(i / COLS) * (TILE_H + GAP);
      const [art, flag, plate] = C.slot[b.item.item_slot_type] ?? C.slot.weapon;
      g.save();
      roundRect(g, x, ty, TILE, TILE_H, 4);
      g.clip();
      g.fillStyle = art;
      g.fillRect(x, ty, TILE, TILE);
      g.fillStyle = plate;
      g.fillRect(x, ty + TILE, TILE, TILE_H - TILE);
      const im = tileImgs.get(b.item.id);
      if (im) {
        g.drawImage(im, x, ty, TILE, TILE);
      }
      g.fillStyle = flag;
      g.beginPath();
      g.moveTo(x + TILE - 28, ty);
      g.lineTo(x + TILE, ty);
      g.lineTo(x + TILE, ty + 28);
      g.closePath();
      g.fill();
      g.fillStyle = C.ink;
      g.font = `900 10px ${FONT}`;
      const rn = ROMAN[b.item.item_tier] ?? String(b.item.item_tier);
      g.fillText(rn, x + TILE - 3 - g.measureText(rn).width, ty + 11);
      g.textAlign = 'center';
      if (b.item.is_active_item) {
        g.fillStyle = '#2d2418';
        roundRect(g, x + TILE / 2 - 24, ty + TILE - 12, 48, 16, 4);
        g.fill();
        g.fillStyle = '#f2e7cf';
        g.font = `900 9px ${FONT}`;
        g.fillText('ACTIVE', x + TILE / 2, ty + TILE - 2);
      }
      g.fillStyle = C.ink;
      g.font = `800 11px ${FONT}`;
      const lines = wrap(g, b.item.name, TILE - 6).slice(0, 2);
      lines.forEach((l, j) => g.fillText(l, x + TILE / 2, ty + TILE + (lines.length === 1 ? 21 : 14 + j * 12)));
      g.textAlign = 'left';
      g.restore();
    });
    y += h + 8;
  }

  // ability order: one row per ability, one column per point spent, chip markers (same grid as the screen)
  rowFrame('Ability Order', apH, C.navy, C.navyTrack, C.navyInk);
  const n = build.abilityOrder.length,
    gx = rx + 8,
    gy = y + ROW_HEAD + 8,
    colW = (rw - 16 - AB) / n;
  abilities.forEach((a, r) => {
    const ry = gy + r * AP_ROW;
    g.fillStyle = r % 2 ? C.navy : C.navyTrack;
    g.fillRect(gx, ry, rw - 16, AP_ROW);
    const im = abImgs.get(a.id);
    if (im) {
      roundRect(g, gx + 2, ry + 2, AB - 4, AP_ROW - 4, 4);
      g.fillStyle = C.iconBg;
      g.fill();
      g.filter = 'brightness(0)';
      g.drawImage(im, gx + 2, ry + 2, AB - 4, AP_ROW - 4);
      g.filter = 'none';
    }
  });
  build.abilityOrder.forEach((s) => {
    const r = abilities.findIndex((a) => a.id === s.ability.id),
      cx = gx + AB + (s.index + 0.5) * colW,
      cy = gy + r * AP_ROW + AP_ROW / 2,
      unlock = s.kind === 'unlock',
      cw = Math.min(colW - 2, unlock ? 28 : 34);
    roundRect(g, cx - cw / 2, cy - 11, cw, 22, 4);
    g.fillStyle = C.room;
    g.fill();
    // point glyph: rounded diamond with a bolt cut out, same shape as the screen's PointGlyph (12-unit box)
    const u = (unlock ? 14 : 12) / 12,
      dx = unlock ? cx : cx - 5,
      sz = 6 * u,
      P = (px: number, py: number): [number, number] => [dx + (px - 6) * u, cy + (py - 6) * u];
    g.fillStyle = g.strokeStyle = unlock ? C.unlock : C.glyph;
    g.lineWidth = 1.5 * u;
    g.lineJoin = 'round';
    g.beginPath();
    [P(6, 1), P(11, 6), P(6, 11), P(1, 6)].forEach(([x, y2], i) => (i ? g.lineTo(x, y2) : g.moveTo(x, y2)));
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = C.room;
    g.beginPath();
    [P(7, 2.4), P(3.6, 6.7), P(5.6, 6.7), P(5, 9.6), P(8.4, 5.3), P(6.4, 5.3)].forEach(([x, y2], i) => (i ? g.lineTo(x, y2) : g.moveTo(x, y2)));
    g.closePath();
    g.fill();
    if (s.kind !== 'unlock') {
      g.fillStyle = C.navyInk;
      g.font = `800 12px ${FONT}`;
      g.textBaseline = 'middle';
      g.fillText(TIER_COST[s.kind], dx + sz + 3, cy + 1);
      g.textBaseline = 'alphabetic';
    }
  });
  return new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('PNG encode failed'))), 'image/png'));
}
