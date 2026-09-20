import type { Color, Primitive } from '../draw';

// Lays refills out on a sheet of paper you can actually feed to a printer.
// Without this the app produces exact-size pages no home printer will handle,
// so it is a prerequisite rather than a feature.

export interface SheetContent {
  widthMm: number;
  heightMm: number;
  primitives: Primitive[];
}

export const A4 = { widthMm: 210, heightMm: 297 };

export interface ImposeSpec {
  paper: { widthMm: number; heightMm: number };
  marginMm: number;
  gapMm: number;
  cutLines: boolean;
  // Home printers rarely print at exactly 100%, and a percent of error is
  // enough to push the punch holes off. This pre-compensates.
  scalePercent: number;
}

export const DEFAULT_IMPOSE: ImposeSpec = {
  paper: A4,
  marginMm: 8,
  gapMm: 4,
  cutLines: true,
  scalePercent: 100,
};

const CUT_LINE: Color = [0.72, 0.70, 0.66];

function translate(items: Primitive[], dx: number, dy: number): Primitive[] {
  return items.map((p): Primitive => {
    if (p.type === 'line') return { ...p, x1: p.x1 + dx, y1: p.y1 + dy, x2: p.x2 + dx, y2: p.y2 + dy };
    if (p.type === 'circle') return { ...p, cx: p.cx + dx, cy: p.cy + dy };
    return { ...p, x: p.x + dx, y: p.y + dy };
  });
}

// Scales about the paper's centre, so the correction grows the artwork without
// walking it off the page.
function scaleAbout(items: Primitive[], cx: number, cy: number, k: number): Primitive[] {
  if (k === 1) return items;
  const sx = (x: number) => cx + (x - cx) * k;
  const sy = (y: number) => cy + (y - cy) * k;
  return items.map((p): Primitive => {
    if (p.type === 'line') {
      return { ...p, x1: sx(p.x1), y1: sy(p.y1), x2: sx(p.x2), y2: sy(p.y2), strokeMm: (p.strokeMm ?? 0.2) * k };
    }
    if (p.type === 'circle') {
      return { ...p, cx: sx(p.cx), cy: sy(p.cy), r: p.r * k };
    }
    if (p.type === 'rect') {
      return { ...p, x: sx(p.x), y: sy(p.y), w: p.w * k, h: p.h * k, strokeMm: p.strokeMm ? p.strokeMm * k : p.strokeMm };
    }
    return { ...p, x: sx(p.x), y: sy(p.y), sizePt: p.sizePt * k };
  });
}

function cutRect(x: number, y: number, w: number, h: number): Primitive {
  return { type: 'rect', x, y, w, h, stroke: CUT_LINE, strokeMm: 0.15, dashMm: [1.2, 1.2] } as Primitive;
}

export function tilesPerPage(sheet: SheetContent, spec: ImposeSpec) {
  const usableW = spec.paper.widthMm - spec.marginMm * 2 + spec.gapMm;
  const usableH = spec.paper.heightMm - spec.marginMm * 2 + spec.gapMm;
  return {
    cols: Math.max(1, Math.floor(usableW / (sheet.widthMm + spec.gapMm))),
    rows: Math.max(1, Math.floor(usableH / (sheet.heightMm + spec.gapMm))),
  };
}

// `mirrorColumns` is what makes duplex work: the back of a sheet meets the
// front after the paper is turned over, so its tiles have to run the other way
// across the page or nothing lines up.
export function impose(sheets: SheetContent[], spec: ImposeSpec, mirrorColumns = false): SheetContent[] {
  if (sheets.length === 0) return [];
  const { cols, rows } = tilesPerPage(sheets[0], spec);
  const perPage = cols * rows;

  const { widthMm: tw, heightMm: th } = sheets[0];
  const blockW = cols * tw + (cols - 1) * spec.gapMm;
  const blockH = rows * th + (rows - 1) * spec.gapMm;
  const ox = (spec.paper.widthMm - blockW) / 2;
  const oy = (spec.paper.heightMm - blockH) / 2;

  const out: SheetContent[] = [];
  for (let start = 0; start < sheets.length; start += perPage) {
    const primitives: Primitive[] = [];
    sheets.slice(start, start + perPage).forEach((sheet, i) => {
      const col = mirrorColumns ? cols - 1 - (i % cols) : i % cols;
      const x = ox + col * (tw + spec.gapMm);
      const y = oy + Math.floor(i / cols) * (th + spec.gapMm);
      if (spec.cutLines) primitives.push(cutRect(x, y, sheet.widthMm, sheet.heightMm));
      primitives.push(...translate(sheet.primitives, x, y));
    });
    out.push({
      ...spec.paper,
      primitives: scaleAbout(
        primitives,
        spec.paper.widthMm / 2, spec.paper.heightMm / 2,
        spec.scalePercent / 100,
      ),
    });
  }
  return out;
}
