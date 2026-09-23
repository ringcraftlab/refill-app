import type { Layout, PageKey, PartKind } from '../types';
import type { Color, Primitive } from './draw';
import type { Palette } from './palette';
import { paletteOf } from './palette';
import {
  daysInMonth, holidayOf, monthGrid, monthLabelText, monthSubText, orderedWeekdays, rokuyoLabel,
  sheetDays, weekdayLabel,
} from './dates';
import { MONTHLY_HEADER_MM, ringsOnTop, weekSplit } from './layout';
import type { Rect } from './layout';

// Every part draws into whatever millimetre rectangle the layout hands it. A
// part never assumes it owns the page, so widening one by dragging a border
// just means it gets a bigger rectangle.

const PAD = 1.2;
// Fixed bands, kept out of the row division: the week rows only ever share
// what is left, so the label and header keep their height whatever the row
// count is.
const MONTH_LABEL_H = 5;

// Rough advance width, in millimetres. A kana or a kanji takes an em, a digit
// or a Latin letter a little over half. Only ever used to set one label
// against another, where a fraction of a millimetre out cannot be seen.
const PT_MM = 25.4 / 72;
const textWidthMm = (text: string, sizePt: number): number =>
  [...text].reduce((w, c) => w + (/[^\u0020-\u00ff]/.test(c) ? 1 : 0.56), 0) * sizePt * PT_MM;

// The month, with the year small beside it. A refill outlives the year it was
// printed for and ends up filed with three others that look exactly like it,
// so the year has to be on the sheet -- but it is not what anyone reads when
// they pick one up, so it sits at half the size on the same baseline.
function monthLabel(x: number, y: number, layout: Layout, sizePt: number): Primitive[] {
  const pal = paletteOf(layout);
  const month = monthLabelText(layout.month, layout.words);
  return [
    { type: 'text', x, y, text: month, sizePt, color: pal.ink, align: 'left' },
    {
      type: 'text', x: x + textWidthMm(month, sizePt) + sizePt * PT_MM * 0.3, y,
      text: String(layout.year), sizePt: sizePt * 0.55, color: pal.inkSoft, align: 'left',
    },
  ];
}
// Shared with the spread geometry, which reserves the same header on both
// pages so the week rows come out the same height.
const DOW_HEADER_H = MONTHLY_HEADER_MM;

const dowColor = (dow: number, pal: Palette): Color =>
  (dow === 0 ? pal.sunday : dow === 6 ? pal.saturday : pal.ink);

// A public holiday reads as a Sunday whatever weekday it falls on, which is
// what every printed calendar does.
const dateColor = (date: Date, pal: Palette): Color =>
  (holidayOf(date) ? pal.sunday : dowColor(date.getDay(), pal));

function inset(area: Rect) {
  return {
    left: area.x + PAD,
    right: area.x + area.w - PAD,
    top: area.y + PAD,
    bottom: area.y + area.h - PAD,
  };
}

export const weekCount = (layout: Layout): number =>
  monthGrid(layout.year, layout.month, layout.weekStart).length;


interface MonthlySlice {
  // Slice of the seven weekday columns. The grid is always seven columns; a
  // spread just gives each page some of them.
  cols: [number, number];
  rows: [number, number];
  // 'reserve' keeps the band empty so a facing page's grid starts level.
  monthLabel: 'show' | 'reserve' | 'none';
  // The three-weekday page of a spread gets one extra column, so all seven
  // weekday columns come out the same width across the spread instead of the
  // three-column side being fatter. Printed refills do the same and use that
  // column for the month block and a free cell per week.
  indexColumn?: boolean;
  // The index column carries next month's mini calendar, but only the band
  // has a clear button for it, so anywhere else it stays off.
  miniMonth?: boolean;
}

