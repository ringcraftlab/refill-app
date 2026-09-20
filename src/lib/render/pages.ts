import type { Layout, SizeSpec } from '../../types';
import type { Page, Primitive } from '../draw';
import { RING_BAND, RING_HOLE } from '../draw';
import { buildGeometry } from '../layout';
import { drawPart, drawSpanningMonthly } from '../parts';

// Turns the editor's layout into printable pages. The on-screen preview and
// the PDF both consume these, so what you arrange is what comes out.
export function buildPages(layout: Layout, size: SizeSpec): Page[] {
  return buildGeometry(layout, size).pages.map(pg => {
    const primitives: Primitive[] = [];
    if (pg.spanRect) primitives.push(...drawSpanningMonthly(pg.spanRect, pg.key, layout));
    layout.pages[pg.key].placed.forEach((kind, i) => {
      const rect = pg.regions[i];
      if (rect) primitives.push(...drawPart(kind, rect, layout));
    });

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
