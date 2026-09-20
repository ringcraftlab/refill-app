import type { MonthlyCalendarPart, MonthlyVariant, SizeSpec } from '../../types';
import type { Color, Page, Primitive, SheetRotation } from '../draw';
import { BLACK, LIGHT_GRAY } from '../draw';
import { monthGrid, orderedWeekdays, weekdayLabel } from '../dates';
import { ringGuides, type RingEdge } from './rings';

const MONTH_NAMES = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

// Trim margin on the three edges that are not the binding.
const OUTER_MM = 4;
// Fixed-height bands, deliberately kept out of the week-row division: the week
// rows only ever share the space that is left over. The month label and the
// weekday header therefore keep their height whatever the row count is, and
// neither can overlap the other.
const MONTH_LABEL_H = 6;
const DOW_HEADER_H = 4.5;

const SUNDAY: Color = [0.8, 0.2, 0.2];
const SATURDAY: Color = [0.2, 0.4, 0.8];

const dowColor = (dow: number): Color => (dow === 0 ? SUNDAY : dow === 6 ? SATURDAY : BLACK);

interface Rect { x: number; y: number; w: number; h: number }

interface GridSpec {
  // Printable area, with the ring band already excluded.
  area: Rect;
  // Slice of the seven weekday columns this page carries. The grid is always
  // seven columns wide; a spread just shows some of them per page.
  cols: [number, number];
  // Slice of the week rows this page carries.
  rows: [number, number];
  // 'reserve' keeps the band empty so a facing page's grid starts level.
  monthLabel: 'show' | 'reserve' | 'none';
}

function drawCalendar(part: MonthlyCalendarPart, spec: GridSpec): Primitive[] {
  const { area, monthLabel } = spec;
  const [colStart, colEnd] = spec.cols;
  const [rowStart, rowEnd] = spec.rows;

  const dows = orderedWeekdays(part.weekStart);
  const weeks = monthGrid(part.year, part.month, part.weekStart).slice(rowStart, rowEnd);
  const nCols = colEnd - colStart;

  const left = area.x;
  const right = area.x + area.w;
  const gridTop = area.y + (monthLabel === 'none' ? 0 : MONTH_LABEL_H);
  const bodyTop = gridTop + DOW_HEADER_H;
  const gridBottom = area.y + area.h;
  // Columns divide this page's width among the columns this page got, so a 3/4
  // spread has wider cells on the four-column page. A printed refill behaves
  // the same way; equalizing them only introduces gaps.
  const colW = area.w / nCols;
  const rowH = (gridBottom - bodyTop) / weeks.length;

  const out: Primitive[] = [];

  if (monthLabel === 'show') {
    out.push({
      type: 'text', x: left, y: area.y + MONTH_LABEL_H - 1.6,
      text: `${part.year} ${MONTH_NAMES[part.month - 1]}`,
      sizePt: 11, color: BLACK, align: 'left',
    });
  }

  for (let c = 0; c < nCols; c++) {
    const dow = dows[colStart + c];
    out.push({
      type: 'text',
      x: left + colW * (c + 0.5),
      y: gridTop + DOW_HEADER_H - 1.3,
      // Jan 7 2024 was a Sunday, so +dow lands on the wanted weekday.
      text: weekdayLabel(new Date(2024, 0, 7 + dow), part.weekdayFormat),
      sizePt: 6.5, color: dowColor(dow), align: 'center',
    });
  }

  out.push({
    type: 'rect', x: left, y: gridTop, w: area.w, h: gridBottom - gridTop,
    stroke: BLACK, strokeMm: 0.25,
  });
  out.push({
    type: 'line', x1: left, y1: bodyTop, x2: right, y2: bodyTop,
    stroke: BLACK, strokeMm: 0.2,
  });
  for (let c = 1; c < nCols; c++) {
    const x = left + colW * c;
    out.push({ type: 'line', x1: x, y1: gridTop, x2: x, y2: gridBottom, stroke: LIGHT_GRAY, strokeMm: 0.15 });
  }
  for (let r = 1; r < weeks.length; r++) {
    const y = bodyTop + rowH * r;
    out.push({ type: 'line', x1: left, y1: y, x2: right, y2: y, stroke: LIGHT_GRAY, strokeMm: 0.15 });
  }

  for (let r = 0; r < weeks.length; r++) {
    for (let c = 0; c < nCols; c++) {
      const cell = weeks[r][colStart + c];
      if (!cell) continue;
      out.push({
        type: 'text',
        x: left + colW * c + 1.4,
        y: bodyTop + rowH * r + 3.2,
        text: String(cell.getDate()),
        sizePt: 7.5, color: dowColor(cell.getDay()), align: 'left',
      });
    }
  }

  return out;
}

