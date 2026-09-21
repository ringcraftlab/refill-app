import type { Layout, PartKind, SizeSpec } from '../../types';
import type { Color, Page, Primitive } from '../draw';
import { clipToBand, flattenToSheet, RING_BAND, RING_HOLE } from '../draw';
import { buildGeometry } from '../layout';
import type { Rect, SurfaceSlice } from '../layout';
import { drawGrid, drawLines, drawMemo, drawPart, drawPartAcross, drawSpanningMonthly } from '../parts';
import { holeCentres } from '../sizes';
import { addMonths } from '../dates';
import { DEFAULT_IMPOSE, impose, tilesPerPage } from './impose';
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

// Which edge of a face carries the rings. Turning a sheet over puts them on
// the other side, which is why a left page's binding sits on its right.
type Side = 'left' | 'right';
const mirror = (s: Side): Side => (s === 'left' ? 'right' : 'left');

const PUNCH: Color = [0.78, 0.76, 0.72];

function punchGuide(size: SizeSpec, side: Side): Primitive[] {
  const cx = side === 'left' ? size.ringMarginMm / 2 : size.widthMm - size.ringMarginMm / 2;
  return holeCentres(size.holes).map((cy): Primitive => ({
    type: 'circle', cx, cy, r: size.holes.diameterMm / 2, stroke: PUNCH, strokeMm: 0.15,
  }));
}

function fillerFace(size: SizeSpec, fill: BackFill, side: Side): Primitive[] {
  if (fill === 'blank') return [];
  const m = 4;
  const area = {
    x: side === 'left' ? size.ringMarginMm : m,
    y: m,
    w: size.widthMm - size.ringMarginMm - m,
    h: size.heightMm - m * 2,
  };
  if (fill === 'grid') return drawGrid(area);
  if (fill === 'lines') return drawLines(area);
  return drawMemo(area);
}

interface Duplexed { front: SheetContent; back: SheetContent }
interface Face { primitives: Primitive[]; side: Side }

export const hasDatedPart = (layout: Layout): boolean =>
  !!layout.spanning || layout.surface.placed.includes('monthly');

// Every printable face in binder order, month after month.
function facesInOrder(layout: Layout, size: SizeSpec, duplex: boolean): Face[] {
  const months = hasDatedPart(layout) ? Math.max(1, layout.monthCount) : 1;
  const faces: Face[] = [];

  for (let i = 0; i < months; i++) {
    const monthly = { ...layout, ...addMonths(layout.year, layout.month, i) };
    if (layout.spread) {
      // A spread is the back of one sheet facing the front of the next, so its
      // left page always lands on a back and its right page on a front.
      const pages = buildPages(monthly, size);
      faces.push({ primitives: flattenToSheet(pages[0]), side: 'right' });
      faces.push({ primitives: flattenToSheet(pages[1]), side: 'left' });
    } else {
      // Single pages run front, back, front, back down the stack, and a page
      // on a back binds on the other side.
      const onBack = duplex && faces.length % 2 === 1;
      const page = buildPages(monthly, size, onBack)[0];
      faces.push({ primitives: flattenToSheet(page), side: onBack ? 'right' : 'left' });
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
  if (opts.duplex) {
    let i = 0;
    // A spread begins on a back, so only the very first front is spare.
    if (layout.spread) sheets.push({ front: spare('left'), back: asSheet(faces[i++]) });
    while (i < faces.length) {
      const front = asSheet(faces[i++]);
      sheets.push({ front, back: i < faces.length ? asSheet(faces[i++]) : spare('right') });
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

// How many refills fit on one sheet of paper, for telling the user before they
// print.
export function perPaperCount(size: SizeSpec): number {
  const { cols, rows } = tilesPerPage(
    { widthMm: size.widthMm, heightMm: size.heightMm, primitives: [] },
    DEFAULT_IMPOSE,
  );
  return cols * rows;
}

