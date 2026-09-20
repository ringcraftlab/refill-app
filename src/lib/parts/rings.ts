import type { Primitive } from '../draw';
import { GRAY } from '../draw';

// Which edge of the reading-space page the binding runs along.
//   single portrait  -> 'left'   (rings at the side)
//   single landscape -> 'top'    (planner turned a quarter turn)
//   spread portrait  -> 'right' on the left page, 'left' on the right page
//   spread landscape -> 'bottom' on the top page, 'top' on the bottom page
// In every spread the two bands meet at the gutter between the pages.
export type RingEdge = 'left' | 'right' | 'top' | 'bottom';

const HOLE_COUNT = 6;
const HOLE_RADIUS_MM = 1.8;

// Non-printing guides marking the zone the rings occupy. Callers must keep
// content out of this band: nothing may sit under a punch hole.
export function ringGuides(edge: RingEdge, pageW: number, pageH: number, bandMm: number): Primitive[] {
  const vertical = edge === 'left' || edge === 'right';
  const band = vertical
    ? { x: edge === 'left' ? 0 : pageW - bandMm, y: 0, w: bandMm, h: pageH }
    : { x: 0, y: edge === 'top' ? 0 : pageH - bandMm, w: pageW, h: bandMm };

  const guides: Primitive[] = [
    { type: 'rect', ...band, fill: [0.94, 0.94, 0.94] },
  ];

  const span = vertical ? pageH : pageW;
  const step = span / (HOLE_COUNT + 1);
  const across = vertical ? band.x + bandMm / 2 : band.y + bandMm / 2;
  for (let i = 1; i <= HOLE_COUNT; i++) {
    const along = step * i;
    guides.push({
      type: 'circle',
      cx: vertical ? across : along,
      cy: vertical ? along : across,
      r: HOLE_RADIUS_MM,
      fill: GRAY,
    });
  }
  return guides;
}
