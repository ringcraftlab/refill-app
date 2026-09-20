export const SCHEMA_VERSION = 3;

export type RefillSize = 'M5' | 'M6' | 'BIBLE' | 'A6' | 'A5';

export interface SizeSpec {
  id: RefillSize;
  label: string;
  widthMm: number;
  heightMm: number;
  // Strip along the binding edge that the rings occupy. Content never enters
  // it, so nothing can print on top of a punch hole.
  ringMarginMm: number;
}

export type WeekStart = 0 | 1;

export type PartKind = 'monthly' | 'habit' | 'grid' | 'lines' | 'memo';

// A spread monthly is one calendar across both pages.
//   1: split the weekday columns (Mon-Wed | Thu-Sun), pages stay portrait
//   2: split the week rows, pages turn landscape and stack
export type SpanPattern = 1 | 2;

export interface Spanning {
  pattern: SpanPattern;
  // Share of the usable page height the calendar takes. It stays at 1 — the
  // whole page — until another part actually joins it.
  ratio: number;
}

export type PageKey = 'single' | 'left' | 'right';

export interface PageState {
  placed: PartKind[];
  // Where the shared borders sit. This is the whole point of the app: a
  // commercial refill's memo area is fixed, here you drag it wider.
  ratios: { a?: number; b?: number; c?: number };
}

export interface Layout {
  version: number;
  id: string;
  name: string;
  size: RefillSize;
  spread: boolean;
  spanning: Spanning | null;
  pages: Record<PageKey, PageState>;
  year: number;
  month: number; // 1-12
  weekStart: WeekStart;
  monthlyOrientation: 'portrait' | 'landscape';
  habitCount: number;
  updatedAt: string;
}

export const MAX_PARTS_PER_PAGE = 4;
