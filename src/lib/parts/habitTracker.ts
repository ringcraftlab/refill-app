import type { HabitTrackerPart, SizeSpec } from '../../types';
import type { Page, Primitive } from '../draw';
import { BLACK, GRAY, LIGHT_GRAY } from '../draw';
import { addDays, parseISO, weekdayLabel } from '../dates';
import { ringGuides } from './rings';

export function buildHabitTrackerPages(part: HabitTrackerPart, size: SizeSpec): Page[] {
  const W = size.widthMm;
  const H = size.heightMm;
  const ringMargin = size.ringMarginMm;
  const outer = 5; // outer margin mm
  const innerLeft = ringMargin;
  const innerRight = outer;
  const top = outer + 2;

  const primitives: Primitive[] = [];

  // Title
  primitives.push({
    type: 'text', x: innerLeft, y: top + 3.5,
    text: part.title || 'Habit Tracker',
    sizePt: 11, color: BLACK, align: 'left',
  });

  // Header: date row (day number, weekday letter). Habit name column on left.
  const nameColW = 24;
  const gridLeft = innerLeft + nameColW;
  const gridRight = W - innerRight;
  const gridTop = top + 8;
  const start = parseISO(part.startDate);
  const days = Math.max(1, part.days);
  const dayColW = (gridRight - gridLeft) / days;

  // Header numbers + weekday letters
  for (let i = 0; i < days; i++) {
    const d = addDays(start, i);
    const cx = gridLeft + dayColW * (i + 0.5);
    primitives.push({
      type: 'text', x: cx, y: gridTop - 3.2,
      text: String(d.getDate()),
      sizePt: 6, color: BLACK, align: 'center',
    });
    primitives.push({
      type: 'text', x: cx, y: gridTop - 0.6,
      text: weekdayLabel(d, part.weekdayFormat),
      sizePt: 5, color: GRAY, align: 'center',
    });
    // Month-boundary marker: mark day 1 of any new month with a stronger tick
    if (d.getDate() === 1 && i > 0) {
      primitives.push({
        type: 'line',
        x1: gridLeft + dayColW * i, y1: gridTop - 4,
        x2: gridLeft + dayColW * i, y2: gridTop,
        stroke: BLACK, strokeMm: 0.4,
      });
    }
  }

  // Grid rows: habits
  const rowH = 6;
  const habitCount = Math.max(1, part.habits.length);
  const gridBottom = gridTop + rowH * habitCount;

  // Grid outer frame + inner lines
  primitives.push({
    type: 'rect', x: gridLeft, y: gridTop, w: gridRight - gridLeft, h: gridBottom - gridTop,
    stroke: BLACK, strokeMm: 0.2,
  });
  // Vertical column separators
  for (let i = 1; i < days; i++) {
    const x = gridLeft + dayColW * i;
    primitives.push({
      type: 'line', x1: x, y1: gridTop, x2: x, y2: gridBottom,
      stroke: LIGHT_GRAY, strokeMm: 0.15,
    });
  }
  // Horizontal row separators + habit name cells
  for (let r = 0; r < habitCount; r++) {
    const y = gridTop + rowH * r;
    if (r > 0) {
      primitives.push({
        type: 'line', x1: innerLeft, y1: y, x2: gridRight, y2: y,
        stroke: LIGHT_GRAY, strokeMm: 0.15,
      });
    }
    primitives.push({
      type: 'text', x: innerLeft + 1, y: y + rowH / 2 + 1.4,
      text: part.habits[r] ?? '',
      sizePt: 7, color: BLACK, align: 'left',
    });
  }
  // Left frame line for the habit name column
  primitives.push({
    type: 'line', x1: innerLeft, y1: gridTop, x2: innerLeft, y2: gridBottom,
    stroke: BLACK, strokeMm: 0.2,
  });
  primitives.push({
    type: 'line', x1: innerLeft, y1: gridTop, x2: gridLeft, y2: gridTop,
    stroke: BLACK, strokeMm: 0.2,
  });
  primitives.push({
    type: 'line', x1: innerLeft, y1: gridBottom, x2: gridLeft, y2: gridBottom,
    stroke: BLACK, strokeMm: 0.2,
  });

  return [{
    widthMm: W, heightMm: H,
    primitives,
    guides: ringGuides('left', W, H, ringMargin),
    sheet: { widthMm: W, heightMm: H, rotation: 0 },
  }];
}
