import type { RefillSize, SizeSpec } from '../types';

// Ring margins are approximations until a per-size hole table is confirmed.
// They only need to be generous enough that nothing prints under a hole.
export const SIZES: Record<RefillSize, SizeSpec> = {
  M5:    { id: 'M5',    label: 'M5',         widthMm: 62,  heightMm: 105, ringMarginMm: 8 },
  M6:    { id: 'M6',    label: 'M6（ミニ6）', widthMm: 80,  heightMm: 127, ringMarginMm: 9 },
  BIBLE: { id: 'BIBLE', label: 'バイブル',     widthMm: 95,  heightMm: 170, ringMarginMm: 10 },
  A6:    { id: 'A6',    label: 'A6',         widthMm: 105, heightMm: 148, ringMarginMm: 10 },
  A5:    { id: 'A5',    label: 'A5',         widthMm: 148, heightMm: 210, ringMarginMm: 12 },
};

export const MM_TO_PT = 2.834645669;
export const mmToPt = (mm: number) => mm * MM_TO_PT;
