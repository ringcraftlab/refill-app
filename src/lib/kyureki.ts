// The Japanese lunisolar calendar, and the six-day cycle printed on refills.
//
// A lunar month runs from one new moon to the next. Which number it carries
// comes from the sun: the month holding the winter solstice is the eleventh,
// and a month that holds no mid-term (a longitude that is a multiple of 30
// degrees) is a leap month and repeats the number before it. The six-day
// cycle is then just (month + day) mod 6 -- but only once those two numbers
// are the real ones.

import {
  dateOfDayNumber, dayNumber, deltaTSeconds, fromJulianDay, JST_OFFSET_DAYS,
  julianDay, jstDayNumber, newMoonIndex, newMoonJde, sunLongitude, sunLongitudeTime,
} from './astro';

export interface Kyureki {
  month: number;
  day: number;
  leap: boolean;
}

// Midnight in Japan, as Terrestrial Time, for the day that starts there.
function jstMidnightJde(day: number): number {
  const jdJst = day - 0.5;
  const { year, month } = fromJulianDay(jdJst);
  return jdJst - JST_OFFSET_DAYS + deltaTSeconds(year, month) / 86400;
}

// The day in Japan that a new moon falls on.
const newMoonDay = (k: number): number => {
  const jde = newMoonJde(k);
  const { year, month } = fromJulianDay(jde);
  return Math.floor(jde - deltaTSeconds(year, month) / 86400 + JST_OFFSET_DAYS + 0.5);
};

// Which thirtieth of the ecliptic the sun is in at the start of a day. A
// month passed a mid-term when this number differs between the day it starts
// and the day the next month starts -- the comparison has to be with the
// following month's first day, not with this month's last one, or a mid-term
// that falls during that last day is missed and the month is wrongly called
// a leap.
const chuki = (day: number): number => Math.floor(sunLongitude(jstMidnightJde(day)) / 30);

// The new moon that opens the lunar month a day belongs to.
function monthStartIndex(day: number): number {
  const at = dateOfDayNumber(day);
  let k = newMoonIndex(at.year, at.month);
  // Walk to the month that actually contains the day. Two steps at most in
  // practice; the bound is only there so a bad input cannot spin.
  for (let i = 0; i < 6; i++) {
    if (newMoonDay(k) > day) { k -= 1; continue; }
    if (newMoonDay(k + 1) <= day) { k += 1; continue; }
    return k;
  }
  return k;
}

// The day the sun reaches 270 degrees -- the winter solstice in Japan.
function solsticeDay(year: number): number {
  return jstDayNumber(sunLongitudeTime(270, julianDay(year, 12, 1)));
}

// The month holding the winter solstice is the eleventh, so numbering starts
// from whichever solstice fell on or before the month in hand. The solstice's
// year comes back too, because the next one closes the cycle.
function eleventhMonth(k: number): { index: number; year: number } {
  const { year } = dateOfDayNumber(newMoonDay(k));
  const index = monthStartIndex(solsticeDay(year));
  if (index > k) return { index: monthStartIndex(solsticeDay(year - 1)), year: year - 1 };
  return { index, year };
}

export function kyureki(year: number, month: number, day: number): Kyureki {
  const d = dayNumber(year, month, day);
  const k = monthStartIndex(d);
  const from = eleventhMonth(k);
  // Two solstices with thirteen new moons between them is a year that needs a
  // leap month; twelve is a year that does not. Without this check a month
  // that merely happens to skip a mid-term -- which a twelve-month year can
  // still throw up -- gets wrongly doubled, and every month after it is
  // named wrong until the next solstice puts the count straight.
  const next = monthStartIndex(solsticeDay(from.year + 1));
  const leapYear = next - from.index === 13;

  let num = 11;
  let leap = false;
  let leapUsed = false;
  for (let j = from.index + 1; j <= k; j++) {
    const noChuki = chuki(newMoonDay(j)) === chuki(newMoonDay(j + 1));
    if (leapYear && !leapUsed && noChuki) {
      // A leap month keeps the number of the month before it.
      leap = true;
      leapUsed = true;
    } else {
      num = num === 12 ? 1 : num + 1;
      leap = false;
    }
  }
  return { month: num, day: d - newMoonDay(k) + 1, leap };
}

// 0 is the day the cycle is counted from, which is why the order starts at
// 大安 rather than at 先勝.
const ROKUYO = ['大安', '赤口', '先勝', '友引', '先負', '仏滅'];

export function rokuyo(year: number, month: number, day: number): string {
  const k = kyureki(year, month, day);
  return ROKUYO[(k.month + k.day) % 6];
}

export { julianDay };