export function drawMonthly(area: Rect, layout: Layout, slice: MonthlySlice): Primitive[] {
  const [colStart, colEnd] = slice.cols;
  const weeks = monthGrid(layout.year, layout.month, layout.weekStart).slice(slice.rows[0], slice.rows[1]);
  const dayCols = colEnd - colStart;
  const lead = slice.indexColumn ? 1 : 0;
  const nCols = lead + dayCols;
  if (dayCols <= 0 || weeks.length === 0) return [];

  const pal = paletteOf(layout);
  const { left, right, top, bottom } = inset(area);
  const width = right - left;
  const gridTop = top + (slice.monthLabel === 'none' ? 0 : MONTH_LABEL_H);
  const bodyTop = gridTop + DOW_HEADER_H;
  const colW = width / nCols;
  const rowH = (bottom - bodyTop) / weeks.length;
  if (width <= 0 || rowH <= 0) return [];

  const out: Primitive[] = [];

  if (slice.monthLabel === 'show') {
    out.push(...monthLabel(left, top + MONTH_LABEL_H - 1.3, layout, 9));
  }

  // Printed refills leave the weekday row unshaded; the rule under it is
  // enough to separate it.
  const dows = orderedWeekdays(layout.weekStart);
  if (lead) {
    out.push({
      type: 'text', x: left + colW * 0.5, y: gridTop + DOW_HEADER_H - 1.1,
      text: String(layout.year), sizePt: 5, color: pal.inkSoft, align: 'center',
    });
  }
  for (let c = 0; c < dayCols; c++) {
    const dow = dows[colStart + c];
    out.push({
      type: 'text', x: left + colW * (lead + c + 0.5), y: gridTop + DOW_HEADER_H - 1.1,
      text: weekdayLabel(dow, layout.words), sizePt: 5, color: dowColor(dow, pal), align: 'center',
    });
  }

  if (lead) {
    // The month block sits in the first free cell; the cells below it stay
    // empty, which is the per-week memo space.
    const cx = left + colW * 0.5;
    out.push({
      type: 'text', x: cx, y: bodyTop + Math.min(rowH * 0.55, 9),
      text: String(layout.month), sizePt: Math.min(20, rowH * 1.4), color: pal.ink, align: 'center',
    });
    out.push({
      type: 'text', x: cx, y: bodyTop + Math.min(rowH * 0.8, 13),
      text: monthSubText(layout.month, layout.words), sizePt: 6, color: pal.inkSoft, align: 'center',
    });
    if (slice.miniMonth !== false && layout.showNextMonth && weeks.length >= 2) {
      out.push(...drawMiniMonth({ x: left, y: bodyTop + rowH, w: colW, h: rowH }, layout));
    }
  }

  out.push({ type: 'rect', x: left, y: gridTop, w: width, h: bottom - gridTop, stroke: pal.rule, strokeMm: 0.25 });
  out.push({ type: 'line', x1: left, y1: bodyTop, x2: right, y2: bodyTop, stroke: pal.rule, strokeMm: 0.2 });
  // Columns divide this page's width among the columns it got, so a 3/4 spread
  // has wider cells on the four-column page — same as a printed refill.
  for (let c = 1; c < nCols; c++) {
    const x = left + colW * c;
    out.push({ type: 'line', x1: x, y1: gridTop, x2: x, y2: bottom, stroke: pal.ruleLight, strokeMm: 0.15 });
  }
  for (let r = 1; r < weeks.length; r++) {
    const y = bodyTop + rowH * r;
    out.push({ type: 'line', x1: left, y1: y, x2: right, y2: y, stroke: pal.ruleLight, strokeMm: 0.15 });
  }

  // The printed refills set the six-day label beside the date on the same
  // line, not underneath it. A holiday's name goes on the line below, which
  // needs both a wide enough column and a tall enough row.
  const roomForRokuyo = colW >= 9;
  const roomForHoliday = colW >= 11 && rowH >= 7;
  for (let r = 0; r < weeks.length; r++) {
    for (let c = 0; c < dayCols; c++) {
      const cell = weeks[r][colStart + c];
      if (!cell) continue;
      const x = left + colW * (lead + c) + 0.9;
      const y = bodyTop + rowH * r;
      out.push({
        type: 'text', x, y: y + 3.2, text: String(cell.getDate()),
        sizePt: 8, color: dateColor(cell, pal), align: 'left',
      });
      if (roomForRokuyo) {
        out.push({
          type: 'text', x: left + colW * (lead + c + 1) - 0.9, y: y + 3.1,
          text: rokuyoLabel(cell), sizePt: 4, color: pal.sunday, align: 'right',
        });
      }
      const holiday = roomForHoliday ? holidayOf(cell) : null;
      if (holiday) {
        // Names run to seven characters, so the type shrinks to whatever the
        // column can hold rather than running into the next cell.
        const fit = Math.min(3.8, (colW - 1.8) / holiday.length * 2.6);
        out.push({
          type: 'text', x, y: y + 6.4, text: holiday,
          sizePt: fit, color: pal.sunday, align: 'left',
        });
      }
    }
  }
  return out;
}

// Below this the mini calendar has no room to say anything, so it is left out.
const MINI_PAD = 1.4;
const MINI_MIN = 11;

