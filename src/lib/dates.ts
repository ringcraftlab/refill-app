import type { WeekdayFormat, WeekStart } from '../types';

const JP_LONG  = ['日','月','火','水','木','金','土'];
const JP_SHORT = ['日','月','火','水','木','金','土']; // same for MVP
const EN_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const EN_INIT  = ['S','M','T','W','T','F','S'];

export function weekdayLabel(date: Date, format: WeekdayFormat): string {
  const dow = date.getDay();
  switch (format) {
    case 'jp-long': return JP_LONG[dow];
    case 'jp-short': return JP_SHORT[dow];
    case 'en-short': return EN_SHORT[dow];
    case 'en-initial': return EN_INIT[dow];
  }
}

export function parseISO(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d: Date, n: number): Date {
  const nd = new Date(d);
  nd.setDate(nd.getDate() + n);
  return nd;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

// Build a 6-row calendar grid (weeks × 7). Each cell is a Date or null.
export function monthGrid(year: number, month: number, weekStart: WeekStart): (Date | null)[][] {
  const first = new Date(year, month - 1, 1);
  const firstDow = first.getDay();
  const offset = (firstDow - weekStart + 7) % 7;
  const total = daysInMonth(year, month);
  const cells: (Date | null)[] = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= total; d++) cells.push(new Date(year, month - 1, d));
  while (cells.length % 7 !== 0) cells.push(null);
  while (cells.length < 42) cells.push(null);
  const rows: (Date | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  // Trim empty trailing rows
  while (rows.length > 1 && rows[rows.length - 1].every(c => c === null)) rows.pop();
  return rows;
}

export function orderedWeekdays(weekStart: WeekStart): number[] {
  const arr: number[] = [];
  for (let i = 0; i < 7; i++) arr.push((weekStart + i) % 7);
  return arr;
}
