import type { HoleSpec, RefillSize, SizeSpec } from '../types';

// Punch patterns taken from a refill dimension sheet. The 19mm pitch is the
// worldwide standard and is the same on every six-ring size; the small
// three-hole binders are the exception and carry their own pitch. Otherwise
// only the hole count, the middle gap and the end margin change. Each pattern adds up to its paper
// height exactly, which is the check to redo if a number ever moves:
//   A5      32×2 + 19×4 + 70 = 210
//   A5 slim 32×2 + 19×4 + 70 = 210   (A5's punch on a narrower sheet)
//   Bible   21.5×2 + 19×4 + 51 = 170
//   Narrow  21.5×2 + 19×4 + 51 = 170   (same height, same punch)
//   Mini 6  16.5×2 + 19×5 = 128        (one even run, no middle gap)
//   Micro 5 14.5×2 + 19×4 = 105        (five holes, not six)
//   M5 sq   14.5×2 + 19×4 = 105        (Micro 5's punch on a square sheet)
//   Card 3  8.5×2 + 19×2 = 55          (three holes, on the 55mm edge)
//   Mini 3  11.5×2 + 28.5×2 = 80        (three holes at a wider pitch)
//
// Hole diameter is measured, not derived: the ring wire gets thinner as the
// binder gets smaller, so the small sizes punch smaller. It does not enter the
// sums above, which are centre to centre.
export const SIZES: Record<RefillSize, SizeSpec> = {
  // The small three-hole loose-leaf binders. The pitch is 28.5mm here, not
  // the 19mm every ring binder uses, so nothing about this one can be
  // borrowed from the sizes below it.
  MINI3: {
    id: 'MINI3', label: '縦長ミニ3穴', widthMm: 60, heightMm: 80, ringMarginMm: 8,
    holes: { count: 3, diameterMm: 4, pitchMm: 28.5, marginMm: 11.5 },
  },
  // A business card on three rings. Three holes at the standard pitch span
  // 38mm, which only fits the 55mm edge, so that is the edge they go on --
  // which makes this the one card-sized refill that is wider than it is tall.
  // It is the same sheet as a 55×91 held upright with the rings above it; a
  // wide sheet bound on its left is how it is actually written on, and how
  // every other size here is described, so it is described that way too.
  CARD3: {
    id: 'CARD3', label: '横長ミニ3穴', widthMm: 91, heightMm: 55, ringMarginMm: 8,
    holes: { count: 3, diameterMm: 3.5, pitchMm: 19, marginMm: 8.5 },
  },
  M5: {
    id: 'M5', label: 'マイクロ5', widthMm: 62, heightMm: 105, ringMarginMm: 8,
    holes: { count: 5, diameterMm: 3.5, pitchMm: 19, marginMm: 14.5 },
  },
  // Micro 5's punch on a square sheet: the binding edge is the same 105mm, so
  // the same five rings hold it.
  M5SQ: {
    id: 'M5SQ', label: 'M5スクエア', widthMm: 105, heightMm: 105, ringMarginMm: 8,
    holes: { count: 5, diameterMm: 3.5, pitchMm: 19, marginMm: 14.5 },
  },
  M6: {
    id: 'M6', label: 'ミニ6', widthMm: 80, heightMm: 128, ringMarginMm: 9,
    holes: { count: 6, diameterMm: 4, pitchMm: 19, marginMm: 16.5 },
  },
  NARROW: {
    id: 'NARROW', label: 'ナロー', widthMm: 80, heightMm: 170, ringMarginMm: 10,
    holes: { count: 6, diameterMm: 5.5, pitchMm: 19, marginMm: 21.5, centreGapMm: 51 },
  },
  BIBLE: {
    id: 'BIBLE', label: 'バイブル', widthMm: 95, heightMm: 170, ringMarginMm: 10,
    holes: { count: 6, diameterMm: 5.5, pitchMm: 19, marginMm: 21.5, centreGapMm: 51 },
  },
  // Same height and the same punch as A5, just narrower. The 110mm width is
  // the one the binder actually measures; 125 was a placeholder the spec
  // flagged as unverified from the day it was written.
  A5SLIM: {
    id: 'A5SLIM', label: 'A5スリム', widthMm: 110, heightMm: 210, ringMarginMm: 12,
    holes: { count: 6, diameterMm: 5.5, pitchMm: 19, marginMm: 32, centreGapMm: 70 },
  },
  A5: {
    id: 'A5', label: 'A5', widthMm: 148, heightMm: 210, ringMarginMm: 12,
    holes: { count: 6, diameterMm: 5.5, pitchMm: 19, marginMm: 32, centreGapMm: 70 },
  },
};

// Hole centres along the binding edge, from its start: down the sheet for one
// bound on its side, across it for one bound at the top.
export function holeCentres(spec: HoleSpec): number[] {
  const { count, pitchMm, marginMm, centreGapMm } = spec;
  if (!centreGapMm) {
    return Array.from({ length: count }, (_, i) => marginMm + pitchMm * i);
  }
  const perGroup = Math.round(count / 2);
  const first = Array.from({ length: perGroup }, (_, i) => marginMm + pitchMm * i);
  const secondStart = first[perGroup - 1] + centreGapMm;
  return [
    ...first,
    ...Array.from({ length: count - perGroup }, (_, i) => secondStart + pitchMm * i),
  ];
}

export const MM_TO_PT = 2.834645669;
export const mmToPt = (mm: number) => mm * MM_TO_PT;