// Next month tucked into a free index cell, the way printed refills do it.
function drawMiniMonth(cell: Rect, layout: Layout): Primitive[] {
  const pal = paletteOf(layout);
  const year = layout.month === 12 ? layout.year + 1 : layout.year;
  const month = layout.month === 12 ? 1 : layout.month + 1;
  const weeks = monthGrid(year, month, layout.weekStart);

  const left = cell.x + MINI_PAD, top = cell.y + MINI_PAD;
  const w = cell.w - MINI_PAD * 2, h = cell.h - MINI_PAD * 2;
  if (w < MINI_MIN || h < MINI_MIN) return [];

  const out: Primitive[] = [
    {
      type: 'text', x: left, y: top + 2.2, text: monthLabelText(month, layout.words),
      sizePt: 4.5, color: pal.inkSoft, align: 'left',
    },
  ];
  const gridTop = top + 3.2;
  const colW = w / 7;
  const rowH = (h - 3.2) / weeks.length;
  if (rowH < 1.6) return out;

  weeks.forEach((week, r) => week.forEach((d, c) => {
    if (!d) return;
    out.push({
      type: 'text',
      x: left + colW * (c + 0.5), y: gridTop + rowH * (r + 0.8),
      text: String(d.getDate()), sizePt: 3.2,
      color: dateColor(d, pal), align: 'center',
    });
  }));
  return out;
}

// Where that mini calendar sits, so the editor can offer to clear it.
export function nextMonthCell(area: Rect, layout: Layout): Rect | null {
  // The mini calendar lives in the index column, which only a spread whose
  // pages sit side by side has.
  if (!layout.spanning || ringsOnTop(layout)) return null;
  const weeks = weekCount(layout);
  if (weeks < 2) return null;
  const { left, right, top, bottom } = inset(area);
  const bodyTop = top + DOW_HEADER_H;
  const rowH = (bottom - bodyTop) / weeks;
  const cell = { x: left, y: bodyTop + rowH, w: (right - left) / 4, h: rowH };
  // Squeeze the calendar out and its clear button has to go too; an X over
  // nothing is the worst kind of control.
  if (cell.w - MINI_PAD * 2 < MINI_MIN || cell.h - MINI_PAD * 2 < MINI_MIN) return null;
  return cell;
}

export function drawSpanningMonthly(area: Rect, page: PageKey, layout: Layout): Primitive[] {
  const rows = weekCount(layout);
  if (ringsOnTop(layout)) {
    // The pages stack, so five weeks go three on the first and two on the
    // second, which leaves the second page room to write.
    const [topRows] = weekSplit(rows);
    return drawMonthly(area, layout, {
      cols: [0, 7],
      rows: page === 'left' ? [0, topRows] : [topRows, rows],
      monthLabel: page === 'left' ? 'show' : 'none',
    });
  }
  // The month lives in the left page's index column, so neither page needs a
  // label band on top and both grids start level across the gutter.
  return drawMonthly(area, layout, {
    cols: page === 'left' ? [0, 3] : [3, 7],
    rows: [0, rows],
    monthLabel: 'none',
    indexColumn: page === 'left',
    miniMonth: true,
  });
}

function ruled(area: Rect, title: string | null, pitch: number, pal: Palette): Primitive[] {
  const { left, right, top, bottom } = inset(area);
  const out: Primitive[] = [];
  let y = top;
  if (title) {
    out.push({ type: 'text', x: left, y: top + 2.8, text: title, sizePt: 5.5, color: pal.inkSoft, align: 'left' });
    y = top + 4.6;
  }
  for (; y <= bottom; y += pitch) {
    out.push({ type: 'line', x1: left, y1: y, x2: right, y2: y, stroke: pal.ruleLight, strokeMm: 0.15 });
  }
  return out;
}

// A picture fills its area, cropped rather than squashed -- a photo in a
// frame. With nothing in it yet, a hairline says where it will go; it is
// faint enough to be no worse than a ruling if it ever reaches paper.
export function drawPhoto(area: Rect, layout: Layout): Primitive[] {
  if (layout.slotPhoto) {
    return [{ type: 'image', ...area, src: layout.slotPhoto, fit: 'cover' }];
  }
  // A slot with no picture prints nothing. It used to print a dashed frame,
  // which is a thing nobody asked to have on their paper -- the frame is
  // there to say "choose one", and saying it belongs on the screen.
  return [];
}

export const drawMemo = (area: Rect, pal: Palette): Primitive[] => ruled(area, 'MEMO', 5, pal);
export const drawLines = (area: Rect, pal: Palette): Primitive[] => ruled(area, null, 6, pal);

// A row this short is a line you cannot write on. It is what a 31-row list
// in the 90mm column the fit rule asks for comes out at, so it is the floor
// everywhere else too.
export const DAYLIST_MIN_ROW_MM = 2.5;
// The date and its weekday need this much before any writing space starts.
export const DAYLIST_MIN_COL_MM = 17.6;

