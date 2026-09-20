import type { HoleSpec, RefillSize, SizeSpec } from '../types';

// Punch patterns taken from a refill dimension sheet. The 19mm pitch is the
// worldwide standard and is the same on every size; only the hole count, the
// middle gap and the end margin change. Each pattern adds up to its paper
// height exactly, which is the check to redo if a number ever moves:
//   A5      32×2 + 19×4 + 70 = 210
//   Bible   21.5×2 + 19×4 + 51 = 170
//   Narrow  21.5×2 + 19×4 + 51 = 170   (same height, same punch)
//   Mini 6  16.5×2 + 19×5 = 128        (one even run, no middle gap)
//   Micro 5 14.5×2 + 19×4 = 105        (five holes, not six)
export const SIZES: Record<RefillSize, SizeSpec> = {
  M5: {
    id: 'M5', label: 'マイクロ5', widthMm: 62, heightMm: 105, ringMarginMm: 8,
    holes: { count: 5, diameterMm: 4, pitchMm: 19, marginMm: 14.5 },
  },
  M6: {
    id: 'M6', label: 'ミニ6', widthMm: 80, heightMm: 128, ringMarginMm: 9,
    holes: { count: 6, diameterMm: 4, pitchMm: 19, marginMm: 16.5 },
  },
  NARROW: {
    id: 'NARROW', label: 'ナロー', widthMm: 80, heightMm: 170, ringMarginMm: 10,
    holes: { count: 6, diameterMm: 5, pitchMm: 19, marginMm: 21.5, centreGapMm: 51 },
  },
  BIBLE: {
    id: 'BIBLE', label: 'バイブル', widthMm: 95, heightMm: 170, ringMarginMm: 10,
    holes: { count: 6, diameterMm: 5, pitchMm: 19, marginMm: 21.5, centreGapMm: 51 },
  },
  A5: {
    id: 'A5', label: 'A5', widthMm: 148, heightMm: 210, ringMarginMm: 12,
    holes: { count: 6, diameterMm: 5, pitchMm: 19, marginMm: 32, centreGapMm: 70 },
  },
};

// Hole centres measured from the top of the binding edge.
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
