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

export interface DrawImage {
  type: 'image';
  x: number; y: number; w: number; h: number;
  // A data URL. The bytes travel with the layout, because a refill has to
  // keep printing after the file it came from has moved.
  src: string;
  // 0-1. A photo under a calendar has to give way to it.
  opacity?: number;
  // The box is the area the image fills; the picture keeps its own shape and
  // is cropped to fit, the way a photo in a frame is.
  fit?: 'cover' | 'contain';
  // The part of the box that is actually inked. The picture is still laid out
  // in the whole box, so a photo cut by the gutter carries on across it at the
  // same scale instead of each sheet cropping its half on its own.
  clip?: { x: number; y: number; w: number; h: number };
}

export type Primitive = DrawRect | DrawLine | DrawText | DrawCircle | DrawImage;

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
    if (p.type === 'image') {
      const turn = (r: { x: number; y: number; w: number; h: number }) =>
        ({ x: r.y, y: H - r.x - r.w, w: r.h, h: r.w });
      return { ...p, ...turn(p), clip: p.clip && turn(p.clip) };
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
    } else if (p.type === 'image') {
      // The box is kept whole and only what shows is narrowed: cutting the box
      // itself would make each sheet re-fit the picture to its own half and
      // the two would not line up at the gutter.
      const cur = p.clip ?? { x: p.x, y: p.y, w: p.w, h: p.h };
      const x = Math.max(cur.x, xMin), right = Math.min(cur.x + cur.w, xMax);
      if (right <= x) continue;
      out.push({
        ...p, x: p.x + dx, y: p.y + dy,
        clip: { x: x + dx, y: cur.y + dy, w: right - x, h: cur.h },
      });
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
// Between the ink and the rules: for something printed over and over across a
// sheet, like the hour repeated in every column of a vertical, which has to be
// readable without competing with what gets written next to it.
export const INK_FAINT: Color = [0.62, 0.60, 0.55];
export const SUNDAY: Color = [0.788, 0.482, 0.576];
export const SATURDAY: Color = [0.431, 0.561, 0.651];
export const RULE: Color = [0.894, 0.874, 0.827];
export const RULE_LIGHT: Color = [0.941, 0.918, 0.851];
// White, because that is what comes out of the printer. The editor used to
// draw the sheet cream, which looked like the refill stock it is meant to be
// printed on -- but nothing prints that colour, so the screen was promising
// something the paper does not keep. It also put a cream-on-white seam along
// every page edge, since the sheet sits on a white box.
export const PAPER: Color = [1, 1, 1];
export const RING_BAND: Color = [0.965, 0.957, 0.933];
// Where the paper ends, on screen. The sheet is white on a warm background and
// the ring band is warm too, so an edge with the band along it had nothing to
// show for itself. Screen only -- it is a guide, not ink.
export const TRIM: Color = [0.831, 0.816, 0.784];
export const RING_HOLE: Color = [0.847, 0.824, 0.769];