// How many columns the month is folded into. One is the usual list. A turned
// refill is 62mm tall, where 31 rows would be 1.4mm each, so the days fold
// into two or three columns the way a printed one-month list does -- the
// area decides, nothing is set by hand.
export function dayListColumns(area: Rect, days: number): number {
  const w = area.w - PAD * 2;
  const h = area.h - PAD * 2 - MONTH_LABEL_H;
  for (let n = 1; n <= 3; n++) {
    const rows = Math.ceil(days / n);
    if (h / rows >= DAYLIST_MIN_ROW_MM && w / n >= DAYLIST_MIN_COL_MM) return n;
  }
  return 1;
}

// The month as a list of days, which list-style refills use beside a grid
// calendar. Every day gets a row whether or not anything happens on it, so the
// row height is the whole design: too short and the dates touch.
// `range` is the run of dates this page carries, 1-based and inclusive. A
// spread hands each page half the month rather than cutting every row down
// the middle.
export function drawDayList(area: Rect, layout: Layout, range?: [number, number]): Primitive[] {
  const pal = paletteOf(layout);
  const { left, right, top, bottom } = inset(area);
  const [first, last] = range ?? [1, daysInMonth(layout.year, layout.month)];
  const days = last - first + 1;
  const gridTop = top + MONTH_LABEL_H;
  const width = right - left;
  const cols = dayListColumns(area, days);
  const rows = Math.ceil(days / cols);
  const colW = width / cols;
  const rowH = (bottom - gridTop) / rows;
  if (rowH <= 0 || colW <= 0) return [];

  const out: Primitive[] = monthLabel(left, top + MONTH_LABEL_H - 1.3, layout, 7);

  out.push({ type: 'rect', x: left, y: gridTop, w: width, h: bottom - gridTop, stroke: pal.rule, strokeMm: 0.25 });

  // A narrow column for the date and its weekday, the rest to write in.
  const gutter = Math.min(9, colW * 0.34);
  for (let c = 0; c < cols; c++) {
    const x = left + colW * c;
    if (c > 0) out.push({ type: 'line', x1: x, y1: gridTop, x2: x, y2: bottom, stroke: pal.rule, strokeMm: 0.2 });
    out.push({ type: 'line', x1: x + gutter, y1: gridTop, x2: x + gutter, y2: bottom, stroke: pal.ruleLight, strokeMm: 0.15 });
  }

  for (let i = 0; i < days; i++) {
    const d = first + i;
    const date = new Date(layout.year, layout.month - 1, d);
    const col = Math.floor(i / rows);
    const x = left + colW * col;
    const y = gridTop + rowH * (i % rows);
    if (i % rows > 0) {
      out.push({ type: 'line', x1: x, y1: y, x2: x + colW, y2: y, stroke: pal.ruleLight, strokeMm: 0.12 });
    }
    const colour = dateColor(date, pal);
    const base = y + rowH * 0.74;
    out.push({
      type: 'text', x: x + 0.8, y: base, text: String(d),
      sizePt: Math.min(6.5, rowH * 1.7), color: colour, align: 'left',
    });
    out.push({
      type: 'text', x: x + gutter - 0.8, y: base, text: weekdayLabel(date.getDay(), layout.words)[0],
      sizePt: Math.min(4.5, rowH * 1.2), color: colour, align: 'right',
    });
  }
  return out;
}

export function drawTodo(area: Rect, pal: Palette): Primitive[] {
  const { left, right, top, bottom } = inset(area);
  const out: Primitive[] = [
    { type: 'text', x: left, y: top + 2.8, text: 'TO DO', sizePt: 5.5, color: pal.inkSoft, align: 'left' },
  ];
  const pitch = 6, box = 2.4;
  for (let y = top + 7; y <= bottom; y += pitch) {
    out.push({ type: 'rect', x: left, y: y - box, w: box, h: box, stroke: pal.rule, strokeMm: 0.2 });
    out.push({ type: 'line', x1: left + box + 1.2, y1: y, x2: right, y2: y, stroke: pal.ruleLight, strokeMm: 0.15 });
  }
  return out;
}

export function drawGoal(area: Rect, pal: Palette): Primitive[] {
  const { left, right, top, bottom } = inset(area);
  const out: Primitive[] = [
    { type: 'rect', x: left, y: top, w: right - left, h: bottom - top, stroke: pal.rule, strokeMm: 0.25 },
    { type: 'text', x: left + 1.5, y: top + 3.6, text: 'GOAL', sizePt: 5.5, color: pal.ink, align: 'left' },
    { type: 'line', x1: left, y1: top + 5, x2: right, y2: top + 5, stroke: pal.rule, strokeMm: 0.2 },
  ];
  for (let y = top + 10; y <= bottom - 1.5; y += 5) {
    out.push({ type: 'line', x1: left + 1.5, y1: y, x2: right - 1.5, y2: y, stroke: pal.ruleLight, strokeMm: 0.15 });
  }
  return out;
}

