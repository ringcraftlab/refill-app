import type { Layout, SizeSpec } from '../../types';
import type { Color, Page, Primitive } from '../draw';
import { clipToBand, flattenToSheet, RING_BAND, RING_HOLE } from '../draw';
import { buildGeometry } from '../layout';
import { drawGrid, drawLines, drawMemo, drawPart, drawSpanningMonthly } from '../parts';
import { holeCentres } from '../sizes';
import { addMonths } from '../dates';
import { DEFAULT_IMPOSE, impose, tilesPerPage } from './impose';
import type { SheetContent } from './impose';

// Turns the editor's layout into printable pages. The on-screen preview and
// the PDF both consume these, so what you arrange is what comes out.
export function buildPages(layout: Layout, size: SizeSpec): Page[] {
  const geo = buildGeometry(layout, size);

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
          drawPart(kind, region, layout),
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

function sheetsForMonth(layout: Layout, size: SizeSpec, opts: PrintOptions): Duplexed[] {
  const designed = buildPages(layout, size).map(p => flattenToSheet(p));
  // A spread's left page binds on its right, because it is the back of a sheet.
  const sideOf = (i: number): Side => (layout.spread && i === 0 ? 'right' : 'left');

  const face = (primitives: Primitive[], side: Side): SheetContent => ({
    widthMm: size.widthMm,
    heightMm: size.heightMm,
    primitives: opts.punchGuides ? [...punchGuide(size, side), ...primitives] : primitives,
  });

  // One entry per physical sheet. A spread lives on two of them: its left page
  // is the back of one and its right page the front of the next, which is how
  // they come to face each other once the sheets are bound.
  if (!opts.duplex) {
    return designed.map((d, i) => ({
      front: face(d, sideOf(i)),
      back: face([], mirror(sideOf(i))),
    }));
  }
  if (designed.length === 2) {
    return [
      { front: face(fillerFace(size, opts.backFill, 'left'), 'left'), back: face(designed[0], 'right') },
      { front: face(designed[1], 'left'), back: face(fillerFace(size, opts.backFill, 'right'), 'right') },
    ];
  }
  return [{
    front: face(designed[0], 'left'),
    back: face(fillerFace(size, opts.backFill, 'right'), 'right'),
  }];
}

export const hasDatedPart = (layout: Layout): boolean =>
  !!layout.spanning || layout.surface.placed.includes('monthly');

// The refills as they will print: every month in the range, flattened onto
// their punched sheets, paired front to back, then laid out on paper.
export function buildPrintSheets(layout: Layout, size: SizeSpec, opts: PrintOptions): SheetContent[] {
  const months = hasDatedPart(layout) ? Math.max(1, layout.monthCount) : 1;

  const sheets: Duplexed[] = [];
  for (let i = 0; i < months; i++) {
    const at = addMonths(layout.year, layout.month, i);
    sheets.push(...sheetsForMonth({ ...layout, ...at }, size, opts));
  }

  const all = Array.from({ length: Math.max(1, opts.copies) }, () => sheets).flat();

  if (!opts.impose) {
    return opts.duplex ? all.flatMap(s => [s.front, s.back]) : all.map(s => s.front);
  }

  const spec = { ...DEFAULT_IMPOSE, cutLines: opts.cutLines, scalePercent: opts.scalePercent };
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

