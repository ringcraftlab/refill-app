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
  gapMm: number;
  cutLines: boolean;
  // Home printers rarely print at exactly 100%, and a percent of error is
  // enough to push the punch holes off. This pre-compensates.
  scalePercent: number;
}

export const DEFAULT_IMPOSE: ImposeSpec = {
  paper: A4,
  // Zero, and not an oversight. A gap puts two cut lines at every boundary
  // instead of one, and a ribbon of paper between them that goes in the bin:
  // at 4mm a nine-up sheet asked for four extra cuts and threw away four
  // ribbons. Butted up, two refills share one line, which is also the one a
  // blade can be run down in a single pass.
  gapMm: 0,
  cutLines: true,
  scalePercent: 100,
};

// How the refills sit on one sheet of paper.
//
// The paper is tried both ways up. That alone is most of this: Micro5 goes
// 3x2 on an upright A4 and 4x2 on a turned one, and A5 -- half of A4 exactly
// -- only ever fits two if the paper is turned.
//
// Nothing here reserves a margin. The block is centred, so whatever the tiles
// leave over becomes the clearance, and `sideMm`/`endMm` report it. That
// number is the honest answer to "will my printer cut the edge off": a
// constant picked in advance cannot be, because 8mm of it silently cost A5
// its second refill and Micro5 its seventh and eighth.
export interface TilePlan {
  // The paper as the page will be emitted -- turned, if turning it fits more.
  paper: { widthMm: number; heightMm: number };
  cols: number;
  rows: number;
  perPage: number;
  // Paper edge to the block, across and down. Zero means the refill's own
  // edge is the paper's edge.
  sideMm: number;
  endMm: number;
}

// `count` is how many refills the run actually has to place. Given it, the
// plan is chosen by what it costs in paper rather than by how many fit: more
// to a sheet is not better when the extra places stay empty. Micro5 is the
// case that made this necessary -- eight to a turned A4, six to an upright
// one, and a year is six either way, so the turned sheet only bought four
// empty tiles and an edge with no clearance for the punch guide to survive.
export function planTiles(
  sheet: { widthMm: number; heightMm: number }, spec: ImposeSpec, count?: number,
): TilePlan {
  const { widthMm: pw, heightMm: ph } = spec.paper;
  let best: TilePlan | null = null;
  for (const paper of [{ widthMm: pw, heightMm: ph }, { widthMm: ph, heightMm: pw }]) {
    const cols = Math.floor((paper.widthMm + spec.gapMm) / (sheet.widthMm + spec.gapMm));
    const rows = Math.floor((paper.heightMm + spec.gapMm) / (sheet.heightMm + spec.gapMm));
    if (cols < 1 || rows < 1) continue;
    const plan: TilePlan = {
      paper, cols, rows, perPage: cols * rows,
      sideMm: (paper.widthMm - (cols * sheet.widthMm + (cols - 1) * spec.gapMm)) / 2,
      endMm: (paper.heightMm - (rows * sheet.heightMm + (rows - 1) * spec.gapMm)) / 2,
    };
    // Fewest sheets of paper, then fewest places left empty on them, then
    // furthest from the paper's edge. Without a count to go on there is no
    // paper to compare, so it falls back to the most to a sheet.
    const room = (t: TilePlan) => Math.min(t.sideMm, t.endMm);
    const score = (t: TilePlan): [number, number, number] => {
      if (!count) return [0, -t.perPage, -room(t)];
      const pages = Math.ceil(count / t.perPage);
      return [pages, pages * t.perPage - count, -room(t)];
    };
    if (!best) { best = plan; continue; }
    const [a, b] = [score(plan), score(best)];
    if (a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2])))) best = plan;
  }
  // A refill bigger than the paper still has to go somewhere. One to a page,
  // overhanging, is a truthful thing to show and a truthful thing to print.
  return best ?? {
    paper: spec.paper, cols: 1, rows: 1, perPage: 1,
    sideMm: (pw - sheet.widthMm) / 2, endMm: (ph - sheet.heightMm) / 2,
  };
}