export function drawBudget(area: Rect, pal: Palette): Primitive[] {
  const { left, right, top, bottom } = inset(area);
  const gridTop = top + 4.4;
  // A ruled column on the right for amounts, which is what makes this a
  // ledger rather than plain lines.
  const amountX = right - Math.min(18, (right - left) * 0.32);
  const out: Primitive[] = [
    { type: 'text', x: left, y: top + 2.8, text: 'BUDGET', sizePt: 5.5, color: pal.inkSoft, align: 'left' },
    { type: 'rect', x: left, y: gridTop, w: right - left, h: bottom - gridTop, stroke: pal.rule, strokeMm: 0.2 },
    { type: 'line', x1: amountX, y1: gridTop, x2: amountX, y2: bottom, stroke: pal.rule, strokeMm: 0.2 },
  ];
  for (let y = gridTop + 5; y < bottom; y += 5) {
    out.push({ type: 'line', x1: left, y1: y, x2: right, y2: y, stroke: pal.ruleLight, strokeMm: 0.15 });
  }
  return out;
}

export function drawGrid(area: Rect, pal: Palette, pitch = 5): Primitive[] {
  const { left, right, top, bottom } = inset(area);
  const out: Primitive[] = [];
  for (let y = top; y <= bottom; y += pitch) {
    out.push({ type: 'line', x1: left, y1: y, x2: right, y2: y, stroke: pal.ruleLight, strokeMm: 0.15 });
  }
  for (let x = left; x <= right; x += pitch) {
    out.push({ type: 'line', x1: x, y1: top, x2: x, y2: bottom, stroke: pal.ruleLight, strokeMm: 0.15 });
  }
  return out;
}

export function drawHabit(area: Rect, layout: Layout): Primitive[] {
  const pal = paletteOf(layout);
  const { left, right, top, bottom } = inset(area);
  const out: Primitive[] = [];
  out.push({ type: 'text', x: left, y: top + 2.8, text: 'HABIT', sizePt: 5.5, color: pal.inkSoft, align: 'left' });

  const gridTop = top + 4.4;
  const nameW = Math.min(14, (right - left) * 0.3);
  const rows = Math.max(1, layout.habitCount);
  const rowH = (bottom - gridTop) / rows;
  if (rowH <= 0) return out;

  const days = monthGrid(layout.year, layout.month, layout.weekStart).flat().filter(Boolean).length;
  const colW = (right - left - nameW) / days;

  out.push({ type: 'rect', x: left, y: gridTop, w: right - left, h: bottom - gridTop, stroke: pal.rule, strokeMm: 0.2 });
  out.push({ type: 'line', x1: left + nameW, y1: gridTop, x2: left + nameW, y2: bottom, stroke: pal.rule, strokeMm: 0.2 });
  for (let r = 1; r < rows; r++) {
    const y = gridTop + rowH * r;
    out.push({ type: 'line', x1: left, y1: y, x2: right, y2: y, stroke: pal.ruleLight, strokeMm: 0.15 });
  }
  if (colW >= 1.2) {
    for (let d = 1; d < days; d++) {
      const x = left + nameW + colW * d;
      out.push({ type: 'line', x1: x, y1: gridTop, x2: x, y2: bottom, stroke: pal.ruleLight, strokeMm: 0.1 });
    }
  }
  return out;
}


// One grid for everything with a date on one axis. A weekly vertical, a gantt
// chart and a habit tracker differ only in which way the dates run, how far
// they reach, and what fills the other axis -- so they are one function with
// three sets of arguments rather than three functions that drift apart.
export interface DateGridSpec {
  title: string;
  // Which way the dates run.
  dates: 'columns' | 'rows';
  // How far they reach. 'month' is every day of the layout's month. 'days' is
  // the run of days this one sheet carries -- seven for a week to a spread --
  // which is what makes a weekly grid dated.
  span: 'month' | 'days';
  // What fills the other axis.
  cross:
    | { kind: 'time'; fromHour: number; toHour: number }
    | { kind: 'lanes'; count: number; named: boolean };
  // Which slice of the date axis this grid draws, when a spread gives each
  // page some of the days. Omitted means all of them.
  range?: [number, number];
  // How many bands the days are folded into. Seven columns down one band is
  // 10mm each on a Bible page, which is a week you can see but not write in;
  // folded into two, the same page gives 18mm and two shorter days. Printed
  // one-page weeklies are nearly all this shape.
  tiers?: number;
}

