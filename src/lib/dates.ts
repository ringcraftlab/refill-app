import type { Layout, WeekStart } from '../types';
import { rokuyo } from './kyureki';
import { holidayName } from './holidays';

const EN_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Jan 7 2024 was a Sunday, so +dow lands on the wanted weekday.
export const weekdayLabel = (dow: number): string => EN_SHORT[dow];

export function addMonths(year: number, month: number, n: number): { year: number; month: number } {
  const zeroBased = year * 12 + (month - 1) + n;
  return { year: Math.floor(zeroBased / 12), month: (zeroBased % 12) + 1 };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

// Weeks × 7 cells. Each cell is a Date or null. Trailing empty weeks are
// dropped so a 4-week February does not print an empty row.
export function monthGrid(year: number, month: number, weekStart: WeekStart): (Date | null)[][] {
  const first = new Date(year, month - 1, 1);
  const offset = (first.getDay() - weekStart + 7) % 7;
  const total = daysInMonth(year, month);
  const cells: (Date | null)[] = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= total; d++) cells.push(new Date(year, month - 1, d));
  while (cells.length % 7 !== 0) cells.push(null);
  const rows: (Date | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

export const addDays = (date: Date, n: number): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);

export const parseDate = (iso: string): Date => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};

// Back to the day the week starts on, which is where a seven-day sheet has to
// begin or the weeks come out split down the middle.
export const startOfWeek = (date: Date, weekStart: WeekStart): Date =>
  addDays(date, -(((date.getDay() - weekStart) % 7 + 7) % 7));

// The first day of every sheet in a dated run. The period is the same one the
// month range names; a run whose sheets are whole weeks starts on a week
// boundary, anything else starts on the first of the month.
export function sheetStarts(layout: Layout): Date[] {
  const days = Math.max(1, layout.daysPerSheet);
  const last = addMonths(layout.year, layout.month, Math.max(1, layout.monthCount) - 1);
  const end = new Date(last.year, last.month, 0);
  // A run can be told to begin on a day rather than at the top of a month.
  // Whole weeks still start on a week boundary, so asking for today gives
  // this week, not a sheet cut down the middle.
  const from = layout.runStart ? parseDate(layout.runStart) : new Date(layout.year, layout.month - 1, 1);
  let cursor = days % 7 === 0 ? startOfWeek(from, layout.weekStart) : from;
  const out: Date[] = [];
  // A year of single days is 365 sheets, which is a lot but is what was
  // asked for; the guard is only against a runaway.
  while (cursor <= end && out.length < 800) {
    out.push(cursor);
    cursor = addDays(cursor, days);
  }
  return out;
}

// The first and last day a day-paced run actually covers. The months set the
// period, but a weekly starts on the week holding the first of the month --
// which is usually the month before -- and stops when its last sheet runs
// out, days into the month after. Naming only the months names neither end,
// and one of them contradicts the label.
export function runDates(layout: Layout): [Date, Date] {
  const starts = sheetStarts(layout);
  const first = starts[0] ?? new Date(layout.year, layout.month - 1, 1);
  const last = starts[starts.length - 1] ?? first;
  return [first, addDays(last, Math.max(1, layout.daysPerSheet) - 1)];
}

// The day the sheet in hand starts on. Only a run being rendered says which
// one; the editor shows the first.
export function sheetStartOf(layout: Layout): Date {
  if (layout.sheetStart) return parseDate(layout.sheetStart);
  return sheetStarts(layout)[0] ?? new Date(layout.year, layout.month - 1, 1);
}

// The days one sheet carries, when a weekly grid sets the pace.
export const sheetDays = (layout: Layout): Date[] => {
  const start = sheetStartOf(layout);
  return Array.from({ length: Math.max(1, layout.daysPerSheet) }, (_, i) => addDays(start, i));
};

export const isoDate = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function orderedWeekdays(weekStart: WeekStart): number[] {
  return Array.from({ length: 7 }, (_, i) => (weekStart + i) % 7);
}

// The six-day cycle, from the lunisolar calendar rather than from the day of
// the month. See kyureki.ts for how the lunar date is worked out.
export const rokuyoLabel = (date: Date): string =>
  rokuyo(date.getFullYear(), date.getMonth() + 1, date.getDate());

// A public holiday's name, or null. The calendar colours the date and prints
// the name where the cell has room for it.
export const holidayOf = (date: Date): string | null =>
  holidayName(date.getFullYear(), date.getMonth() + 1, date.getDate());
