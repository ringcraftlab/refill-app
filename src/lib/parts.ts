import type { Layout, PageKey, PartKind } from '../types';
import type { Color, Primitive } from './draw';
import { INK, INK_SOFT, RULE, RULE_LIGHT, SATURDAY, SUNDAY } from './draw';
import { monthGrid, orderedWeekdays, rokuyoLabel, weekdayLabel } from './dates';
import { MONTHLY_HEADER_MM, weekSplit } from './layout';
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
    if (layout.showNextMonth && weeks.length >= 2) {
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

export function drawPart(kind: PartKind, area: Rect, layout: Layout): Primitive[] {
  switch (kind) {
    case 'monthly':
      return drawMonthly(area, layout, { cols: [0, 7], rows: [0, weekCount(layout)], monthLabel: 'show' });
    case 'habit': return drawHabit(area, layout);
    case 'todo': return drawTodo(area);
    case 'goal': return drawGoal(area);
    case 'budget': return drawBudget(area);
    case 'grid': return drawGrid(area);
    case 'lines': return drawLines(area);
    case 'memo': return drawMemo(area);
  }
}