const CUT_LINE: Color = [0.72, 0.70, 0.66];

// Which way the paper has to be turned over so a back lands behind its front.
// The back run mirrors across the page's width, so the turn is about the
// page's vertical edge: the long one on an upright sheet, the short one on a
// turned one. Nobody can see this is wrong until the paper is out of the
// printer, so it is worked out here and printed on the sheet.
export type DuplexFlip = '長辺とじ' | '短辺とじ';
export const duplexFlip = (plan: TilePlan): DuplexFlip =>
  plan.paper.widthMm > plan.paper.heightMm ? '短辺とじ' : '長辺とじ';

export function translate(items: Primitive[], dx: number, dy: number): Primitive[] {
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
    if (p.type === 'image') {
      return { ...p, x: sx(p.x), y: sy(p.y), w: p.w * k, h: p.h * k };
    }
    return { ...p, x: sx(p.x), y: sy(p.y), sizePt: p.sizePt * k };
  });
}

// One line per cut, spanning the whole block, rather than a box drawn around
// each refill. Butted up, a box would trace every inside edge twice -- two
// dashed lines a hair apart where one blade stroke serves both refills -- and
// a line that runs the full width is the one a ruler can be laid along.
function cutLines(rects: { x: number; y: number; w: number; h: number }[]): Primitive[] {
  if (!rects.length) return [];
  const round = (n: number) => Math.round(n * 100) / 100;
  const xs = new Set<number>(), ys = new Set<number>();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rects) {
    xs.add(round(r.x)); xs.add(round(r.x + r.w));
    ys.add(round(r.y)); ys.add(round(r.y + r.h));
    x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
  }
  const line = (a: number, b: number, c: number, d: number): Primitive =>
    ({ type: 'line', x1: a, y1: b, x2: c, y2: d, stroke: CUT_LINE, strokeMm: 0.15, dashMm: [1.2, 1.2] });
  return [
    ...[...xs].map(x => line(x, y0, x, y1)),
    ...[...ys].map(y => line(x0, y, x1, y)),
  ];
}

// `mirrorColumns` is what makes duplex work: the back of a sheet meets the
// front after the paper is turned over, so its tiles have to run the other way
// across the page or nothing lines up.
// `plan` is passed in when the front and back of the same paper have to agree:
// choosing it twice could land on two different arrangements and nothing would
// line up through the sheet.
export function impose(
  sheets: SheetContent[], spec: ImposeSpec, mirrorColumns = false, plan?: TilePlan,
): SheetContent[] {
  if (sheets.length === 0) return [];
  const { paper, cols, rows, perPage } = plan ?? planTiles(sheets[0], spec, sheets.length);

  const { widthMm: tw, heightMm: th } = sheets[0];
  const blockW = cols * tw + (cols - 1) * spec.gapMm;
  const blockH = rows * th + (rows - 1) * spec.gapMm;
  const ox = (paper.widthMm - blockW) / 2;
  const oy = (paper.heightMm - blockH) / 2;

  const out: SheetContent[] = [];
  for (let start = 0; start < sheets.length; start += perPage) {
    const primitives: Primitive[] = [];
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    sheets.slice(start, start + perPage).forEach((sheet, i) => {
      const col = mirrorColumns ? cols - 1 - (i % cols) : i % cols;
      const x = ox + col * (tw + spec.gapMm);
      const y = oy + Math.floor(i / cols) * (th + spec.gapMm);
      placed.push({ x, y, w: sheet.widthMm, h: sheet.heightMm });
      primitives.push(...translate(sheet.primitives, x, y));
    });
    out.push({
      ...paper,
      primitives: scaleAbout(
        spec.cutLines ? [...cutLines(placed), ...primitives] : primitives,
        paper.widthMm / 2, paper.heightMm / 2,
        spec.scalePercent / 100,
      ),
    });
  }
  return out;
}
