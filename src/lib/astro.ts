// The astronomy the Japanese calendar needs: when the moon is new, and where
// the sun is. The six-day cycle printed on refills comes from the lunisolar
// calendar, and the equinox holidays come from the sun -- neither can be
// faked with a modulo.
//
// Formulae are Meeus, Astronomical Algorithms (2nd ed.): chapter 49 for the
// moon's phases and chapter 25 for the sun's apparent longitude. Times are
// computed in Terrestrial Time and handed back as Japan Standard Time, which
// is the time zone the Japanese calendar is defined in.

const RAD = Math.PI / 180;
const sin = (deg: number) => Math.sin(deg * RAD);
export const JST_OFFSET_DAYS = 9 / 24;

const norm360 = (deg: number): number => ((deg % 360) + 360) % 360;

// Julian Day for a Gregorian date at 00:00. Integer dates only; the fraction
// is added by the caller.
export function julianDay(year: number, month: number, day: number): number {
  let y = year, m = month;
  if (m <= 2) { y -= 1; m += 12; }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + b - 1524.5;
}

// Calendar date for a Julian Day. Returns the date the JD falls on and the
// fraction of the day, so a caller can ask what day an instant lands on.
export function fromJulianDay(jd: number): { year: number; month: number; day: number; fraction: number } {
  const z = Math.floor(jd + 0.5);
  const f = jd + 0.5 - z;
  let a = z;
  if (z >= 2299161) {
    const alpha = Math.floor((z - 1867216.25) / 36524.25);
    a = z + 1 + alpha - Math.floor(alpha / 4);
  }
  const b = a + 1524;
  const c = Math.floor((b - 122.1) / 365.25);
  const d = Math.floor(365.25 * c);
  const e = Math.floor((b - d) / 30.6001);
  const day = b - d - Math.floor(30.6001 * e);
  const month = e < 14 ? e - 1 : e - 13;
  const year = month > 2 ? c - 4716 : c - 4715;
  return { year, month, day, fraction: f };
}

// TT - UT in seconds. Espenak & Meeus's polynomials, the ones NASA publishes
// with its eclipse canon. Seventy-odd seconds now, and it matters only when an
// event falls within a minute of midnight -- which is exactly when a lunar
// month would otherwise start on the wrong day.
export function deltaTSeconds(year: number, month: number): number {
  const y = year + (month - 0.5) / 12;
  if (y < 1600) return 0;
  if (y < 1700) { const t = y - 1600; return 120 - 0.9808 * t - 0.01532 * t * t + t ** 3 / 7129; }
  if (y < 1800) { const t = y - 1700; return 8.83 + 0.1603 * t - 0.0059285 * t * t + 0.00013336 * t ** 3 - t ** 4 / 1174000; }
  if (y < 1860) { const t = y - 1800; return 13.72 - 0.332447 * t + 0.0068612 * t * t + 0.0041116 * t ** 3 - 0.00037436 * t ** 4 + 0.0000121272 * t ** 5 - 0.0000001699 * t ** 6 + 0.000000000875 * t ** 7; }
  if (y < 1900) { const t = y - 1860; return 7.62 + 0.5737 * t - 0.251754 * t * t + 0.01680668 * t ** 3 - 0.0004473624 * t ** 4 + t ** 5 / 233174; }
  if (y < 1920) { const t = y - 1900; return -2.79 + 1.494119 * t - 0.0598939 * t * t + 0.0061966 * t ** 3 - 0.000197 * t ** 4; }
  if (y < 1941) { const t = y - 1920; return 21.20 + 0.84493 * t - 0.076100 * t * t + 0.0020936 * t ** 3; }
  if (y < 1961) { const t = y - 1950; return 29.07 + 0.407 * t - t * t / 233 + t ** 3 / 2547; }
  if (y < 1986) { const t = y - 1975; return 45.45 + 1.067 * t - t * t / 260 - t ** 3 / 718; }
  if (y < 2005) { const t = y - 2000; return 63.86 + 0.3345 * t - 0.060374 * t * t + 0.0017275 * t ** 3 + 0.000651814 * t ** 4 + 0.00002373599 * t ** 5; }
  if (y < 2050) { const t = y - 2000; return 62.92 + 0.32217 * t + 0.005589 * t * t; }
  if (y < 2150) return -20 + 32 * ((y - 1820) / 100) ** 2 - 0.5628 * (2150 - y);
  const u = (y - 1820) / 100;
  return -20 + 32 * u * u;
}

const ttToJst = (jde: number): number => {
  const { year, month } = fromJulianDay(jde);
  return jde - deltaTSeconds(year, month) / 86400 + JST_OFFSET_DAYS;
};