const TITLE_H = 4.4;
const AXIS_H = 3.2;
// A column narrower than this has no room for the hour and the writing both,
// so it keeps the writing and leans on the scale down the side.
const HOUR_IN_COLUMN_MM = 8;

export function drawDateGrid(area: Rect, layout: Layout, spec: DateGridSpec): Primitive[] {
  // The days on the date axis, as dates. A month grid runs the month; a
  // weekly runs whatever days this sheet covers.
  const axis = spec.span === 'month'
    ? Array.from({ length: daysInMonth(layout.year, layout.month) },
        (_, i) => new Date(layout.year, layout.month - 1, i + 1))
    : sheetDays(layout);
  const [from, to] = spec.range ?? [0, axis.length];

  // Folded, each band is the same grid over fewer days, so it is this
  // function again on a slice of the area rather than a second way of
  // drawing one. Each band brings its own hour scale with it, which is the
  // point: the days on the lower band are a page-width away from the upper
  // band's, and a scale they cannot reach is not a scale.
  const tiers = Math.max(1, Math.round(spec.tiers ?? 1));
  if (tiers > 1 && spec.dates === 'columns' && to - from > 1) {
    const per = Math.ceil((to - from) / tiers);
    const bandH = area.h / tiers;
    const out: Primitive[] = [];
    for (let t = 0; t < tiers; t++) {
      const a = from + per * t;
      if (a >= to) break;
      out.push(...drawDateGrid(
        { ...area, y: area.y + bandH * t, h: bandH },
        layout,
        // The title belongs to the part, not to each band of it.
        { ...spec, tiers: 1, range: [a, Math.min(to, a + per)], title: t === 0 ? spec.title : '' },
      ));
    }
    return out;
  }

  const pal = paletteOf(layout);
  const { left, right, top, bottom } = inset(area);
  const width = right - left;
  const out: Primitive[] = [];
  if (spec.title) {
    out.push({ type: 'text', x: left, y: top + 2.8, text: spec.title, sizePt: 5.5, color: pal.inkSoft, align: 'left' });
  }

  const dateCount = to - from;
  const dayAt = (i: number) => axis[from + i];
  // A month grid has a column per day and no room to say which weekday it is;
  // a weekly has few enough columns to name them.
  const dateText = (i: number) => {
    const d = dayAt(i);
    return spec.span === 'month'
      ? String(d.getDate())
      : `${d.getDate()} ${weekdayLabel(d.getDay(), layout.words)}`;
  };
  const dateTone = (i: number) => dateColor(dayAt(i), pal);

  // Bound once so the kind narrows; reading spec.cross each time does not.
  const cross = spec.cross;
  const timed = cross.kind === 'time';
  const crossCount = cross.kind === 'time' ? cross.toHour - cross.fromHour : cross.count;
  const crossText = (i: number) => (cross.kind === 'time' ? String(cross.fromHour + i) : '');
  // Hours always need their labels; free lanes only when they are to be named.
  const crossGutter = cross.kind === 'time' || cross.named;
  if (crossCount < 1 || dateCount < 1) return out;

  const gridTop = top + TITLE_H;
  const acrossDates = spec.dates === 'columns';
  // The axis that carries the dates gets a header band; the other gets a
  // gutter, when there is anything to write in it.
  const gutter = acrossDates
    ? (crossGutter ? Math.min(12, width * 0.26) : 0)
    : Math.min(10, width * 0.22);
  const header = acrossDates ? AXIS_H : (crossGutter && crossCount > 1 ? AXIS_H : 0);

  const bodyL = left + gutter;
  const bodyT = gridTop + header;
  const bodyW = right - bodyL;
  const bodyH = bottom - bodyT;
  if (bodyW <= 0 || bodyH <= 0) return out;

  const cols = acrossDates ? dateCount : crossCount;
  const rows = acrossDates ? crossCount : dateCount;
  const colW = bodyW / cols;
  const rowH = bodyH / rows;

  out.push({ type: 'rect', x: left, y: gridTop, w: width, h: bottom - gridTop, stroke: pal.rule, strokeMm: 0.2 });
  if (gutter > 0) out.push({ type: 'line', x1: bodyL, y1: gridTop, x2: bodyL, y2: bottom, stroke: pal.rule, strokeMm: 0.2 });
  if (header > 0) out.push({ type: 'line', x1: left, y1: bodyT, x2: right, y2: bodyT, stroke: pal.rule, strokeMm: 0.2 });

  // Rules only where they can still be told apart.
  if (colW >= 1.2) {
    for (let c = 1; c < cols; c++) {
      const x = bodyL + colW * c;
      out.push({ type: 'line', x1: x, y1: gridTop, x2: x, y2: bottom, stroke: pal.ruleLight, strokeMm: 0.1 });
    }
  }
  if (rowH >= 1.2) {
    for (let r = 1; r < rows; r++) {
      const y = bodyT + rowH * r;
      out.push({ type: 'line', x1: left, y1: y, x2: right, y2: y, stroke: pal.ruleLight, strokeMm: 0.15 });
    }
  }

  // The dates themselves.
  for (let i = 0; i < dateCount; i++) {
    const size = Math.min(4.6, (acrossDates ? colW : rowH) * 1.8);
    if (size < 2.4) break;
    if (acrossDates) {
      out.push({
        type: 'text', x: bodyL + colW * (i + 0.5), y: bodyT - 0.9,
        text: dateText(i), sizePt: size, color: dateTone(i), align: 'center',
      });
    } else {
      // Two thirds down a thin row is the middle of it; two thirds down a
      // day-sized block is the middle of nowhere, so the date stops just
      // under the line once the row is tall enough to write in.
      out.push({
        type: 'text', x: left + 0.8, y: bodyT + rowH * i + Math.min(rowH * 0.66, size * 0.9),
        text: dateText(i), sizePt: size, color: dateTone(i), align: 'left',
      });
    }
  }

  // The hours, when there are any.
  if (timed) {
    for (let i = 0; i < crossCount; i++) {
      const size = Math.min(4, (acrossDates ? rowH : colW) * 1.5);
      if (size < 2.2) break;
      if (acrossDates) {
        out.push({
          type: 'text', x: bodyL - 0.8, y: bodyT + rowH * i + rowH * 0.7,
          text: crossText(i), sizePt: size, color: pal.inkSoft, align: 'right',
        });
        // And again inside every day, not once down the far left. On a spread
        // the far column is most of a hand's width from that scale, and
        // counting rows back to it is exactly what a printed vertical spares
        // you. Faint and hard against the rule, so the hour is there to be
        // found rather than in the way of what gets written beside it.
        if (colW >= HOUR_IN_COLUMN_MM) {
          for (let d = 0; d < dateCount; d++) {
            out.push({
              type: 'text', x: bodyL + colW * d + 0.7, y: bodyT + rowH * i + rowH * 0.7,
              text: crossText(i), sizePt: Math.min(size, 3), color: pal.inkFaint, align: 'left',
            });
          }
        }
      } else {
        out.push({
          type: 'text', x: bodyL + colW * (i + 0.5), y: bodyT - 0.9,
          text: crossText(i), sizePt: size, color: pal.inkSoft, align: 'center',
        });
      }
    }
  }
  return out;
}

