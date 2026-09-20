import type { Layout, PageKey, PageState, SizeSpec } from '../types';
import type { SheetRotation } from './draw';

// All geometry here is millimetres in reading space — the page as the user
// holds it. Nothing here knows about screens or CSS; the editor scales it and
// the PDF exporter prints it, so what you drag is what you print.

export type RingEdge = 'left' | 'right' | 'top' | 'bottom';

export interface Rect { x: number; y: number; w: number; h: number }

export type DividerKey = 'span' | 'a' | 'b' | 'c';

export interface Divider {
  id: string;
  page: PageKey;
  key: DividerKey;
  axis: 'h' | 'v';
  x: number; y: number; length: number;
  ratio: number;
  // The extent the ratio is a fraction of, so a drag converts back to a ratio.
  extentMm: number;
}

export interface PageGeometry {
  key: PageKey;
  widthMm: number;
  heightMm: number;
  sheet: { widthMm: number; heightMm: number; rotation: SheetRotation };
  ringEdge: RingEdge;
  ringBand: Rect;
  holes: { cx: number; cy: number; r: number }[];
  spanRect: Rect | null;
  // One rect per placed part, in `placed` order.
  regions: Rect[];
  dividers: Divider[];
}

export interface Geometry {
  pages: PageGeometry[];
  landscape: boolean;
  flow: 'row' | 'column';
}

const HOLE_COUNT = 6;
const EVEN = 0.5;
export const MIN_RATIO = 0.18;
export const MAX_RATIO = 0.82;

// Landscape is the planner turned a quarter turn. It never transposes a
// calendar grid — only the page shape and the ring edge change.
export function isLandscape(layout: Layout): boolean {
  if (layout.spread) return layout.spanning?.pattern === 2;
  return layout.pages.single.placed.includes('monthly') && layout.monthlyOrientation === 'landscape';
}

function ringEdgeFor(spread: boolean, landscape: boolean, key: PageKey): RingEdge {
  // A single sheet binds on its outer edge. In a spread the binding is always
  // the seam between the two pages, whichever way the pages sit.
  if (!spread) return landscape ? 'top' : 'left';
  if (landscape) return key === 'left' ? 'bottom' : 'top';
  return key === 'left' ? 'right' : 'left';
}

function splitRegions(count: number, ratios: PageState['ratios'], w: number, h: number): Rect[] {
  const a = ratios.a ?? EVEN, b = ratios.b ?? EVEN, c = ratios.c ?? EVEN;
  if (count <= 0) return [];
  // One part owns the whole area. Space is only carved up once something else
  // actually joins it — never reserved in advance.
  if (count === 1) return [{ x: 0, y: 0, w, h }];
  if (count === 2) {
    const top = h * a;
    return [{ x: 0, y: 0, w, h: top }, { x: 0, y: top, w, h: h - top }];
  }
  if (count === 3) {
    const top = h * a, bottom = h - top, left = w * b;
    return [
      { x: 0, y: 0, w, h: top },
      { x: 0, y: top, w: left, h: bottom },
      { x: left, y: top, w: w - left, h: bottom },
    ];
  }
  const row1 = h * a, row2 = h - row1, w1 = w * b, w2 = w * c;
  return [
    { x: 0, y: 0, w: w1, h: row1 },
    { x: w1, y: 0, w: w - w1, h: row1 },
    { x: 0, y: row1, w: w2, h: row2 },
    { x: w2, y: row1, w: w - w2, h: row2 },
  ];
}

function splitDividers(
  count: number, ratios: PageState['ratios'],
  w: number, h: number, page: PageKey, ox: number, oy: number,
): Divider[] {
  const a = ratios.a ?? EVEN, b = ratios.b ?? EVEN, c = ratios.c ?? EVEN;
  const out: Divider[] = [];
  if (count === 2 || count === 3 || count === 4) {
    out.push({ id: `${page}-a`, page, key: 'a', axis: 'h', x: ox, y: oy + h * a, length: w, ratio: a, extentMm: h });
  }
  if (count === 3) {
    out.push({ id: `${page}-b`, page, key: 'b', axis: 'v', x: ox + w * b, y: oy + h * a, length: h - h * a, ratio: b, extentMm: w });
  }
  if (count === 4) {
    const row1 = h * a;
    out.push({ id: `${page}-b`, page, key: 'b', axis: 'v', x: ox + w * b, y: oy, length: row1, ratio: b, extentMm: w });
    out.push({ id: `${page}-c`, page, key: 'c', axis: 'v', x: ox + w * c, y: oy + row1, length: h - row1, ratio: c, extentMm: w });
  }
  return out;
}

function buildPage(
  layout: Layout, key: PageKey,
  W: number, H: number, ring: number,
  sheet: PageGeometry['sheet'], landscape: boolean,
): PageGeometry {
  const edge = ringEdgeFor(layout.spread, landscape, key);
  const vertical = edge === 'left' || edge === 'right';

  const ringBand: Rect = vertical
    ? { x: edge === 'left' ? 0 : W - ring, y: 0, w: ring, h: H }
    : { x: 0, y: edge === 'top' ? 0 : H - ring, w: W, h: ring };

  const ox = edge === 'left' ? ring : 0;
  const oy = edge === 'top' ? ring : 0;
  const usableW = vertical ? W - ring : W;
  const usableH = vertical ? H : H - ring;

  const span = layout.spanning;
  const bandH = span ? usableH * span.ratio : 0;
  const spanRect = span ? { x: ox, y: oy, w: usableW, h: bandH } : null;

  const contentY = oy + bandH;
  const contentH = usableH - bandH;

  const state = layout.pages[key];
  const regions = splitRegions(state.placed.length, state.ratios, usableW, contentH)
    .map(r => ({ x: r.x + ox, y: r.y + contentY, w: r.w, h: r.h }));

  const holes: PageGeometry['holes'] = [];
  const step = (vertical ? H : W) / (HOLE_COUNT + 1);
  const across = vertical ? ringBand.x + ring / 2 : ringBand.y + ring / 2;
  for (let i = 1; i <= HOLE_COUNT; i++) {
    const along = step * i;
    holes.push({
      cx: vertical ? across : along,
      cy: vertical ? along : across,
      r: Math.min(1.8, ring / 4),
    });
  }

  const dividers: Divider[] = [];
  if (span && state.placed.length > 0) {
    dividers.push({
      id: `${key}-span`, page: key, key: 'span', axis: 'h',
      x: ox, y: oy + bandH, length: usableW, ratio: span.ratio, extentMm: usableH,
    });
  }
  dividers.push(...splitDividers(state.placed.length, state.ratios, usableW, contentH, key, ox, contentY));

  return { key, widthMm: W, heightMm: H, sheet, ringEdge: edge, ringBand, holes, spanRect, regions, dividers };
}

export function buildGeometry(layout: Layout, size: SizeSpec): Geometry {
  const landscape = isLandscape(layout);
  const W = landscape ? size.heightMm : size.widthMm;
  const H = landscape ? size.widthMm : size.heightMm;
  const sheet = {
    widthMm: size.widthMm,
    heightMm: size.heightMm,
    rotation: (landscape ? 90 : 0) as SheetRotation,
  };

  const keys: PageKey[] = layout.spread ? ['left', 'right'] : ['single'];
  const pages = keys.map(key => buildPage(layout, key, W, H, size.ringMarginMm, sheet, landscape));

  // A landscape spread is the booklet rotated, so its pages stack instead of
  // sitting side by side.
  return { pages, landscape, flow: layout.spread && landscape ? 'column' : 'row' };
}
