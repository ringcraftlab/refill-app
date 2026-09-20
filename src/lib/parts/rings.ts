import type { SizeSpec } from '../../types';
import type { Primitive } from '../draw';
import { GRAY } from '../draw';

// Approximate 6-ring positions (system-planner style). MVP numbers only —
// firm values belong in a per-size spec table in the detailed design phase.
export function ringGuides(size: SizeSpec, side: 'left' | 'right'): Primitive[] {
  const holeCount = size.id === 'A5' ? 6 : 6;
  const guides: Primitive[] = [];
  const margin = size.ringMarginMm;
  const bandX = side === 'right' ? 0 : size.widthMm - margin;
  const bandW = margin;
  // Gray band showing the ring zone
  guides.push({
    type: 'rect', x: bandX, y: 0, w: bandW, h: size.heightMm,
    fill: [0.94, 0.94, 0.94],
  });
  // Punch-hole dots evenly spaced vertically, centered in the band
  const cx = bandX + bandW / 2;
  const step = size.heightMm / (holeCount + 1);
  const dotR = 1.8;
  for (let i = 1; i <= holeCount; i++) {
    const cy = step * i;
    guides.push({
      type: 'rect', x: cx - dotR, y: cy - dotR, w: dotR * 2, h: dotR * 2,
      fill: GRAY,
    });
  }
  return guides;
}
