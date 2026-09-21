export const SCHEMA_VERSION = 7;

export type RefillSize = 'M5' | 'M6' | 'BIBLE' | 'NARROW' | 'A5SLIM' | 'A5';

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

export type PartKind =
  | 'monthly' | 'habit' | 'todo' | 'goal' | 'budget' | 'grid' | 'lines' | 'memo';

// What a part needs to stay usable, and which way it wants to be shaped. The
// habit tracker carries 31 day columns, so it needs width or its ticks become
// unwritable; a to-do list stacks items, so it wants height. Placement picks a
// split from these numbers rather than from anyone's taste.
export interface PartFit {
  minWMm: number;
  minHMm: number;
  prefer: 'wide' | 'tall' | 'any';
}

export const PART_FIT: Record<PartKind, PartFit> = {
  // Seven columns at about 6mm each. Micro 5 leaves 51mm on a single page,
  // which is the tightest real refill there is; below this the dates collide.
  monthly: { minWMm: 44, minHMm: 40, prefer: 'any' },
  habit:   { minWMm: 76, minHMm: 18, prefer: 'wide' },
  todo:    { minWMm: 18, minHMm: 28, prefer: 'tall' },
  goal:    { minWMm: 26, minHMm: 18, prefer: 'any' },
  budget:  { minWMm: 34, minHMm: 20, prefer: 'any' },
  grid:    { minWMm: 14, minHMm: 8,  prefer: 'any' },
  lines:   { minWMm: 16, minHMm: 8,  prefer: 'any' },
  memo:    { minWMm: 16, minHMm: 10, prefer: 'any' },
};

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
  // The first month generated. Dated parts repeat for `monthCount` months, so
  // one design yields a whole year of refills in a single export.
  year: number;
  month: number; // 1-12
  monthCount: number;
  weekStart: WeekStart;
  monthlyOrientation: 'portrait' | 'landscape';
  // Printed refills usually tuck next month's dates into the spread's index
  // column, so it is on unless the user clears it.
  showNextMonth: boolean;
  habitCount: number;
  updatedAt: string;
}

export const MAX_PARTS = 4;