function makePage(
  readingW: number, readingH: number,
  sheetW: number, sheetH: number, rotation: SheetRotation,
  edge: RingEdge, bandMm: number,
  primitives: Primitive[],
): Page {
  return {
    widthMm: readingW,
    heightMm: readingH,
    primitives,
    guides: ringGuides(edge, readingW, readingH, bandMm),
    sheet: { widthMm: sheetW, heightMm: sheetH, rotation },
  };
}

export function buildMonthlyCalendarPages(part: MonthlyCalendarPart, size: SizeSpec): Page[] {
  const W = size.widthMm;
  const H = size.heightMm;
  const ring = size.ringMarginMm;
  const O = OUTER_MM;
  const nRows = monthGrid(part.year, part.month, part.weekStart).length;
  // Landscape reading space is the same sheet on its side.
  const lw = H;
  const lh = W;

  switch (part.variant) {
    case 'single-portrait': {
      const area = { x: ring, y: O, w: W - ring - O, h: H - 2 * O };
      return [makePage(W, H, W, H, 0, 'left', ring,
        drawCalendar(part, { area, cols: [0, 7], rows: [0, nRows], monthLabel: 'show' }))];
    }

    case 'single-landscape': {
      const area = { x: O, y: ring, w: lw - 2 * O, h: lh - ring - O };
      return [makePage(lw, lh, W, H, 90, 'top', ring,
        drawCalendar(part, { area, cols: [0, 7], rows: [0, nRows], monthLabel: 'show' }))];
    }

    case 'spread-weekday': {
      // Portrait pages side by side, the gutter between them.
      const leftArea  = { x: O,    y: O, w: W - O - ring, h: H - 2 * O };
      const rightArea = { x: ring, y: O, w: W - ring - O, h: H - 2 * O };
      return [
        makePage(W, H, W, H, 0, 'right', ring,
          drawCalendar(part, { area: leftArea, cols: [0, 3], rows: [0, nRows], monthLabel: 'show' })),
        makePage(W, H, W, H, 0, 'left', ring,
          drawCalendar(part, { area: rightArea, cols: [3, 7], rows: [0, nRows], monthLabel: 'reserve' })),
      ];
    }

    case 'spread-week': {
      // Landscape pages stacked vertically. Turning the planner a quarter turn
      // moves the side gutter to between the top page's bottom edge and the
      // bottom page's top edge.
      const topArea    = { x: O, y: O,    w: lw - 2 * O, h: lh - O - ring };
      const bottomArea = { x: O, y: ring, w: lw - 2 * O, h: lh - ring - O };
      return [
        makePage(lw, lh, W, H, 90, 'bottom', ring,
          drawCalendar(part, { area: topArea, cols: [0, 7], rows: [0, 2], monthLabel: 'show' })),
        makePage(lw, lh, W, H, 90, 'top', ring,
          drawCalendar(part, { area: bottomArea, cols: [0, 7], rows: [2, nRows], monthLabel: 'none' })),
      ];
    }
  }
}

// How the preview should arrange the pages of a variant.
export function monthlyPageFlow(variant: MonthlyVariant): 'row' | 'column' {
  return variant === 'spread-week' ? 'column' : 'row';
}
