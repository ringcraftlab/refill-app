import type { MonthlyCalendarPart, SizeSpec } from '../../types';
import type { Page, Primitive } from '../draw';
import { BLACK, GRAY, LIGHT_GRAY } from '../draw';
import { monthGrid, orderedWeekdays, weekdayLabel } from '../dates';
import { ringGuides } from './rings';

const MONTH_NAMES = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

export function buildMonthlyCalendarPages(part: MonthlyCalendarPart, size: SizeSpec): Page[] {
  if (part.spread) return buildSpread(part, size);
  return [buildSinglePage(part, size)];
}

function buildSinglePage(part: MonthlyCalendarPart, size: SizeSpec, sliceCols?: [number, number], side: 'left'|'right' = 'right'): Page {
  const W = size.widthMm;
  const H = size.heightMm;
  const outer = 5;
  const ringMargin = size.ringMarginMm;
  const innerLeft = side === 'right' ? ringMargin : outer;
  const innerRight = side === 'right' ? outer : ringMargin;

  const primitives: Primitive[] = [];
  const dows = orderedWeekdays(part.weekStart);
  const rows = monthGrid(part.year, part.month, part.weekStart);

  const [colStart, colEnd] = sliceCols ?? [0, 7];
  const nCols = colEnd - colStart;

  // Header
  primitives.push({
    type: 'text', x: innerLeft, y: outer + 4,
    text: `${part.year} ${MONTH_NAMES[part.month - 1]}`,
    sizePt: 12, color: BLACK, align: 'left',
  });

  const gridLeft = innerLeft;
  const gridRight = W - innerRight;
  const gridTop = outer + 8;
  const gridBottom = H - outer;
  const colW = (gridRight - gridLeft) / nCols;
  const headerH = 5;
  const bodyTop = gridTop + headerH;
  const rowH = (gridBottom - bodyTop) / rows.length;

  // Weekday headers
  for (let c = 0; c < nCols; c++) {
    const dow = dows[colStart + c];
    const cx = gridLeft + colW * (c + 0.5);
    const isSat = dow === 6;
    const isSun = dow === 0;
    const color = isSun ? [0.8, 0.2, 0.2] as [number,number,number]
                : isSat ? [0.2, 0.4, 0.8] as [number,number,number]
                : BLACK;
    primitives.push({
      type: 'text', x: cx, y: gridTop + 3.5,
      text: weekdayLabel(new Date(2024, 0, 7 + dow), part.weekdayFormat),
      sizePt: 7, color, align: 'center',
    });
  }

  // Outer frame
  primitives.push({
    type: 'rect', x: gridLeft, y: gridTop, w: gridRight - gridLeft, h: gridBottom - gridTop,
    stroke: BLACK, strokeMm: 0.25,
  });
  // Header separator
  primitives.push({
    type: 'line', x1: gridLeft, y1: bodyTop, x2: gridRight, y2: bodyTop,
    stroke: BLACK, strokeMm: 0.2,
  });
  // Column separators
  for (let c = 1; c < nCols; c++) {
    const x = gridLeft + colW * c;
    primitives.push({
      type: 'line', x1: x, y1: gridTop, x2: x, y2: gridBottom,
      stroke: LIGHT_GRAY, strokeMm: 0.15,
    });
  }
  // Row separators
  for (let r = 1; r < rows.length; r++) {
    const y = bodyTop + rowH * r;
    primitives.push({
      type: 'line', x1: gridLeft, y1: y, x2: gridRight, y2: y,
      stroke: LIGHT_GRAY, strokeMm: 0.15,
    });
  }

  // Date numbers
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < nCols; c++) {
      const cell = rows[r][colStart + c];
      if (!cell) continue;
      const x = gridLeft + colW * c + 1.5;
      const y = bodyTop + rowH * r + 3.5;
      const dow = cell.getDay();
      const color = dow === 0 ? [0.8, 0.2, 0.2] as [number,number,number]
                  : dow === 6 ? [0.2, 0.4, 0.8] as [number,number,number]
                  : BLACK;
      primitives.push({
        type: 'text', x, y, text: String(cell.getDate()),
        sizePt: 8, color, align: 'left',
      });
    }
  }

  return {
    widthMm: W, heightMm: H,
    primitives,
    guides: ringGuides(size, side),
  };
}

function buildSpread(part: MonthlyCalendarPart, size: SizeSpec): Page[] {
  // Left page: first 3 weekday columns (Mon/Tue/Wed when weekStart=1)
  // Right page: remaining 4 columns
  const left = buildSinglePage(part, size, [0, 3], 'left');
  const right = buildSinglePage(part, size, [3, 7], 'right');
  return [left, right];
}
