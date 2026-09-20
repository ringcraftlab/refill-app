import type { Layout, SizeSpec } from '../../types';
import type { Page, Primitive } from '../draw';
import { clipToBand, flattenToSheet, RING_BAND, RING_HOLE } from '../draw';
import { buildGeometry } from '../layout';
import { drawPart, drawSpanningMonthly } from '../parts';
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

export interface PrintOptions {
  // Off prints each refill on paper its own size, which most home printers
  // cannot feed.
  impose: boolean;
  copies: number;
  cutLines: boolean;
  scalePercent: number;
}

export const DEFAULT_PRINT: PrintOptions = {
  impose: true,
  copies: 1,
  cutLines: true,
  scalePercent: 100,
};

// The refills as they will print: flattened onto their punched sheets, then
// laid out on paper.
export function buildPrintSheets(layout: Layout, size: SizeSpec, opts: PrintOptions): SheetContent[] {
  const oneSet = buildPages(layout, size).map(p => ({
    widthMm: p.sheet.widthMm,
    heightMm: p.sheet.heightMm,
    primitives: flattenToSheet(p),
  }));

  // A spread needs one of each sheet per copy, so sets repeat rather than
  // sheets.
  const all = Array.from({ length: Math.max(1, opts.copies) }, () => oneSet).flat();
  if (!opts.impose) return all;

  return impose(all, {
    ...DEFAULT_IMPOSE,
    cutLines: opts.cutLines,
    scalePercent: opts.scalePercent,
  });
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

