import type { Layout, PageKey, PartKind } from '../types';
import type { Color, Primitive } from './draw';
import { INK, INK_SOFT, RULE, RULE_LIGHT, SATURDAY, SUNDAY } from './draw';
import { daysInMonth, monthGrid, orderedWeekdays, rokuyoLabel, weekdayLabel } from './dates';
import { isLandscape, MONTHLY_HEADER_MM, weekSplit } from './layout';
import type { Rect } from './layout';

// Every part draws into whatever millimetre rectangle the layout hands it. A
// part never assumes it owns the page, so widening one by dragging a border
// just means it gets a bigger rectangle.

const PAD = 1.2;
// Fixed bands, kept out of the row division: the week rows only ever share
// what is left, so the label and header keep their height whatever the row
// count is.
const MONTH_LABEL_H = 5;
// Shared with the spread geometry, which reserves the same header on both
// pages so the week rows come out the same height.
const DOW_HEADER_H = MONTHLY_HEADER_MM;

const dowColor = (dow: number): Color => (dow === 0 ? SUNDAY : dow === 6 ? SATURDAY : INK);

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

const EN_MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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

  const { left, right, top, bottom } = inset(area);
  const width = right - left;
  const gridTop = top + (slice.monthLabel === 'none' ? 0 : MONTH_LABEL_H);
  const bodyTop = gridTop + DOW_HEADER_H;
  const colW = width / nCols;
  const rowH = (bottom - bodyTop) / weeks.length;
  if (width <= 0 || rowH <= 0) return [];

  const out: Primitive[] = [];

  if (slice.monthLabel === 'show') {
    out.push({
      type: 'text', x: left, y: top + MONTH_LABEL_H - 1.3,
      text: `${layout.month}月`, sizePt: 9, color: INK, align: 'left',
    });
  }

  // Printed refills leave the weekday row unshaded; the rule under it is
  // enough to separate it.
  const dows = orderedWeekdays(layout.weekStart);
  if (lead) {
    out.push({
      type: 'text', x: left + colW * 0.5, y: gridTop + DOW_HEADER_H - 1.1,
      text: String(layout.year), sizePt: 5, color: INK_SOFT, align: 'center',
    });
  }
  for (let c = 0; c < dayCols; c++) {
    const dow = dows[colStart + c];
    out.push({
      type: 'text', x: left + colW * (lead + c + 0.5), y: gridTop + DOW_HEADER_H - 1.1,
      text: weekdayLabel(dow), sizePt: 5, color: dowColor(dow), align: 'center',
    });
  }

  if (lead) {
    // The month block sits in the first free cell; the cells below it stay
    // empty, which is the per-week memo space.
    const cx = left + colW * 0.5;
    out.push({
      type: 'text', x: cx, y: bodyTop + Math.min(rowH * 0.55, 9),
      text: String(layout.month), sizePt: Math.min(20, rowH * 1.4), color: INK, align: 'center',
    });
    out.push({
      type: 'text', x: cx, y: bodyTop + Math.min(rowH * 0.8, 13),
      text: EN_MONTH[layout.month - 1], sizePt: 6, color: INK_SOFT, align: 'center',
    });
    if (slice.miniMonth !== false && layout.showNextMonth && weeks.length >= 2) {
      out.push(...drawMiniMonth({ x: left, y: bodyTop + rowH, w: colW, h: rowH }, layout));
    }
  }

  out.push({ type: 'rect', x: left, y: gridTop, w: width, h: bottom - gridTop, stroke: RULE, strokeMm: 0.25 });
  out.push({ type: 'line', x1: left, y1: bodyTop, x2: right, y2: bodyTop, stroke: RULE, strokeMm: 0.2 });
  // Columns divide this page's width among the columns it got, so a 3/4 spread
  // has wider cells on the four-column page — same as a printed refill.
  for (let c = 1; c < nCols; c++) {
    const x = left + colW * c;
    out.push({ type: 'line', x1: x, y1: gridTop, x2: x, y2: bottom, stroke: RULE_LIGHT, strokeMm: 0.15 });
  }
  for (let r = 1; r < weeks.length; r++) {
    const y = bodyTop + rowH * r;
    out.push({ type: 'line', x1: left, y1: y, x2: right, y2: y, stroke: RULE_LIGHT, strokeMm: 0.15 });
  }

  // The printed refills set the six-day label beside the date on the same
  // line, not underneath it.
  const roomForRokuyo = colW >= 9;
  for (let r = 0; r < weeks.length; r++) {
    for (let c = 0; c < dayCols; c++) {
      const cell = weeks[r][colStart + c];
      if (!cell) continue;
      const x = left + colW * (lead + c) + 0.9;
      const y = bodyTop + rowH * r;
      out.push({
        type: 'text', x, y: y + 3.2, text: String(cell.getDate()),
        sizePt: 8, color: dowColor(cell.getDay()), align: 'left',
      });
      if (roomForRokuyo) {
        out.push({
          type: 'text', x: left + colW * (lead + c + 1) - 0.9, y: y + 3.1,
          text: rokuyoLabel(cell), sizePt: 4, color: SUNDAY, align: 'right',
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
  const year = layout.month === 12 ? layout.year + 1 : layout.year;
  const month = layout.month === 12 ? 1 : layout.month + 1;
  const weeks = monthGrid(year, month, layout.weekStart);

  const left = cell.x + MINI_PAD, top = cell.y + MINI_PAD;
  const w = cell.w - MINI_PAD * 2, h = cell.h - MINI_PAD * 2;
  if (w < MINI_MIN || h < MINI_MIN) return [];

  const out: Primitive[] = [
    { type: 'text', x: left, y: top + 2.2, text: `${month}月`, sizePt: 4.5, color: INK_SOFT, align: 'left' },
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
      color: dowColor(d.getDay()), align: 'center',
    });
  }));
  return out;
}

