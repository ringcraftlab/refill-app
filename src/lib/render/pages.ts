import type { Layout, PartKind, SizeSpec } from '../../types';
import type { Color, Page, Primitive } from '../draw';
import { clipToBand, flattenToSheet, RING_BAND, RING_HOLE } from '../draw';
import { buildGeometry } from '../layout';
import type { Rect, SurfaceSlice } from '../layout';
import { drawGrid, drawLines, drawMemo, drawPart, drawPartAcross, drawSpanningMonthly } from '../parts';
import { holeCentres } from '../sizes';
import { addMonths, isoDate, sheetStarts } from '../dates';
import { DEFAULT_IMPOSE, impose, planTiles } from './impose';
import type { SheetContent } from './impose';

// Turns the editor's layout into printable pages. The on-screen preview and
// the PDF both consume these, so what you arrange is what comes out.
export function buildPages(layout: Layout, size: SizeSpec, flipBinding = false): Page[] {
  const geo = buildGeometry(layout, size, flipBinding);

  return geo.pages.map(pg => {
    const primitives: Primitive[] = [];
    if (pg.spanRect) primitives.push(...drawSpanningMonthly(pg.spanRect, pg.key, layout));

    const slice = geo.surface.slices.find(s => s.key === pg.key);
    if (slice) {
      layout.surface.placed.forEach((kind, i) => {
        const region = geo.surface.regions[i];
        if (!region) return;
        // Draw across the part's whole region, then keep this page's piece.
        primitives.push(...clipToBand(
          drawnPart(kind, region, layout, geo.surface.slices),
          slice.fromMm, slice.toMm,
          slice.ox - slice.fromMm, slice.oy,
        ));
      });
    }

    return {
      widthMm: pg.widthMm,
      heightMm: pg.heightMm,
      primitives,
      guides: [
        { type: 'rect', ...pg.ringBand, fill: RING_BAND },
        ...pg.holes.map(h => ({ type: 'circle' as const, cx: h.cx, cy: h.cy, r: h.r, fill: RING_HOLE })),
      ],
      sheet: pg.sheet,
    };
  });
}

// A region that crosses the gutter covers two sheets. The part gets a say in
// how it breaks there, because trimming a calendar at the page edge would
// leave a day half on one sheet and half on the other.
function drawnPart(kind: PartKind, region: Rect, layout: Layout, slices: SurfaceSlice[]): Primitive[] {
  for (const s of slices) {
    const at = s.toMm;
    if (region.x < at - 0.5 && region.x + region.w > at + 0.5) {
      const across = drawPartAcross(
        kind,
        { ...region, w: at - region.x },
        { ...region, x: at, w: region.x + region.w - at },
        layout,
      );
      if (across) return across;
    }
  }
  return drawPart(kind, region, layout);
}

export type BackFill = 'blank' | 'grid' | 'lines' | 'memo';

export interface PrintOptions {
  // Off prints each refill on paper its own size, which most home printers
  // cannot feed.
  impose: boolean;
  copies: number;
  cutLines: boolean;
  scalePercent: number;
  duplex: boolean;
  // What goes on the faces the design does not use.
  backFill: BackFill;
  // Printed, unlike the editor's guides: you cannot punch what you cannot see.
  punchGuides: boolean;
}

export const DEFAULT_PRINT: PrintOptions = {
  impose: true,
  copies: 1,
  cutLines: true,
  scalePercent: 100,
  duplex: true,
  // A blank back is half the paper thrown away, and printed refills almost
  // always carry something on the reverse.
  backFill: 'grid',
  punchGuides: true,
};

// Which edge of a sheet carries the rings. Turning a sheet over puts them on
// the opposite edge, which is why a left page's binding sits on its right.
// Every size binds on a side of the sheet as it is described; a top-bound one
// would use the other pair.
type Side = 'left' | 'right' | 'top' | 'bottom';
const mirror = (s: Side): Side =>
  s === 'left' ? 'right' : s === 'right' ? 'left' : s === 'top' ? 'bottom' : 'top';

// The two edges a size can bind on. The paper never turns, whatever the
// layout does with the content, so this follows the size alone.
const bindingPair = (size: SizeSpec): [Side, Side] =>
  size.ringsOn === 'top' ? ['top', 'bottom'] : ['left', 'right'];

const PUNCH: Color = [0.78, 0.76, 0.72];

function punchGuide(size: SizeSpec, side: Side): Primitive[] {
  const vertical = side === 'left' || side === 'right';
  const r = size.ringMarginMm / 2;
  const across = side === 'left' ? r
    : side === 'right' ? size.widthMm - r
    : side === 'top' ? r
    : size.heightMm - r;
  return holeCentres(size.holes).map((along): Primitive => ({
    type: 'circle',
    cx: vertical ? across : along,
    cy: vertical ? along : across,
    r: size.holes.diameterMm / 2,
    stroke: PUNCH,
    strokeMm: 0.15,
  }));
}

function fillerFace(size: SizeSpec, fill: BackFill, side: Side): Primitive[] {
  if (fill === 'blank') return [];
  const m = 4;
  const ring = size.ringMarginMm;
  const left = side === 'left' ? ring : m;
  const top = side === 'top' ? ring : m;
  const right = size.widthMm - (side === 'right' ? ring : m);
  const bottom = size.heightMm - (side === 'bottom' ? ring : m);
  const area = { x: left, y: top, w: right - left, h: bottom - top };
  if (fill === 'grid') return drawGrid(area);
  if (fill === 'lines') return drawLines(area);
  return drawMemo(area);
}

