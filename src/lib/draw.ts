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
}
export interface DrawLine {
  type: 'line';
  x1: number; y1: number; x2: number; y2: number;
  stroke: Color;
  strokeMm?: number;
}
export interface DrawText {
  type: 'text';
  x: number; y: number;
  text: string;
  sizePt: number;
  color?: Color;
  // Horizontal alignment relative to (x, y). y is the baseline.
  align?: 'left' | 'center' | 'right';
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

export const BLACK: Color = [0, 0, 0];
export const GRAY: Color = [0.7, 0.7, 0.7];
export const LIGHT_GRAY: Color = [0.9, 0.9, 0.9];