// Where that mini calendar sits, so the editor can offer to clear it.
export function nextMonthCell(area: Rect, layout: Layout): Rect | null {
  // The mini calendar lives in the index column, which only the upright
  // spread has.
  if (!layout.spanning || layout.orientation !== 'portrait') return null;
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
  if (layout.orientation === 'landscape') {
    // Five weeks go three on the first page and two on the second, which
    // leaves the second page room to write.
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

function ruled(area: Rect, title: string | null, pitch: number): Primitive[] {
  const { left, right, top, bottom } = inset(area);
  const out: Primitive[] = [];
  let y = top;
  if (title) {
    out.push({ type: 'text', x: left, y: top + 2.8, text: title, sizePt: 5.5, color: INK_SOFT, align: 'left' });
    y = top + 4.6;
  }
  for (; y <= bottom; y += pitch) {
    out.push({ type: 'line', x1: left, y1: y, x2: right, y2: y, stroke: RULE_LIGHT, strokeMm: 0.15 });
  }
  return out;
}

export const drawMemo = (area: Rect): Primitive[] => ruled(area, 'MEMO', 5);
export const drawLines = (area: Rect): Primitive[] => ruled(area, null, 6);

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

  const out: Primitive[] = [{
    type: 'text', x: left, y: top + MONTH_LABEL_H - 1.3,
    text: `${layout.month}月`, sizePt: 7, color: INK, align: 'left',
  }];

  out.push({ type: 'rect', x: left, y: gridTop, w: width, h: bottom - gridTop, stroke: RULE, strokeMm: 0.25 });

  // A narrow column for the date and its weekday, the rest to write in.
  const gutter = Math.min(9, colW * 0.34);
  for (let c = 0; c < cols; c++) {
    const x = left + colW * c;
    if (c > 0) out.push({ type: 'line', x1: x, y1: gridTop, x2: x, y2: bottom, stroke: RULE, strokeMm: 0.2 });
    out.push({ type: 'line', x1: x + gutter, y1: gridTop, x2: x + gutter, y2: bottom, stroke: RULE_LIGHT, strokeMm: 0.15 });
  }

  for (let i = 0; i < days; i++) {
    const d = first + i;
    const date = new Date(layout.year, layout.month - 1, d);
    const col = Math.floor(i / rows);
    const x = left + colW * col;
    const y = gridTop + rowH * (i % rows);
    if (i % rows > 0) {
      out.push({ type: 'line', x1: x, y1: y, x2: x + colW, y2: y, stroke: RULE_LIGHT, strokeMm: 0.12 });
    }
    const colour = dowColor(date.getDay());
    const base = y + rowH * 0.74;
    out.push({
      type: 'text', x: x + 0.8, y: base, text: String(d),
      sizePt: Math.min(6.5, rowH * 1.7), color: colour, align: 'left',
    });
    out.push({
      type: 'text', x: x + gutter - 0.8, y: base, text: weekdayLabel(date.getDay())[0],
      sizePt: Math.min(4.5, rowH * 1.2), color: colour, align: 'right',
    });
  }
  return out;
}

export function drawTodo(area: Rect): Primitive[] {
  const { left, right, top, bottom } = inset(area);
  const out: Primitive[] = [
    { type: 'text', x: left, y: top + 2.8, text: 'TO DO', sizePt: 5.5, color: INK_SOFT, align: 'left' },
  ];
  const pitch = 6, box = 2.4;
  for (let y = top + 7; y <= bottom; y += pitch) {
    out.push({ type: 'rect', x: left, y: y - box, w: box, h: box, stroke: RULE, strokeMm: 0.2 });
    out.push({ type: 'line', x1: left + box + 1.2, y1: y, x2: right, y2: y, stroke: RULE_LIGHT, strokeMm: 0.15 });
  }
  return out;
}

export function drawGoal(area: Rect): Primitive[] {
  const { left, right, top, bottom } = inset(area);
  const out: Primitive[] = [
    { type: 'rect', x: left, y: top, w: right - left, h: bottom - top, stroke: RULE, strokeMm: 0.25 },
    { type: 'text', x: left + 1.5, y: top + 3.6, text: 'GOAL', sizePt: 5.5, color: INK, align: 'left' },
    { type: 'line', x1: left, y1: top + 5, x2: right, y2: top + 5, stroke: RULE, strokeMm: 0.2 },
  ];
  for (let y = top + 10; y <= bottom - 1.5; y += 5) {
    out.push({ type: 'line', x1: left + 1.5, y1: y, x2: right - 1.5, y2: y, stroke: RULE_LIGHT, strokeMm: 0.15 });
  }
  return out;
}

export function drawBudget(area: Rect): Primitive[] {
  const { left, right, top, bottom } = inset(area);
  const gridTop = top + 4.4;
  // A ruled column on the right for amounts, which is what makes this a
  // ledger rather than plain lines.
  const amountX = right - Math.min(18, (right - left) * 0.32);
  const out: Primitive[] = [
    { type: 'text', x: left, y: top + 2.8, text: 'BUDGET', sizePt: 5.5, color: INK_SOFT, align: 'left' },
    { type: 'rect', x: left, y: gridTop, w: right - left, h: bottom - gridTop, stroke: RULE, strokeMm: 0.2 },
    { type: 'line', x1: amountX, y1: gridTop, x2: amountX, y2: bottom, stroke: RULE, strokeMm: 0.2 },
  ];
  for (let y = gridTop + 5; y < bottom; y += 5) {
    out.push({ type: 'line', x1: left, y1: y, x2: right, y2: y, stroke: RULE_LIGHT, strokeMm: 0.15 });
  }
  return out;
}

export function drawGrid(area: Rect, pitch = 5): Primitive[] {
  const { left, right, top, bottom } = inset(area);
  const out: Primitive[] = [];
  for (let y = top; y <= bottom; y += pitch) {
    out.push({ type: 'line', x1: left, y1: y, x2: right, y2: y, stroke: RULE_LIGHT, strokeMm: 0.15 });
  }
  for (let x = left; x <= right; x += pitch) {
    out.push({ type: 'line', x1: x, y1: top, x2: x, y2: bottom, stroke: RULE_LIGHT, strokeMm: 0.15 });
  }
  return out;
}

export function drawHabit(area: Rect, layout: Layout): Primitive[] {
  const { left, right, top, bottom } = inset(area);
  const out: Primitive[] = [];
  out.push({ type: 'text', x: left, y: top + 2.8, text: 'HABIT', sizePt: 5.5, color: INK_SOFT, align: 'left' });

  const gridTop = top + 4.4;
  const nameW = Math.min(14, (right - left) * 0.3);
  const rows = Math.max(1, layout.habitCount);
  const rowH = (bottom - gridTop) / rows;
  if (rowH <= 0) return out;

  const days = monthGrid(layout.year, layout.month, layout.weekStart).flat().filter(Boolean).length;
  const colW = (right - left - nameW) / days;

  out.push({ type: 'rect', x: left, y: gridTop, w: right - left, h: bottom - gridTop, stroke: RULE, strokeMm: 0.2 });
  out.push({ type: 'line', x1: left + nameW, y1: gridTop, x2: left + nameW, y2: bottom, stroke: RULE, strokeMm: 0.2 });
  for (let r = 1; r < rows; r++) {
    const y = gridTop + rowH * r;
    out.push({ type: 'line', x1: left, y1: y, x2: right, y2: y, stroke: RULE_LIGHT, strokeMm: 0.15 });
  }
  if (colW >= 1.2) {
    for (let d = 1; d < days; d++) {
      const x = left + nameW + colW * d;
      out.push({ type: 'line', x1: x, y1: gridTop, x2: x, y2: bottom, stroke: RULE_LIGHT, strokeMm: 0.1 });
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
  // How far they reach. A month is dated from the layout. A week is not: a
  // dated week means 52 sheets a year, and the output is built a month at a
  // time, so weekly grids carry weekday names and no numbers.
  span: 'month' | 'week';
  // What fills the other axis.
  cross:
    | { kind: 'time'; fromHour: number; toHour: number }
    | { kind: 'lanes'; count: number; named: boolean };
  // Which slice of the date axis this grid draws, when a spread gives each
  // page some of the days. Omitted means all of them.
  range?: [number, number];
}

const TITLE_H = 4.4;
const AXIS_H = 3.2;

export function drawDateGrid(area: Rect, layout: Layout, spec: DateGridSpec): Primitive[] {
  const { left, right, top, bottom } = inset(area);
  const width = right - left;
  const out: Primitive[] = [];
  if (spec.title) {
    out.push({ type: 'text', x: left, y: top + 2.8, text: spec.title, sizePt: 5.5, color: INK_SOFT, align: 'left' });
  }

  const dows = orderedWeekdays(layout.weekStart);
  const dated = spec.span === 'month';
  const all = dated ? daysInMonth(layout.year, layout.month) : 7;
  const [from, to] = spec.range ?? [0, all];
  const dateCount = to - from;
  const dateText = (i: number) =>
    dated ? String(from + i + 1) : weekdayLabel(dows[from + i]);
  const dateTone = (i: number) =>
    dated ? dowColor(new Date(layout.year, layout.month - 1, from + i + 1).getDay()) : dowColor(dows[from + i]);

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

  out.push({ type: 'rect', x: left, y: gridTop, w: width, h: bottom - gridTop, stroke: RULE, strokeMm: 0.2 });
  if (gutter > 0) out.push({ type: 'line', x1: bodyL, y1: gridTop, x2: bodyL, y2: bottom, stroke: RULE, strokeMm: 0.2 });
  if (header > 0) out.push({ type: 'line', x1: left, y1: bodyT, x2: right, y2: bodyT, stroke: RULE, strokeMm: 0.2 });

  // Rules only where they can still be told apart.
  if (colW >= 1.2) {
    for (let c = 1; c < cols; c++) {
      const x = bodyL + colW * c;
      out.push({ type: 'line', x1: x, y1: gridTop, x2: x, y2: bottom, stroke: RULE_LIGHT, strokeMm: 0.1 });
    }
  }
  if (rowH >= 1.2) {
    for (let r = 1; r < rows; r++) {
      const y = bodyT + rowH * r;
      out.push({ type: 'line', x1: left, y1: y, x2: right, y2: y, stroke: RULE_LIGHT, strokeMm: 0.15 });
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
      out.push({
        type: 'text', x: left + 0.8, y: bodyT + rowH * i + rowH * 0.66,
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
          text: crossText(i), sizePt: size, color: INK_SOFT, align: 'right',
        });
      } else {
        out.push({
          type: 'text', x: bodyL + colW * (i + 0.5), y: bodyT - 0.9,
          text: crossText(i), sizePt: size, color: INK_SOFT, align: 'center',
        });
      }
    }
  }
  return out;
}

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
  weekvert: () => ({
    title: 'WEEKLY', dates: 'columns', span: 'week',
    cross: { kind: 'time', fromHour: 6, toHour: 24 },
  }),
  weekhoriz: () => ({
    title: 'WEEKLY', dates: 'rows', span: 'week',
    cross: { kind: 'lanes', count: 1, named: false },
  }),
};

export function drawPart(kind: PartKind, area: Rect, layout: Layout): Primitive[] {
  const grid = DATE_GRIDS[kind];
  if (grid) return drawDateGrid(area, layout, grid(layout));

  switch (kind) {
    case 'monthly':
      return drawMonthly(area, layout, { cols: [0, 7], rows: [0, weekCount(layout)], monthLabel: 'show' });
    case 'daylist': return drawDayList(area, layout);
    case 'todo': return drawTodo(area);
    case 'goal': return drawGoal(area);
    case 'budget': return drawBudget(area);
    case 'grid': return drawGrid(area);
    case 'lines': return drawLines(area);
    case 'memo': return drawMemo(area);
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
  const stacked = isLandscape(layout);

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
    // Dates down the side carry on across the gutter the way ruled lines do.
    if (spec.dates !== 'columns') return null;
    // A week is read as a week. Split across stacked sheets it stops being
    // one, so it stays on the page that can hold it.
    if (stacked && spec.span === 'week') return drawPart(kind, wider, layout);
    const total = spec.span === 'month' ? daysInMonth(layout.year, layout.month) : 7;
    const { cut } = shareColumns(a.w, b.w, total, false);
    return [
      ...drawDateGrid(a, layout, { ...spec, range: [0, cut] }),
      // The title belongs to the part, not to each page of it.
      ...drawDateGrid(b, layout, { ...spec, title: '', range: [cut, total] }),
    ];
  }
  return null;
}