interface Duplexed { front: SheetContent; back: SheetContent }
interface Face { primitives: Primitive[]; side: Side }

// Parts whose dates come from the run of days a sheet covers rather than from
// its month. One of these on the sheet makes the whole refill repeat by days.
const DAY_PACED: PartKind[] = ['weekvert', 'weekhoriz'];

export const isDayPaced = (layout: Layout): boolean =>
  layout.surface.placed.some(k => DAY_PACED.includes(k));

export const hasDatedPart = (layout: Layout): boolean =>
  !!layout.spanning || layout.surface.placed.includes('monthly') || isDayPaced(layout);

// How many sheets the run comes to, which is what the export has to warn
// about: a year of weeks is 52, a year of single days is 365.
export const sheetCount = (layout: Layout): number => {
  if (!hasDatedPart(layout)) return 1;
  return isDayPaced(layout) ? sheetStarts(layout).length : Math.max(1, layout.monthCount);
};

// Every sheet's dates, in order. A weekly paces the refill by days; everything
// else by months.
function sheetsOf(layout: Layout): Layout[] {
  if (!hasDatedPart(layout)) return [layout];
  if (isDayPaced(layout)) {
    return sheetStarts(layout).map(start => ({
      ...layout,
      // The month a sheet belongs to is the month it starts in, which is what
      // a calendar printed beside the week should show.
      year: start.getFullYear(),
      month: start.getMonth() + 1,
      sheetStart: isoDate(start),
    }));
  }
  return Array.from({ length: Math.max(1, layout.monthCount) },
    (_, i) => ({ ...layout, ...addMonths(layout.year, layout.month, i) }));
}

// Every printable face in binder order, sheet after sheet.
function facesInOrder(layout: Layout, size: SizeSpec, duplex: boolean): Face[] {
  const faces: Face[] = [];

  const [near, far] = bindingPair(size);
  for (const sheet of sheetsOf(layout)) {
    if (layout.spread) {
      // A spread is the back of one sheet facing the front of the next, so its
      // first page always lands on a back and its second on a front.
      const pages = buildPages(sheet, size);
      faces.push({ primitives: flattenToSheet(pages[0]), side: far });
      faces.push({ primitives: flattenToSheet(pages[1]), side: near });
    } else {
      // Single pages run front, back, front, back down the stack, and a page
      // on a back binds on the other edge.
      const onBack = duplex && faces.length % 2 === 1;
      const page = buildPages(sheet, size, onBack)[0];
      faces.push({ primitives: flattenToSheet(page), side: onBack ? far : near });
    }
  }
  return faces;
}

// The refills as they will print: every month in the range, flattened onto
// their punched sheets, chained front to back, then laid out on paper.
export function buildPrintSheets(layout: Layout, size: SizeSpec, opts: PrintOptions): SheetContent[] {
  const faces = facesInOrder(layout, size, opts.duplex);
  const spec = { ...DEFAULT_IMPOSE, cutLines: opts.cutLines, scalePercent: opts.scalePercent };

  const asSheet = (f: Face): SheetContent => ({
    widthMm: size.widthMm,
    heightMm: size.heightMm,
    primitives: opts.punchGuides ? [...punchGuide(size, f.side), ...f.primitives] : f.primitives,
  });
  const spare = (side: Side) => asSheet({ primitives: fillerFace(size, opts.backFill, side), side });

  const sheets: Duplexed[] = [];
  const [near, far] = bindingPair(size);
  if (opts.duplex) {
    let i = 0;
    // A spread begins on a back, so only the very first front is spare.
    if (layout.spread) sheets.push({ front: spare(near), back: asSheet(faces[i++]) });
    while (i < faces.length) {
      const front = asSheet(faces[i++]);
      sheets.push({ front, back: i < faces.length ? asSheet(faces[i++]) : spare(far) });
    }
  } else {
    faces.forEach(f => sheets.push({ front: asSheet(f), back: spare(mirror(f.side)) }));
  }

  const all = Array.from({ length: Math.max(1, opts.copies) }, () => sheets).flat();

  if (!opts.impose) {
    return opts.duplex ? all.flatMap(s => [s.front, s.back]) : all.map(s => s.front);
  }

  const fronts = impose(all.map(s => s.front), spec);
  if (!opts.duplex) return fronts;

  const backs = impose(all.map(s => s.back), spec, true);
  // Interleaved, so a duplex printer lands each back behind its own front.
  return fronts.flatMap((f, i) => (backs[i] ? [f, backs[i]] : [f]));
}

// How the refills will sit on the paper, for telling the user before they
// print: how many to a sheet, and how close to the paper's edge they come.
export const paperPlan = (size: SizeSpec) =>
  planTiles({ widthMm: size.widthMm, heightMm: size.heightMm }, DEFAULT_IMPOSE);

export const perPaperCount = (size: SizeSpec): number => paperPlan(size).perPage;

// The nearest ink gets to the edge of a refill, which is what decides whether
// a printer's unprintable border eats any of it. Measured, not assumed: the
// content sits OUTER_MM in with each part's own PAD on top of that, and the
// punch guide is a circle whose outer rim comes nearer still. Only the edges
// with no clearance are at risk, so the caller pairs this with the plan.
export const INK_INSET_MM = 4.2;
export const punchInset = (size: SizeSpec): number =>
  size.ringMarginMm / 2 - size.holes.diameterMm / 2;

