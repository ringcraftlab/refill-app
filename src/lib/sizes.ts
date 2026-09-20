import type { SizeSpec, RefillSize } from '../types';

export const SIZES: Record<RefillSize, SizeSpec> = {
  M5:    { id: 'M5',    label: 'M5 (62×105)',        widthMm: 62,  heightMm: 105, ringMarginMm: 8 },
  M5SQ:  { id: 'M5SQ',  label: 'M5スクエア (105×105)', widthMm: 105, heightMm: 105, ringMarginMm: 8 },
  M6:    { id: 'M6',    label: 'M6 (80×127)',        widthMm: 80,  heightMm: 127, ringMarginMm: 9 },
  BIBLE: { id: 'BIBLE', label: 'バイブル (95×170)',    widthMm: 95,  heightMm: 170, ringMarginMm: 10 },
  A6:    { id: 'A6',    label: 'A6 (105×148)',       widthMm: 105, heightMm: 148, ringMarginMm: 10 },
  A5:    { id: 'A5',    label: 'A5 (148×210)',       widthMm: 148, heightMm: 210, ringMarginMm: 12 },
};

export const MM_TO_PT = 2.834645669;
export const mmToPt = (mm: number) => mm * MM_TO_PT;
