// Japanese public holidays, from the law rather than from a table, because a
// planner prints years that no published table reaches yet.
//
// Two of them -- the equinoxes -- are astronomical: the Cabinet Office
// announces each February which day the sun crosses the equator on, and that
// is what this computes. Everything else is a date, a weekday rule, or a
// substitution.

import { jstDayNumber, julianDay, sunLongitudeTime } from './astro';

export interface Holiday {
  month: number;
  day: number;
  name: string;
}

const nthMonday = (year: number, month: number, nth: number): number => {
  const first = new Date(year, month - 1, 1).getDay();
  return 1 + ((8 - first) % 7) + (nth - 1) * 7;
};

// The day the sun's apparent longitude reaches 0 or 180 degrees, in Japan.
// The holiday is that day, whatever the hour.
function equinoxDay(year: number, spring: boolean): number {
  const jde = sunLongitudeTime(spring ? 0 : 180, julianDay(year, spring ? 2 : 8, 1));
  const n = jstDayNumber(jde);
  // Day number back to a day of the month, which is all the caller wants.
  const base = jstDayNumber(julianDay(year, spring ? 3 : 9, 1) + 0.5) - 1;
  return n - base;
}

// The one-off holidays: imperial ceremonies and the two years the Olympic
// holidays were moved. They are law, not rule, so they are listed.
const ONE_OFF: Record<number, Holiday[]> = {
  1959: [{ month: 4, day: 10, name: '皇太子明仁親王の結婚の儀' }],
  1989: [{ month: 2, day: 24, name: '昭和天皇の大喪の礼' }],
  1990: [{ month: 11, day: 12, name: '即位礼正殿の儀' }],
  1993: [{ month: 6, day: 9, name: '皇太子徳仁親王の結婚の儀' }],
  2019: [
    { month: 5, day: 1, name: '天皇の即位の日' },
    { month: 10, day: 22, name: '即位礼正殿の儀の行われる日' },
  ],
};

// Every holiday in a year, in date order, before substitutions.
function statutory(year: number): Holiday[] {
  const out: Holiday[] = [];
  const add = (month: number, day: number, name: string) => out.push({ month, day, name });
  if (year < 1949) return out;

  add(1, 1, '元日');
  if (year >= 2000) add(1, nthMonday(year, 1, 2), '成人の日');
  else add(1, 15, '成人の日');

  if (year >= 1967) add(2, 11, '建国記念の日');
  if (year >= 2020) add(2, 23, '天皇誕生日');

  add(3, equinoxDay(year, true), '春分の日');

  if (year >= 2007) { add(4, 29, '昭和の日'); add(5, 4, 'みどりの日'); }
  else if (year >= 1989) add(4, 29, 'みどりの日');
  else add(4, 29, '天皇誕生日');

  add(5, 3, '憲法記念日');
  add(5, 5, 'こどもの日');

  // The year the games moved the holidays, and the year they moved again.
  if (year === 2020) { add(7, 23, '海の日'); add(7, 24, 'スポーツの日'); add(8, 10, '山の日'); }
  else if (year === 2021) { add(7, 22, '海の日'); add(7, 23, 'スポーツの日'); add(8, 8, '山の日'); }
  else {
    if (year >= 2003) add(7, nthMonday(year, 7, 3), '海の日');
    else if (year >= 1996) add(7, 20, '海の日');
    if (year >= 2016) add(8, 11, '山の日');
    if (year >= 2020) add(10, nthMonday(year, 10, 2), 'スポーツの日');
    else if (year >= 2000) add(10, nthMonday(year, 10, 2), '体育の日');
    else if (year >= 1966) add(10, 10, '体育の日');
  }

  if (year >= 2003) add(9, nthMonday(year, 9, 3), '敬老の日');
  else if (year >= 1966) add(9, 15, '敬老の日');

  add(9, equinoxDay(year, false), '秋分の日');
  add(11, 3, '文化の日');
  add(11, 23, '勤労感謝の日');
  if (year >= 1989 && year <= 2018) add(12, 23, '天皇誕生日');

  out.push(...(ONE_OFF[year] ?? []));
  return out.sort((a, b) => a.month - b.month || a.day - b.day);
}

const key = (month: number, day: number) => month * 100 + day;

// Sunday holidays move to the next day that is not itself a holiday; a lone
// weekday caught between two holidays becomes one as well.
function withSubstitutes(year: number, base: Holiday[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const h of base) map.set(key(h.month, h.day), h.name);

  for (const h of base) {
    {
      const d = new Date(year, h.month - 1, h.day);
      if (d.getDay() !== 0) continue;
      // The substitution law took effect part-way through 1973, so the
      // Sunday holidays before that April were not carried over.
      if (year < 1973 || (year === 1973 && (h.month < 4 || (h.month === 4 && h.day < 12)))) continue;
      const next = new Date(d);
      do { next.setDate(next.getDate() + 1); }
      // Before 2007 the substitute could only be the following day.
      while (year >= 2007 && map.has(key(next.getMonth() + 1, next.getDate())));
      const k = key(next.getMonth() + 1, next.getDate());
      if (!map.has(k)) map.set(k, '振替休日');
    }
  }

  if (year >= 1986) {
    // A gap of exactly one day between two holidays. In practice this is the
    // day before the autumn equinox when Respect for the Aged Day falls on
    // the 21st, which happens every few years. Saturday counts: it is an
    // ordinary working day as far as the law is concerned, and only Sunday
    // is excluded.
    const days = [...map.keys()].sort((a, b) => a - b);
    for (const k of days) {
      const m = Math.floor(k / 100), day = k % 100;
      const mid = new Date(year, m - 1, day + 1);
      const after = new Date(year, m - 1, day + 2);
      const midKey = key(mid.getMonth() + 1, mid.getDate());
      const afterKey = key(after.getMonth() + 1, after.getDate());
      if (!map.has(midKey) && map.has(afterKey) && mid.getDay() !== 0) {
        map.set(midKey, '国民の休日');
      }
    }
  }
  return map;
}

const cache = new Map<number, Map<number, string>>();

function table(year: number): Map<number, string> {
  let t = cache.get(year);
  if (!t) {
    t = withSubstitutes(year, statutory(year));
    cache.set(year, t);
  }
  return t;
}

// The holiday's name, or null. This is what the calendar prints in the cell.
export function holidayName(year: number, month: number, day: number): string | null {
  return table(year).get(key(month, day)) ?? null;
}

export const isHoliday = (year: number, month: number, day: number): boolean =>
  holidayName(year, month, day) !== null;
