import type { Layout, PageKey, PartKind } from '../types';
import type { Color, Primitive } from './draw';
import { INK, INK_SOFT, LABEL_BG, RULE, RULE_LIGHT, SATURDAY, SUNDAY } from './draw';
import { monthGrid, orderedWeekdays, rokuyoLabel, weekdayLabel } from './dates';
import type { Rect } from './layout';

// Every part draws into whatever millimetre rectangle the layout hands it. A
// part never assumes it owns the page, so widening one by dragging a border
// just means it gets a bigger rectangle.

const PAD = 1.2;
// Fixed bands, kept out of the row division: the week rows only ever share
// what is left, so the label and header keep their height whatever the row
// count is.
const MONTH_LABEL_H = 5;
const DOW_HEADER_H = 3.8;

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

  out.push({ type: 'rect', x: left, y: gridTop, w: width, h: DOW_HEADER_H, fill: LABEL_BG });
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

  const roomForRokuyo = rowH >= 6 && colW >= 7;
  for (let r = 0; r < weeks.length; r++) {
    for (let c = 0; c < dayCols; c++) {
      const cell = weeks[r][colStart + c];
      if (!cell) continue;
      const x = left + colW * (lead + c) + 0.9;
      const y = bodyTop + rowH * r;
      out.push({
        type: 'text', x, y: y + 2.6, text: String(cell.getDate()),
        sizePt: 6.5, color: dowColor(cell.getDay()), align: 'left',
      });
      if (roomForRokuyo) {
        out.push({ type: 'text', x, y: y + 5.1, text: rokuyoLabel(cell), sizePt: 3.6, color: SUNDAY, align: 'left' });
      }
    }
  }
  return out;
}

export function drawSpanningMonthly(area: Rect, page: PageKey, layout: Layout): Primitive[] {
  const rows = weekCount(layout);
  if (layout.spanning?.pattern === 2) {
    return drawMonthly(area, layout, {
      cols: [0, 7],
      rows: page === 'left' ? [0, 2] : [2, rows],
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
    case 'grid': return drawGrid(area);
    case 'lines': return drawLines(area);
    case 'memo': return drawMemo(area);
  }
}
