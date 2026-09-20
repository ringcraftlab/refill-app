// Backing-store neutral draw plan. Both the SVG preview and the pdf-lib
// exporter consume the same primitives, so on-screen and printed output stay
// pixel-identical at true size.
//
// All coordinates are in millimeters, origin top-left. The PDF renderer flips
// Y internally. Colors are 0-1 RGB.

export type Color = [number, number, number];

export interface DrawRect {
  type: 'rect';
  x: number; y: number; w: number; h: number;
  fill?: Color;
  stroke?: Color;
  strokeMm?: number;
  // Dash/gap lengths in mm, for cut lines around an imposed refill.
  dashMm?: number[];
}
export interface DrawLine {
  type: 'line';
  x1: number; y1: number; x2: number; y2: number;
  stroke: Color;
  strokeMm?: number;
  // Dash/gap lengths in mm, for the writing rules printed inside day cells.
  dashMm?: number[];
}
export interface DrawText {
  type: 'text';
  x: number; y: number;
  text: string;
  sizePt: number;
  color?: Color;
  // Horizontal alignment relative to (x, y). y is the baseline.
  align?: 'left' | 'center' | 'right';
  // 90 means the text runs up the sheet, which is how a landscape page's
  // content sits once it is flattened back onto its portrait sheet.
  rotateDeg?: 90;
}
export interface DrawCircle {
  type: 'circle';
  cx: number; cy: number; r: number;
  fill?: Color;
  stroke?: Color;
  strokeMm?: number;
}

export type Primitive = DrawRect | DrawLine | DrawText | DrawCircle;

// A landscape refill is the same punched sheet held sideways, so its content
// is rotated a quarter turn onto a portrait sheet whose holes stay on the long
// edge. Preview works in reading space; the PDF exporter applies the rotation.
export type SheetRotation = 0 | 90;

export interface Page {
  // Reading space: the page as the user holds and reads it. For landscape
  // variants this is the sheet turned on its side, so width > height.
  widthMm: number;
  heightMm: number;
  primitives: Primitive[];
  // Non-printing guides for on-screen only (rings, punch holes).
  guides: Primitive[];
  // The physical punched sheet this reading-space canvas prints onto.
  sheet: { widthMm: number; heightMm: number; rotation: SheetRotation };
}

// Puts a page's content back on the physical punched sheet. Reading space is
// the page as the user holds it, so a landscape page has to be turned a
// quarter turn before it can be printed or imposed.
export function flattenToSheet(page: Page): Primitive[] {
  const H = page.sheet.heightMm;
  if (page.sheet.rotation === 0) return page.primitives;

  // The sheet's x is the page's y; the sheet's y runs back down the page's x.
  return page.primitives.map((p): Primitive => {
    if (p.type === 'rect') {
      return { ...p, x: p.y, y: H - p.x - p.w, w: p.h, h: p.w };
    }
    if (p.type === 'line') {
      return { ...p, x1: p.y1, y1: H - p.x1, x2: p.y2, y2: H - p.x2 };
    }
    if (p.type === 'circle') {
      return { ...p, cx: p.cy, cy: H - p.cx };
    }
    return { ...p, x: p.y, y: H - p.x, rotateDeg: 90 };
  });
}

// Keeps only what falls inside the millimetre band [xMin, xMax], then shifts
// the result. A part is drawn once across its whole region and each page keeps
// its piece, so rules and day columns carry on across the gutter instead of
// restarting.
export function clipToBand(
  items: Primitive[], xMin: number, xMax: number, dx: number, dy: number,
): Primitive[] {
  const out: Primitive[] = [];
  for (const p of items) {
    if (p.type === 'rect') {
      const x = Math.max(p.x, xMin), right = Math.min(p.x + p.w, xMax);
      if (right <= x) continue;
      out.push({ ...p, x: x + dx, y: p.y + dy, w: right - x });
    } else if (p.type === 'line') {
      if (p.x1 === p.x2) {
        if (p.x1 < xMin || p.x1 > xMax) continue;
        out.push({ ...p, x1: p.x1 + dx, x2: p.x2 + dx, y1: p.y1 + dy, y2: p.y2 + dy });
      } else {
        const lo = Math.max(Math.min(p.x1, p.x2), xMin);
        const hi = Math.min(Math.max(p.x1, p.x2), xMax);
        if (hi <= lo) continue;
        out.push({ ...p, x1: lo + dx, x2: hi + dx, y1: p.y1 + dy, y2: p.y2 + dy });
      }
    } else if (p.type === 'circle') {
      if (p.cx < xMin || p.cx > xMax) continue;
      out.push({ ...p, cx: p.cx + dx, cy: p.cy + dy });
    } else {
      if (p.x < xMin || p.x > xMax) continue;
      out.push({ ...p, x: p.x + dx, y: p.y + dy });
    }
  }
  return out;
}

// Paper palette. Printed refills are warm, not black-on-white screen grey.
export const INK: Color = [0.227, 0.212, 0.180];
export const INK_SOFT: Color = [0.42, 0.40, 0.35];
export const SUNDAY: Color = [0.788, 0.482, 0.576];
export const SATURDAY: Color = [0.431, 0.561, 0.651];
export const RULE: Color = [0.894, 0.874, 0.827];
export const RULE_LIGHT: Color = [0.941, 0.918, 0.851];
// Refill stock is cream, not screen white.
export const PAPER: Color = [0.992, 0.980, 0.925];
export const RING_BAND: Color = [0.965, 0.957, 0.933];
export const RING_HOLE: Color = [0.847, 0.824, 0.769];