// A sheet of one day is a daily, seven is a weekly, and the rest say how many
// days they hold rather than pretending to be either.
const runTitle = (l: Layout): string => {
  const n = Math.max(1, l.daysPerSheet);
  return n === 1 ? 'DAILY' : n === 7 ? 'WEEKLY' : `${n} DAYS`;
};

// What the tray's stamps actually are: the same grid with different arguments.
// The names people use, not the parameters underneath.
const DATE_GRIDS: Partial<Record<PartKind, (l: Layout) => DateGridSpec>> = {
  habit: l => ({
    title: 'HABIT', dates: 'columns', span: 'month',
    cross: { kind: 'lanes', count: Math.max(1, l.habitCount), named: true },
  }),
  gantt: () => ({
    title: 'GANTT', dates: 'columns', span: 'month',
    cross: { kind: 'lanes', count: 8, named: true },
  }),
  weekvert: l => ({
    title: runTitle(l), dates: 'columns', span: 'days',
    cross: { kind: 'time', fromHour: l.dayStartHour, toHour: l.dayEndHour },
    tiers: l.weekTiers,
  }),
  weekhoriz: l => ({
    title: runTitle(l), dates: 'rows', span: 'days',
    cross: { kind: 'lanes', count: 1, named: false },
  }),
};

export function drawPart(kind: PartKind, area: Rect, layout: Layout): Primitive[] {
  const grid = DATE_GRIDS[kind];
  if (grid) return drawDateGrid(area, layout, grid(layout));

  const pal = paletteOf(layout);
  switch (kind) {
    case 'monthly':
      return drawMonthly(area, layout, { cols: [0, 7], rows: [0, weekCount(layout)], monthLabel: 'show' });
    case 'daylist': return drawDayList(area, layout);
    case 'todo': return drawTodo(area, pal);
    case 'goal': return drawGoal(area, pal);
    case 'budget': return drawBudget(area, pal);
    case 'photo': return drawPhoto(area, layout);
    case 'grid': return drawGrid(area, pal);
    case 'lines': return drawLines(area, pal);
    case 'memo': return drawMemo(area, pal);
    // Everything with a date on an axis was handled above.
    default: return [];
  }
}