// The earth's heliocentric longitude, VSOP87D as Meeus abridges it. The
// three-term version of the sun is good to a hundredth of a degree, which is
// a quarter of an hour of the sun's travel -- and a mid-term that lands a few
// minutes after midnight decides which lunar month is a leap month, so a
// quarter of an hour is not good enough. These terms bring it under a second.
//
// Coefficients are in units of 1e-8 radian; the arguments are radians and
// radians per millennium.
const L0: [number, number, number][] = [
  [175347046, 0, 0], [3341656, 4.6692568, 6283.0758500], [34894, 4.62610, 12566.15170],
  [3497, 2.74411, 5753.38488], [3418, 2.82843, 3.52312], [3136, 3.62767, 77713.77147],
  [2676, 4.41809, 7860.41939], [2343, 6.13516, 3930.20970], [1324, 0.74247, 11506.76977],
  [1273, 2.03712, 529.69097], [1199, 1.10962, 1577.34354], [990, 5.23268, 5884.92685],
  [902, 2.04505, 26.29832], [857, 3.50849, 398.14900], [780, 1.17900, 5223.69392],
  [753, 2.53331, 5507.55324], [505, 4.58293, 18849.22755], [492, 4.20507, 775.52261],
  [357, 2.91954, 0.06731], [317, 5.84902, 11790.62909], [284, 1.89869, 796.29801],
  [271, 0.31488, 10977.07880], [243, 0.34481, 5486.77784], [206, 4.80647, 2544.31442],
  [205, 1.86948, 5573.14280], [202, 2.45768, 6069.77675], [156, 0.83326, 213.29910],
  [132, 3.41118, 2942.46342], [126, 1.08327, 20.77540], [115, 0.64518, 0.98032],
  [103, 0.63595, 4694.00295], [102, 0.97555, 15720.83878], [102, 4.26719, 7.11355],
];
const L1: [number, number, number][] = [
  [628331966747, 0, 0], [206059, 2.678235, 6283.075850], [4303, 2.63510, 12566.15170],
  [425, 1.59003, 3.52312], [119, 5.79625, 26.29832], [109, 2.96637, 1577.34354],
  [93, 2.59251, 18849.22755], [72, 1.13846, 529.69097], [68, 1.87465, 398.14900],
  [67, 4.40923, 5507.55324], [59, 2.88800, 5223.69392], [56, 2.17190, 155.42040],
  [45, 0.39770, 796.29801], [36, 0.46876, 775.52261], [29, 2.64707, 7.11355],
  [21, 5.34138, 0.98032], [19, 1.84628, 5486.77784], [19, 4.96909, 213.29910],
  [17, 2.99168, 6275.96230], [16, 0.03216, 2544.31442], [16, 1.43189, 2146.16542],
  [15, 1.19956, 10977.07880], [12, 2.93021, 1748.01641], [12, 5.70117, 0.06731],
];
const L2: [number, number, number][] = [
  [52919, 0, 0], [8720, 1.07209, 6283.07585], [309, 0.86728, 12566.15170],
  [27, 0.05286, 3.52312], [16, 5.18904, 26.29832], [16, 3.68447, 155.42040],
  [10, 0.76794, 18849.22755], [9, 2.05363, 77713.77147], [7, 0.69460, 775.52261],
  [5, 1.28010, 5573.14280], [4, 1.21580, 5507.55324], [4, 0.69880, 5223.69392],
];
const L3: [number, number, number][] = [
  [289, 5.844, 6283.076], [35, 0, 0], [17, 5.49, 12566.15], [3, 5.20, 155.42],
];
const L4: [number, number, number][] = [[114, 3.142, 0], [8, 4.13, 6283.08]];

const series = (terms: [number, number, number][], tau: number): number =>
  terms.reduce((sum, [a, b, c]) => sum + a * Math.cos(b + c * tau), 0);

// The sun's apparent geocentric longitude, in degrees.
export function sunLongitude(jde: number): number {
  const tau = (jde - 2451545) / 365250;
  const l = (series(L0, tau) + tau * series(L1, tau) + tau ** 2 * series(L2, tau)
    + tau ** 3 * series(L3, tau) + tau ** 4 * series(L4, tau)) * 1e-8;
  // Heliocentric earth to geocentric sun, then the small corrections: the
  // conversion to FK5, nutation in longitude and the aberration of light.
  const t = (jde - 2451545) / 36525;
  const omega = 125.04 - 1934.136 * t;
  return norm360(l / RAD + 180 - 0.00569 - 0.00478 * sin(omega));
}

