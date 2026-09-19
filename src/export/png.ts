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
  stepEdge: '#5b6485',
  navy: '#2b3d70',
  navyTrack: '#1a2a58',
  navyInk: '#e9edf8',
};
const ROMAN = ['', 'I', 'II', 'III', 'IV'];
const PHASES: { key: Phase; label: string }[] = [
  { key: 'early', label: 'Early Game' },
  { key: 'mid', label: 'Mid Game' },
  { key: 'late', label: 'Late Game' },
];
const TIER = { unlock: 0, tier1: 1, tier2: 2, tier3: 3 } as const;
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
  const STEP_W = 40,
    STEP_H = 48;
  const apH = ROW_HEAD + 8 + STEP_H + 8;
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

  // ability order: one icon per point spent, pips for the upgrade tier
  rowFrame('Ability Order', apH, C.navy, C.navyTrack, C.navyInk);
  build.abilityOrder.forEach((s, i) => {
    const x = rx + 8 + i * (STEP_W + 4),
      sy = y + ROW_HEAD + 8;
    roundRect(g, x, sy, STEP_W, STEP_H, 4);
    g.fillStyle = C.navyTrack;
    g.fill();
    g.lineWidth = s.kind === 'unlock' ? 2 : 1;
    g.strokeStyle = s.kind === 'unlock' ? C.unlock : C.stepEdge;
    g.stroke();
    const im = abImgs.get(s.ability.id);
    if (im) {
      g.filter = 'brightness(0) invert(1)';
      g.drawImage(im, x + 4, sy + 2, 32, 32);
      g.filter = 'none';
    }
    const n = TIER[s.kind];
    g.fillStyle = C.navyInk;
    for (let k = 0; k < n; k++) {
      const cx = x + STEP_W / 2 + (k - (n - 1) / 2) * 9,
        cy = sy + 40;
      g.beginPath();
      g.moveTo(cx, cy - 4);
      g.lineTo(cx + 4, cy);
      g.lineTo(cx, cy + 4);
      g.lineTo(cx - 4, cy);
      g.closePath();
      g.fill();
    }
  });
  return new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('PNG encode failed'))), 'image/png'));
}
