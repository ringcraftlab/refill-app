import type { WeekStart } from '../types';
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
