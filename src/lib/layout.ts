import type { Layout, PageKey, SizeSpec, Surface } from '../types';
import type { SheetRotation } from './draw';
import { monthGrid } from './dates';

// All geometry here is millimetres. Nothing knows about screens or CSS; the
// editor scales it and the PDF exporter prints it, so what you drag is what
// you print.
//
// Two coordinate spaces matter:
//   page space    — one physical sheet as the user reads it
//   surface space — the area left over once the calendar has its band, with a
//                   spread's two halves laid end to end. A region that crosses
//                   the halfway mark spans the gutter; one that does not sits
//                   on a single page.

export type RingEdge = 'left' | 'right' | 'top' | 'bottom';

export interface Rect { x: number; y: number; w: number; h: number }

export type DividerKey = 'span' | 'a' | 'b' | 'c';

export interface Divider {
  id: string;
  key: DividerKey;
  axis: 'h' | 'v';
  x: number; y: number; length: number;
  ratio: number;
  // The extent the ratio is a fraction of, so a drag converts back to a ratio.
  extentMm: number;
}

// Where a page's slice of the surface sits, in both spaces.
export interface SurfaceSlice {
  key: PageKey;
  fromMm: number;
  toMm: number;
  // Page-space position of this slice's top-left corner.
  ox: number;
  oy: number;
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
  // The calendar band's lower edge, draggable in page space.
  spanDivider: Divider | null;
}

export interface Geometry {
  pages: PageGeometry[];
  landscape: boolean;
  flow: 'row' | 'column';
  surface: {
    widthMm: number;
    heightMm: number;
    slices: SurfaceSlice[];
    // One rect per placed part, in surface space.
    regions: Rect[];
    dividers: Divider[];
  };
}

const HOLE_COUNT = 6;
const EVEN = 0.5;
export const MIN_RATIO = 0.18;
export const MAX_RATIO = 0.82;

// The calendar's weekday header. It lives here because the spread geometry has
// to reserve it on both pages to keep the week rows the same height.
export const MONTHLY_HEADER_MM = 3.8;

// A landscape spread puts the fuller half first: five weeks go three and two,
// and the shorter page's leftover becomes writing space.
export function weekSplit(totalRows: number): [number, number] {
  const top = Math.ceil(totalRows / 2);
  return [top, totalRows - top];
}

// Landscape is the planner turned a quarter turn. It never transposes a
// calendar grid — only the page shape and the ring edge change.
export function isLandscape(layout: Layout): boolean {
  if (layout.spread) return layout.spanning?.pattern === 2;
  return layout.surface.placed.includes('monthly') && layout.monthlyOrientation === 'landscape';
}

function ringEdgeFor(spread: boolean, landscape: boolean, key: PageKey): RingEdge {
  // A single sheet binds on its outer edge. In a spread the binding is always
  // the seam between the two pages, whichever way the pages sit.
  if (!spread) return landscape ? 'top' : 'left';
  if (landscape) return key === 'left' ? 'bottom' : 'top';
  return key === 'left' ? 'right' : 'left';
}

