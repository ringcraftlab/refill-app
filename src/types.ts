// Versioned layout schema. Bump `version` on breaking changes and add a
// migration path in lib/storage.ts.
export const SCHEMA_VERSION = 1;

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

export interface MonthlyCalendarPart {
  kind: 'monthly-calendar';
  id: string;
  year: number;
  month: number; // 1-12
  weekStart: WeekStart;
  weekdayFormat: WeekdayFormat;
  // M5 uses a spread by default; other sizes single page.
  spread: boolean;
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