// A part narrower than this either side of the gutter is barely on that page
// at all; breaking its content into the sliver reads worse than letting the
// page edge trim it.
const ACROSS_MIN_MM = 8;
// Splitting the weeks across stacked sheets draws the same seven columns
// twice, so the two sheets have to be near enough the same width or the
// calendar changes size at the seam.
const ACROSS_EVEN_SHARE = 0.8;

// Gives each page a whole number of columns, as near the same width as the
// division allows. The three-and-four a printed refill uses falls out of this
// when the gutter lands in the middle: the narrower side takes the index
// column and every weekday comes out the same width.
function shareColumns(aW: number, bW: number, total: number, allowIndex: boolean) {
  let best = { cut: Math.max(1, Math.round(total / 2)), index: false, cost: Infinity };
  for (const index of allowIndex ? [false, true] : [false]) {
    for (let cut = 1; cut < total; cut++) {
      const cost = Math.abs(aW / (cut + (index ? 1 : 0)) - bW / (total - cut));
      if (cost < best.cost - 1e-9) best = { cut, index, cost };
    }
  }
  return best;
}

// What a part looks like when its area crosses the gutter. Crossing is fine --
// printed refills do it all the time -- but the two halves are separate sheets
// with a ring binder between them, so a day must not be cut down the middle:
// each page takes whole days instead. Parts with nothing to break along, like
// a memo, return null and are simply trimmed by the page edge.
export function drawPartAcross(kind: PartKind, a: Rect, b: Rect, layout: Layout): Primitive[] | null {
  const wider = a.w >= b.w ? a : b;
  // Pages side by side read as one wide page, so a week can run across the
  // gutter. Pages that stack cannot: the far end of the week would sit on the
  // sheet below, which no calendar does.
  const stacked = ringsOnTop(layout);

  if (kind === 'monthly') {
    const rows = weekCount(layout);
    if (stacked) {
      if (Math.min(a.w, b.w) < Math.max(a.w, b.w) * ACROSS_EVEN_SHARE) {
        return drawPart(kind, wider, layout);
      }
      // Weeks split the way the band splits them -- three sheets up, two
      // down -- and the second page's rows are held to the first page's
      // height so the grid does not change size across the seam.
      const [topRows, bottomRows] = weekSplit(rows);
      const rowH = (a.h - PAD * 2 - MONTH_LABEL_H - DOW_HEADER_H) / topRows;
      const shortH = rowH * bottomRows + DOW_HEADER_H + PAD * 2;
      return [
        ...drawMonthly(a, layout, { cols: [0, 7], rows: [0, topRows], monthLabel: 'show' }),
        ...drawMonthly({ ...b, h: Math.min(b.h, shortH) }, layout, {
          cols: [0, 7], rows: [topRows, rows], monthLabel: 'none',
        }),
      ];
    }

    const { cut, index } = shareColumns(a.w, b.w, 7, true);
    return [
      ...drawMonthly(a, layout, {
        cols: [0, cut], rows: [0, rows],
        monthLabel: index ? 'none' : 'show', indexColumn: index, miniMonth: false,
      }),
      ...drawMonthly(b, layout, {
        cols: [cut, 7], rows: [0, rows], monthLabel: index ? 'none' : 'reserve',
      }),
    ];
  }

  if (kind === 'daylist') {
    // Half the month a page: the row count is what decides this, not the
    // widths, and it is the split printed month-on-a-spread refills use.
    const days = daysInMonth(layout.year, layout.month);
    const cut = Math.ceil(days / 2);
    return [
      ...drawDayList(a, layout, [1, cut]),
      ...drawDayList(b, layout, [cut + 1, days]),
    ];
  }

  const grid = DATE_GRIDS[kind];
  if (grid) {
    const spec = grid(layout);
    const total = spec.span === 'month'
      ? daysInMonth(layout.year, layout.month)
      : Math.max(1, layout.daysPerSheet);
    // Half the days on each page. Letting a row run on across the gutter
    // instead leaves the second page a blank continuation with nothing to say
    // which day its lines belong to, whichever way the pages lie; a part with
    // dates on an axis divides at a day, like every other dated part does.
    // Rows divide along the height the pages share, columns along their
    // widths.
    const along = spec.dates === 'rows'
      ? shareColumns(a.h, b.h, total, false)
      : shareColumns(a.w, b.w, total, false);
    return [
      ...drawDateGrid(a, layout, { ...spec, range: [0, along.cut] }),
      // The title belongs to the part, not to each page of it.
      ...drawDateGrid(b, layout, { ...spec, title: '', range: [along.cut, total] }),
    ];
  }
  return null;
}
