import type { WeekStart } from '../types';

const EN_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Jan 7 2024 was a Sunday, so +dow lands on the wanted weekday.
export const weekdayLabel = (dow: number): string => EN_SHORT[dow];

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

const ROKUYO = ['先勝', '友引', '先負', '仏滅', '大安', '赤口'];

// PLACEHOLDER. The real six-day cycle follows the lunisolar calendar, which
// needs a proper ephemeris; this only cycles on the day number so the layout
// can be judged with something in the cell. Do not ship it as fact.
export const rokuyoLabel = (date: Date): string => ROKUYO[(date.getDate() - 1) % 6];