function splitRegions(count: number, s: Surface, w: number, h: number): Rect[] {
  const a = s.ratios.a ?? EVEN, b = s.ratios.b ?? EVEN, c = s.ratios.c ?? EVEN;
  if (count <= 0) return [];
  // One part owns the whole surface. Space is only carved up once something
  // else actually joins it — never reserved in advance.
  if (count === 1) return [{ x: 0, y: 0, w, h }];
  if (count === 2) {
    if (s.split === 'v') {
      const left = w * a;
      return [{ x: 0, y: 0, w: left, h }, { x: left, y: 0, w: w - left, h }];
    }
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

function surfaceDividers(count: number, s: Surface, w: number, h: number): Divider[] {
  const a = s.ratios.a ?? EVEN, b = s.ratios.b ?? EVEN, c = s.ratios.c ?? EVEN;
  const out: Divider[] = [];
  if (count === 2) {
    out.push(s.split === 'v'
      ? { id: 'a', key: 'a', axis: 'v', x: w * a, y: 0, length: h, ratio: a, extentMm: w }
      : { id: 'a', key: 'a', axis: 'h', x: 0, y: h * a, length: w, ratio: a, extentMm: h });
  }
  if (count === 3) {
    out.push({ id: 'a', key: 'a', axis: 'h', x: 0, y: h * a, length: w, ratio: a, extentMm: h });
    out.push({ id: 'b', key: 'b', axis: 'v', x: w * b, y: h * a, length: h - h * a, ratio: b, extentMm: w });
  }
  if (count === 4) {
    const row1 = h * a;
    out.push({ id: 'a', key: 'a', axis: 'h', x: 0, y: row1, length: w, ratio: a, extentMm: h });
    out.push({ id: 'b', key: 'b', axis: 'v', x: w * b, y: 0, length: row1, ratio: b, extentMm: w });
    out.push({ id: 'c', key: 'c', axis: 'v', x: w * c, y: row1, length: h - row1, ratio: c, extentMm: w });
  }
  return out;
}

interface PageBox {
  edge: RingEdge;
  ringBand: Rect;
  ox: number; oy: number;
  usableW: number; usableH: number;
}

function pageBox(spread: boolean, landscape: boolean, key: PageKey, W: number, H: number, ring: number): PageBox {
  const edge = ringEdgeFor(spread, landscape, key);
  const vertical = edge === 'left' || edge === 'right';
  return {
    edge,
    ringBand: vertical
      ? { x: edge === 'left' ? 0 : W - ring, y: 0, w: ring, h: H }
      : { x: 0, y: edge === 'top' ? 0 : H - ring, w: W, h: ring },
    ox: edge === 'left' ? ring : 0,
    oy: edge === 'top' ? ring : 0,
    usableW: vertical ? W - ring : W,
    usableH: vertical ? H : H - ring,
  };
}

function punchHoles(box: PageBox, W: number, H: number, ring: number) {
  const vertical = box.edge === 'left' || box.edge === 'right';
  const step = (vertical ? H : W) / (HOLE_COUNT + 1);
  const across = vertical ? box.ringBand.x + ring / 2 : box.ringBand.y + ring / 2;
  return Array.from({ length: HOLE_COUNT }, (_, i) => {
    const along = step * (i + 1);
    return {
      cx: vertical ? across : along,
      cy: vertical ? along : across,
      r: Math.min(1.8, ring / 4),
    };
  });
}

export function buildGeometry(layout: Layout, size: SizeSpec): Geometry {
  const landscape = isLandscape(layout);
  const W = landscape ? size.heightMm : size.widthMm;
  const H = landscape ? size.widthMm : size.heightMm;
  const ring = size.ringMarginMm;
  const sheet = {
    widthMm: size.widthMm,
    heightMm: size.heightMm,
    rotation: (landscape ? 90 : 0) as SheetRotation,
  };

  const keys: PageKey[] = layout.spread ? ['left', 'right'] : ['single'];
  const boxes = keys.map(key => ({ key, box: pageBox(layout.spread, landscape, key, W, H, ring) }));
  const usableH = boxes[0].box.usableH;
  const usableW = boxes[0].box.usableW;

  // Band heights. A landscape spread gives its pages different week counts, so
  // the shorter page's band is shorter too and its rows stay the same height.
  const span = layout.spanning;
  const totalRows = monthGrid(layout.year, layout.month, layout.weekStart).length;
  const bandOf = (key: PageKey): number => {
    if (!span) return 0;
    const top = usableH * span.ratio;
    if (span.pattern !== 2) return top;
    const [topRows, bottomRows] = weekSplit(totalRows);
    const rowH = (top - MONTHLY_HEADER_MM) / topRows;
    return key === 'left' ? top : MONTHLY_HEADER_MM + rowH * bottomRows;
  };

  const pages: PageGeometry[] = boxes.map(({ key, box }) => {
    const bandH = bandOf(key);
    // Dragging either page's band edge moves the same ratio; on the shorter
    // page of a landscape spread a millimetre of drag is worth proportionally
    // more ratio, so its extent shrinks to match.
    const extent = span && span.ratio > 0 ? bandH / span.ratio : usableH;
    return {
      key,
      widthMm: W,
      heightMm: H,
      sheet,
      ringEdge: box.edge,
      ringBand: box.ringBand,
      holes: punchHoles(box, W, H, ring),
      spanRect: span ? { x: box.ox, y: box.oy, w: box.usableW, h: bandH } : null,
      spanDivider: span && layout.surface.placed.length > 0
        ? { id: `${key}-span`, key: 'span', axis: 'h', x: box.ox, y: box.oy + bandH, length: box.usableW, ratio: span.ratio, extentMm: extent }
        : null,
    };
  });

  // Pages whose band leaves room contribute a slice of the surface. In a
  // landscape spread the fuller page is filled by the calendar, so the surface
  // is only the shorter page's leftover.
  const slices: SurfaceSlice[] = [];
  let cursor = 0;
  boxes.forEach(({ key, box }) => {
    const leftover = box.usableH - bandOf(key);
    if (leftover <= 0.5) return;
    slices.push({ key, fromMm: cursor, toMm: cursor + box.usableW, ox: box.ox, oy: box.oy + bandOf(key) });
    cursor += box.usableW;
  });

  const surfaceW = cursor;
  const surfaceH = slices.length ? Math.min(...slices.map(s => {
    const box = boxes.find(b => b.key === s.key)!.box;
    return box.usableH - bandOf(s.key);
  })) : 0;

  const count = layout.surface.placed.length;
  return {
    pages,
    landscape,
    // A landscape spread is the booklet rotated, so its pages stack.
    flow: layout.spread && landscape ? 'column' : 'row',
    surface: {
      widthMm: surfaceW,
      heightMm: surfaceH,
      slices,
      regions: splitRegions(count, layout.surface, surfaceW, surfaceH),
      dividers: surfaceDividers(count, layout.surface, surfaceW, surfaceH),
    },
  };
}

// Which surface region a point in surface space falls in.
export function regionAt(regions: Rect[], x: number, y: number): number | null {
  for (let i = 0; i < regions.length; i++) {
    const r = regions[i];
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i;
  }
  return null;
}