// When the sun next reaches a given longitude, at or after `fromJde`.
// Newton's method on a function whose slope is about a degree a day.
export function sunLongitudeTime(target: number, fromJde: number): number {
  let jde = fromJde;
  // Jump roughly to the right day first, so the iteration starts close.
  const gap = norm360(target - sunLongitude(jde));
  jde += gap * 365.2422 / 360;
  for (let i = 0; i < 12; i++) {
    let diff = sunLongitude(jde) - target;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    if (Math.abs(diff) < 1e-8) break;
    jde -= diff * 365.2422 / 360;
  }
  return jde;
}

// The k-th new moon after 2000 Jan 6, as Terrestrial Time. Meeus 49, with the
// planetary corrections: without those it drifts by up to a minute, and a
// minute is the difference between one date and the next.
export function newMoonJde(k: number): number {
  const t = k / 1236.85;
  const t2 = t * t, t3 = t2 * t, t4 = t3 * t;
  let jde = 2451550.09766 + 29.530588861 * k
    + 0.00015437 * t2 - 0.000000150 * t3 + 0.00000000073 * t4;

  const e = 1 - 0.002516 * t - 0.0000074 * t2;
  const m = 2.5534 + 29.10535670 * k - 0.0000014 * t2 - 0.00000011 * t3;
  const mp = 201.5643 + 385.81693528 * k + 0.0107582 * t2 + 0.00001238 * t3 - 0.000000058 * t4;
  const f = 160.7108 + 390.67050284 * k - 0.0016118 * t2 - 0.00000227 * t3 + 0.000000011 * t4;
  const omega = 124.7746 - 1.56375588 * k + 0.0020672 * t2 + 0.00000215 * t3;

  jde += -0.40720 * sin(mp)
    + 0.17241 * e * sin(m)
    + 0.01608 * sin(2 * mp)
    + 0.01039 * sin(2 * f)
    + 0.00739 * e * sin(mp - m)
    - 0.00514 * e * sin(mp + m)
    + 0.00208 * e * e * sin(2 * m)
    - 0.00111 * sin(mp - 2 * f)
    - 0.00057 * sin(mp + 2 * f)
    + 0.00056 * e * sin(2 * mp + m)
    - 0.00042 * sin(3 * mp)
    + 0.00042 * e * sin(m + 2 * f)
    + 0.00038 * e * sin(m - 2 * f)
    - 0.00024 * e * sin(2 * mp - m)
    - 0.00017 * sin(omega)
    - 0.00007 * sin(mp + 2 * m)
    + 0.00004 * sin(2 * mp - 2 * f)
    + 0.00004 * sin(3 * m)
    + 0.00003 * sin(mp + m - 2 * f)
    + 0.00003 * sin(2 * mp + 2 * f)
    - 0.00003 * sin(mp + m + 2 * f)
    + 0.00003 * sin(mp - m + 2 * f)
    - 0.00002 * sin(mp - m - 2 * f)
    - 0.00002 * sin(3 * mp + m)
    + 0.00002 * sin(4 * mp);

  const a = [
    [299.77 + 0.107408 * k - 0.009173 * t2, 0.000325],
    [251.88 + 0.016321 * k, 0.000165],
    [251.83 + 26.651886 * k, 0.000164],
    [349.42 + 36.412478 * k, 0.000126],
    [84.66 + 18.206239 * k, 0.000110],
    [141.74 + 53.303771 * k, 0.000062],
    [207.14 + 2.453732 * k, 0.000060],
    [154.84 + 7.306860 * k, 0.000056],
    [34.52 + 27.261239 * k, 0.000047],
    [207.19 + 0.121824 * k, 0.000042],
    [291.34 + 1.844379 * k, 0.000040],
    [161.72 + 24.198154 * k, 0.000037],
    [239.56 + 25.513099 * k, 0.000035],
    [331.55 + 3.592518 * k, 0.000023],
  ];
  for (const [angle, coeff] of a) jde += coeff * sin(angle);
  return jde;
}

// The day, in Japan, that an instant falls on. The calendar is a list of
// days, so every astronomical instant ends up as one of these.
export function jstDayNumber(jde: number): number {
  return Math.floor(ttToJst(jde) + 0.5);
}

// Day number for a calendar date, the same scale jstDayNumber returns.
export const dayNumber = (year: number, month: number, day: number): number =>
  Math.floor(julianDay(year, month, day) + 0.5);

export const dateOfDayNumber = (n: number): { year: number; month: number; day: number } => {
  const { year, month, day } = fromJulianDay(n - 0.5);
  return { year, month, day };
};

// The k that gives the new moon nearest a date, to start a search from.
export const newMoonIndex = (year: number, month: number): number =>
  Math.round((year + (month - 0.5) / 12 - 2000) * 12.3685);
