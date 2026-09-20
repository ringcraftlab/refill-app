import type { Layout, SizeSpec } from '../../types';
import type { Page, Primitive } from '../draw';
import { clipToBand, RING_BAND, RING_HOLE } from '../draw';
import { buildGeometry } from '../layout';
import { drawPart, drawSpanningMonthly } from '../parts';

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
