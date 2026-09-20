export const SCHEMA_VERSION = 5;

export type RefillSize = 'M5' | 'M6' | 'BIBLE' | 'NARROW' | 'A5';

// Punch pattern along the binding edge. The 19mm pitch is the worldwide
// standard; what differs per size is the hole count, whether they run evenly
// or in two groups of three, and how far in the outermost hole sits.
export interface HoleSpec {
  count: number;
  diameterMm: number;
  pitchMm: number;
  // Paper edge to the outermost hole's centre.
  marginMm: number;
  // Centre-to-centre across the middle. Omitted means one even run.
  centreGapMm?: number;
}

export interface SizeSpec {
  id: RefillSize;
  label: string;
  widthMm: number;
  heightMm: number;
  // Strip along the binding edge that the rings occupy. Content never enters
  // it, so nothing can print on top of a punch hole.
  ringMarginMm: number;
  holes: HoleSpec;
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

// The area left over once the calendar has taken its band. In a spread this is
// ONE surface across both pages: a part whose region crosses the gutter spans
// the spread, one that fits in a half sits on that page alone.
export interface Surface {
  placed: PartKind[];
  // Where the shared borders sit. This is the whole point of the app: a
  // commercial refill's memo area is fixed, here you drag it wider.
  ratios: { a?: number; b?: number; c?: number };
  // How two parts divide the surface. 'h' stacks them, so in a spread both
  // cross the gutter; 'v' sets them side by side, one per page.
  split: 'h' | 'v';
}

export interface Layout {
  version: number;
  id: string;
  name: string;
  size: RefillSize;
  spread: boolean;
  spanning: Spanning | null;
  surface: Surface;
  year: number;
  month: number; // 1-12
  weekStart: WeekStart;
  monthlyOrientation: 'portrait' | 'landscape';
  habitCount: number;
  updatedAt: string;
}

export const MAX_PARTS = 4;
