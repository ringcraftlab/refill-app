// Versioned layout schema. Bump `version` on breaking changes and add a
// migration path in lib/storage.ts.
export const SCHEMA_VERSION = 2;

export type RefillSize =
  | 'M5' | 'M5SQ' | 'M6' | 'BIBLE' | 'A6' | 'A5';

export interface SizeSpec {
  id: RefillSize;
  label: string;
  widthMm: number;
  heightMm: number;
  // Left margin reserved for rings when this page is the right half of a spread
  // (or the whole page for single-side). Approximate MVP values.
  ringMarginMm: number;
}

export type WeekStart = 0 | 1; // 0=Sunday, 1=Monday
export type WeekdayFormat = 'jp-long' | 'jp-short' | 'en-short' | 'en-initial';

export interface HabitTrackerPart {
  kind: 'habit-tracker';
  id: string;
  // First date shown. Days flow from here, allowing month-boundary trackers.
  startDate: string; // YYYY-MM-DD
  days: number;      // e.g. 28-35
  habits: string[];
  title: string;
  weekdayFormat: WeekdayFormat;
}

// The four confirmed monthly layouts.
//   spread-weekday   Mon/Tue/Wed on the left page, Thu-Sun on the right. One
//                    calendar spanning two portrait pages side by side.
//   spread-week      Weeks 1-2 on one page, the rest on the other. The pages
//                    are landscape and stack vertically.
//   single-portrait  An ordinary one-page calendar.
//   single-landscape Same content as single-portrait on a landscape page; the
//                    user turns the planner a quarter turn to read it.
//
// Landscape NEVER transposes the grid. It stays seven weekday columns; only
// the page shape and the ring edge change.
export type MonthlyVariant =
  | 'spread-weekday'
  | 'spread-week'
  | 'single-portrait'
  | 'single-landscape';

export interface MonthlyCalendarPart {
  kind: 'monthly-calendar';
  id: string;
  year: number;
  month: number; // 1-12
  weekStart: WeekStart;
  weekdayFormat: WeekdayFormat;
  variant: MonthlyVariant;
}

export type Part = HabitTrackerPart | MonthlyCalendarPart;

export interface Layout {
  version: number;
  id: string;
  name: string;
  size: RefillSize;
  part: Part;
  updatedAt: string;
}
