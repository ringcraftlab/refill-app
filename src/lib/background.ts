import type { Background, BackgroundKind } from '../types';
import type { Color, Primitive } from './draw';

// 紙の地。パーツの下に敷かれ、いちばん先に描かれる。
//
// 画面のSVGとPDFが同じ配列を描くので、ここも mm 座標の図形を返すだけの
// 純関数でいい。Reactも面付けも知らない。

export const BACKGROUND_KINDS: BackgroundKind[] = ['none', 'tint', 'grid', 'dot', 'lines', 'image'];

// 選べる色。カラーピッカーにしないのは、紙に刷るものだからで、濃い色を
// 選べるようにしても実際にはインクを食うだけで使われない。どれも薄い。
export const BACKGROUND_COLORS = ['#F2EDE2', '#EDEFE8', '#E9EDF1', '#F3EAEA', '#EDE9F0'];

export const DEFAULT_BACKGROUND: Background = { kind: 'none' };
// 地紋の線の間隔。方眼は5mm、罫線は6mm——パーツの方眼・罫線と同じ。
const GRID_MM = 5;
const LINES_MM = 6;
const DOT_MM = 5;

const hex = (s: string): Color => {
  const n = parseInt(s.replace('#', ''), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
};

// 地紋の線は、選んだ色そのままだと面の上では強すぎる。紙の白に寄せて
// 薄くしたものを線に使う。
const fade = (c: Color, k: number): Color => c.map(v => v + (1 - v) * (1 - k)) as Color;

export interface BackRect { x: number; y: number; w: number; h: number }

export function drawBackground(bg: Background | undefined, page: BackRect): Primitive[] {
  if (!bg || bg.kind === 'none') return [];
  const color = hex(bg.color ?? BACKGROUND_COLORS[0]);
  const alpha = bg.opacity ?? 1;

  if (bg.kind === 'image') {
    if (!bg.src) return [];
    return [{ type: 'image', ...page, src: bg.src, opacity: alpha, fit: 'cover' }];
  }
  if (bg.kind === 'tint') {
    return [{ type: 'rect', ...page, fill: fade(color, alpha) }];
  }

  const line = fade(color, alpha);
  const out: Primitive[] = [];
  const { x, y, w, h } = page;
  if (bg.kind === 'dot') {
    for (let gx = x + DOT_MM; gx < x + w; gx += DOT_MM) {
      for (let gy = y + DOT_MM; gy < y + h; gy += DOT_MM) {
        out.push({ type: 'circle', cx: gx, cy: gy, r: 0.25, fill: line });
      }
    }
    return out;
  }
  const step = bg.kind === 'grid' ? GRID_MM : LINES_MM;
  for (let gy = y + step; gy < y + h; gy += step) {
    out.push({ type: 'line', x1: x, y1: gy, x2: x + w, y2: gy, stroke: line, strokeMm: 0.12 });
  }
  if (bg.kind === 'grid') {
    for (let gx = x + step; gx < x + w; gx += step) {
      out.push({ type: 'line', x1: gx, y1: y, x2: gx, y2: y + h, stroke: line, strokeMm: 0.12 });
    }
  }
  return out;
}
