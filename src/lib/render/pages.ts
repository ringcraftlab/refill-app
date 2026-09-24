import type { Layout, PartKind, SizeSpec } from '../../types';
import type { Color, Page, Primitive } from '../draw';
import { clipToBand, flattenToSheet, RING_BAND, RING_HOLE, TRIM } from '../draw';
import { buildGeometry, foldOf } from '../layout';
import type { PageGeometry, Rect, SurfaceSlice } from '../layout';
import { foldPanels } from '../fold';
import type { FoldPlan } from '../fold';
import { drawGrid, drawLines, drawMemo, drawPart, drawPartAcross, drawSpanningMonthly } from '../parts';
import type { Palette } from '../palette';
import { paletteOf } from '../palette';
import { drawBackground } from '../background';
import { holeCentres } from '../sizes';
import { addMonths, isoDate, sheetStarts } from '../dates';
import { DEFAULT_IMPOSE, duplexFlip, impose, PAPERS, planTiles } from './impose';
import type { PaperId } from './impose';
import type { DuplexFlip, TilePlan } from './impose';
import type { SheetContent } from './impose';

// Turns the editor's layout into printable pages. The on-screen preview and
// the PDF both consume these, so what you arrange is what comes out.
export function buildPages(layout: Layout, size: SizeSpec, flipBinding = false): Page[] {
  const geo = buildGeometry(layout, size, flipBinding);

  return geo.pages.map(pg => {
    // The ground the sheet is printed on, under everything including the ring
    // margin: a background that stopped at the content would read as a panel
    // laid on the paper rather than as the paper itself. It is not drawn on
    // the spare faces -- those are filler, and a tint there is ink for nothing.
    const primitives: Primitive[] = [
      ...drawBackground(layout.background, { x: 0, y: 0, w: pg.widthMm, h: pg.heightMm }),
    ];
    if (pg.spanRect) primitives.push(...drawSpanningMonthly(pg.spanRect, pg.key, layout));

    const slice = geo.surface.slices.find(s => s.key === pg.key);
    if (slice) {
      layout.surface.placed.forEach((kind, i) => {
        const region = geo.surface.regions[i];
        if (!region) return;
        // Draw across the part's whole region, then keep this page's piece.
        primitives.push(...clipToBand(
          drawnPart(kind, region, slotLayout(layout, i), geo.surface.slices),
          slice.fromMm, slice.toMm,
          slice.ox - slice.fromMm, slice.oy,
        ));
      });
    }

    return {
      widthMm: pg.widthMm,
      heightMm: pg.heightMm,
      primitives,
      guides: [
        { type: 'rect', ...pg.ringBand, fill: RING_BAND },
        ...pg.holes.map(h => ({ type: 'circle' as const, cx: h.cx, cy: h.cy, r: h.r, fill: RING_HOLE })),
        ...trimEdge(pg),
      ],
      sheet: pg.sheet,
    };
  });
}

// Where the paper ends, drawn on screen only (these are guides, not ink).
//
// The sheet is white on a warm background, and the ring band is warm too, so
// wherever the band runs along an edge the edge itself disappears -- on a fold
// that is cut back, where the band stops at the cut, that reads as the sheet
// being out of register with itself rather than as a corner that was cut off.
// A hairline says where the paper is, whatever colour happens to be either
// side of it, and it follows the cut.
function trimEdge(pg: PageGeometry): Primitive[] {
  const i = 0.1;
  const W = pg.widthMm - i, H = pg.heightMm - i;
  const n = pg.notch;
  const pts: [number, number][] = !n
    ? [[i, i], [W, i], [W, H], [i, H]]
    : n.x < 0.01 && n.y < 0.01
      ? [[n.x + n.w, i], [W, i], [W, H], [i, H], [i, n.y + n.h], [n.x + n.w, n.y + n.h]]
      : n.x < 0.01
        ? [[i, i], [W, i], [W, H], [n.x + n.w, H], [n.x + n.w, n.y], [i, n.y]]
        : n.y < 0.01
          ? [[i, i], [n.x, i], [n.x, n.y + n.h], [W, n.y + n.h], [W, H], [i, H]]
          : [[i, i], [W, i], [W, n.y], [n.x, n.y], [n.x, H], [i, H]];
  return pts.map((p, k): Primitive => {
    const q = pts[(k + 1) % pts.length];
    return { type: 'line', x1: p[0], y1: p[1], x2: q[0], y2: q[1], stroke: TRIM, strokeMm: 0.2 };
  });
}

// The spread's band is a calendar too. It is not in `placed` -- it is the
// spanning monthly, which is a property of the refill rather than a part -- so
// anything counting calendars has to add it back, or a monthly under the band
// comes out as the same month the band already shows.
const bandMonths = (layout: Layout, kind: PartKind): number =>
  (kind === 'monthly' && layout.spanning ? 1 : 0);

// Two calendars on one sheet are two months, not the same month twice. The
// count is taken within the kind, which is the whole rule: a calendar facing a
// day list is the standard printed spread and both show September, while a
// calendar facing a calendar is September and October.
const monthOrdinal = (layout: Layout, i: number): number => {
  const { placed } = layout.surface;
  return bandMonths(layout, placed[i]) + placed.slice(0, i).filter(k => k === placed[i]).length;
};

const monthFor = (layout: Layout, i: number): Layout => {
  const n = monthOrdinal(layout, i);
  return n === 0 ? layout : { ...layout, ...addMonths(layout.year, layout.month, n) };
};

// What the part at this slot draws with: its own month, and its own picture.
// The picture is handed over per slot rather than read from the surface,
// because a part only ever knows the area it was given.
const slotLayout = (layout: Layout, i: number): Layout => {
  const base = monthFor(layout, i);
  const photo = layout.surface.photos?.[i];
  return photo ? { ...base, slotPhoto: photo } : base;
};

// How many months one sheet gets through, so the run can step by that much:
// a spread carrying two calendars covers two, and a year of it is six sheets
// rather than twelve of September. The band counts as one of them -- otherwise
// the run steps by one while the sheet shows two, and every second month is
// printed twice.
export const monthsPerSheet = (layout: Layout): number => Math.max(
  1,
  ...MONTH_PACED.map(k => bandMonths(layout, k) + layout.surface.placed.filter(p => p === k).length),
);

// A region that crosses the gutter covers two sheets. The part gets a say in
// how it breaks there, because trimming a calendar at the page edge would
// leave a day half on one sheet and half on the other.
function drawnPart(kind: PartKind, region: Rect, layout: Layout, slices: SurfaceSlice[]): Primitive[] {
  for (const s of slices) {
    const at = s.toMm;
    if (region.x < at - 0.5 && region.x + region.w > at + 0.5) {
      const across = drawPartAcross(
        kind,
        { ...region, w: at - region.x },
        { ...region, x: at, w: region.x + region.w - at },
        layout,
      );
      if (across) return across;
    }
  }
  return drawPart(kind, region, layout);
}

export type BackFill = 'blank' | 'grid' | 'lines' | 'memo';

export interface PrintOptions {
  // Off prints each refill on paper its own size, which most home printers
  // cannot feed.
  impose: boolean;
  copies: number;
  cutLines: boolean;
  scalePercent: number;
  duplex: boolean;
  // What goes on the faces the design does not use.
  backFill: BackFill;
  // Printed, unlike the editor's guides: you cannot punch what you cannot see.
  punchGuides: boolean;
  // What the refills are laid out on. Only the tiling depends on it.
  paper: PaperId;
  // Saved designs to fill the rest of the paper with: an id and how many of
  // it. A count rather than a tick, because "two memo pages" is the whole
  // point of filling a sheet -- a design's own run is only ever one of the
  // things going on the paper. They have to be the same punched sheet;
  // anything else is dropped rather than printed somewhere it does not fit.
  also: { id: string; n: number }[];
}

export const DEFAULT_PRINT: PrintOptions = {
  impose: true,
  paper: 'a4',
  also: [],
  copies: 1,
  cutLines: true,
  scalePercent: 100,
  duplex: true,
  // A blank back is half the paper thrown away, and printed refills almost
  // always carry something on the reverse.
  backFill: 'grid',
  punchGuides: true,
};

// Which edge of a sheet carries the rings. Turning a sheet over puts them on
// the opposite edge, which is why a left page's binding sits on its right.
// Every size binds on a side of the sheet as it is described; a top-bound one
// would use the other pair.
type Side = 'left' | 'right' | 'top' | 'bottom';
const mirror = (s: Side): Side =>
  s === 'left' ? 'right' : s === 'right' ? 'left' : s === 'top' ? 'bottom' : 'top';

// The two edges a size can bind on. The paper never turns, whatever the
// layout does with the content, so this follows the size alone.
const bindingPair = (size: SizeSpec): [Side, Side] =>
  size.ringsOn === 'top' ? ['top', 'bottom'] : ['left', 'right'];

const PUNCH: Color = [0.78, 0.76, 0.72];
// The creases. Darker than a cut line on purpose: on a folded refill the two
// mean opposite things, and the one you fold along is the one you have to see
// without looking for it.
const CREASE: Color = [0.58, 0.62, 0.68];
// The line that says which way to turn the paper over. Faint, small, and out
// of the way -- it is an instruction to the printer, not part of the refill.
const NOTE: Color = [0.62, 0.60, 0.55];
// Same as the imposition's, because it means the same thing: cut here.
const CUT: Color = [0.72, 0.70, 0.66];
const NOTE_PT = 5;

// What one refill occupies on paper. A fold prints as a single strip of
// panels, so the thing being tiled is the strip, not the page size the binder
// holds.
export const sheetSizeOf = (layout: Layout, size: SizeSpec): { widthMm: number; heightMm: number } => {
  const fold = foldOf(layout, size);
  return fold
    ? { widthMm: fold.sheetWmm, heightMm: fold.sheetHmm }
    : { widthMm: size.widthMm, heightMm: size.heightMm };
};

// The punch on a folded strip: one panel carries it, and turning the strip
// over puts that panel at the other end.
function foldPunchGuide(size: SizeSpec, plan: FoldPlan, flip: boolean): Primitive[] {
  const r = size.ringMarginMm / 2;
  const across = flip ? plan.sheetWmm - r : r;
  return holeCentres(size.holes).map((along): Primitive => ({
    type: 'circle', cx: across, cy: along, r: size.holes.diameterMm / 2,
    stroke: PUNCH, strokeMm: 0.15,
  }));
}

// One side of a folded strip. The strip is one page, so this is that page with
// the creases marked on it -- drawn from the panel sizes rather than from where
// the content happens to break, because the paper bends there whatever is
// printed across it.
//
// In sheet space the strip always stands the way it folds: a fold that runs
// away from the binding lies across the sheet, one that runs along it stands
// down it. Which side is up is decided before this, by `flattenToSheet`.
function foldFace(layout: Layout, size: SizeSpec, plan: FoldPlan, flip: boolean): Primitive[] {
  const sizes = foldPanels(plan).map(p => p.widthMm);
  // Turning the strip over reverses the panels only when the fold runs away
  // from the binding; folding along it mirrors across them.
  const drawn = flip && plan.grain === 'out' ? [...sizes].reverse() : sizes;
  const down = plan.grain === 'along';
  const marks: Primitive[] = [];
  let at = 0;
  for (const span of drawn.slice(0, -1)) {
    at += span;
    marks.push(down
      ? { type: 'line', x1: 1, y1: at, x2: plan.sheetWmm - 1, y2: at, stroke: CREASE, strokeMm: 0.2, dashMm: [4, 2.2] }
      : { type: 'line', x1: at, y1: 1, x2: at, y2: plan.sheetHmm - 1, stroke: CREASE, strokeMm: 0.2, dashMm: [4, 2.2] });
  }
  marks.push(...notchCut(plan, flip));
  return [...marks, ...flattenToSheet(buildPages(layout, size, flip)[0])];
}

// The corner that comes off. Only a fold that runs along the binding has one:
// the panels after the punched one stop short of the holes, so the strip is an
// L and the line where it turns has to be cut.
function notchCut(plan: FoldPlan, flip: boolean): Primitive[] {
  if (plan.insetMm <= 0) return [];
  const line = (x1: number, y1: number, x2: number, y2: number): Primitive =>
    ({ type: 'line', x1, y1, x2, y2, stroke: CUT, strokeMm: 0.15, dashMm: [1.2, 1.2] });
  const near = !flip;
  const x = near ? plan.insetMm : plan.sheetWmm - plan.insetMm;
  return [
    line(x, plan.headMm, x, plan.sheetHmm),
    line(near ? 0 : x, plan.headMm, near ? x : plan.sheetWmm, plan.headMm),
  ];
}

// The spare side of a folded strip, panel by panel: only the punched one keeps
// a ring strip clear.
function foldFiller(
  size: SizeSpec, plan: FoldPlan, fill: BackFill, flip: boolean, pal: Palette,
): Primitive[] {
  if (fill === 'blank') return [];
  const m = 4;
  const down = plan.grain === 'along';
  const sizes = foldPanels(plan).map(p => p.widthMm);
  const order = flip && plan.grain === 'out' ? [...sizes].reverse() : sizes;
  const headAt = flip && plan.grain === 'out' ? order.length - 1 : 0;
  // Whatever the binding takes out of the width, measured once: the ring strip
  // beside the punched panel, or the cut beside the others.
  const keep = Math.max(size.ringMarginMm, plan.insetMm + m);
  const out: Primitive[] = [];
  let at = 0;
  order.forEach((span, i) => {
    const head = i === headAt;
    let area: { x: number; y: number; w: number; h: number };
    if (down) {
      const left = flip ? m : keep;
      const right = flip ? keep : m;
      area = { x: left, y: at + m, w: plan.sheetWmm - left - right, h: span - m * 2 };
    } else {
      const left = at + (head && !flip ? size.ringMarginMm : m);
      const right = at + span - (head && flip ? size.ringMarginMm : m);
      area = { x: left, y: m, w: right - left, h: plan.sheetHmm - m * 2 };
    }
    out.push(...(fill === 'grid' ? drawGrid(area, pal)
      : fill === 'lines' ? drawLines(area, pal)
      : drawMemo(area, pal)));
    at += span;
  });
  return out;
}

// Prints which way to turn the paper over. It goes in the clearance the tiling
// leaves, and when the refills reach the paper's edge there is none -- then it
// sits in the top corner, inside the trim margin every part already keeps
// clear, because a duplex setting nobody can see is a sheet printed twice.
function duplexNote(plan: TilePlan, flip: DuplexFlip): Primitive[] {
  // Sitting the baseline just above the block keeps it on bare paper whenever
  // the tiling leaves any; below 5mm there is nothing to sit in and it falls
  // back to the corner.
  const y = plan.endMm >= 5 ? plan.endMm - 1.4 : 3.6;
  return [{ type: 'text', x: 2.5, y, text: `両面は${flip}`, sizePt: NOTE_PT, color: NOTE }];
}

function punchGuide(size: SizeSpec, side: Side): Primitive[] {
  const vertical = side === 'left' || side === 'right';
  const r = size.ringMarginMm / 2;
  const across = side === 'left' ? r
    : side === 'right' ? size.widthMm - r
    : side === 'top' ? r
    : size.heightMm - r;
  return holeCentres(size.holes).map((along): Primitive => ({
    type: 'circle',
    cx: vertical ? across : along,
    cy: vertical ? along : across,
    r: size.holes.diameterMm / 2,
    stroke: PUNCH,
    strokeMm: 0.15,
  }));
}

function fillerFace(size: SizeSpec, fill: BackFill, side: Side, pal: Palette): Primitive[] {
  if (fill === 'blank') return [];
  const m = 4;
  const ring = size.ringMarginMm;
  const left = side === 'left' ? ring : m;
  const top = side === 'top' ? ring : m;
  const right = size.widthMm - (side === 'right' ? ring : m);
  const bottom = size.heightMm - (side === 'bottom' ? ring : m);
  const area = { x: left, y: top, w: right - left, h: bottom - top };
  if (fill === 'grid') return drawGrid(area, pal);
  if (fill === 'lines') return drawLines(area, pal);
  return drawMemo(area, pal);
}

interface Duplexed { front: SheetContent; back: SheetContent }
interface Face { primitives: Primitive[]; side: Side }

// Parts whose dates come from the run of days a sheet covers rather than from
// its month. One of these on the sheet makes the whole refill repeat by days.
const DAY_PACED: PartKind[] = ['weekvert', 'weekhoriz'];

// Parts the month itself decides the shape of: they draw a row, a column or a
// cell per day, so February and March are not the same sheet. The spec calls
// these the parts with a date on an axis; only the calendar was listed here,
// which meant a refill of day lists, or of a habit tracker, printed one sheet
// for a whole year -- the start month's thirty rows, whatever the range said,
// and no range shown to say otherwise.
export const MONTH_PACED: PartKind[] = ['monthly', 'daylist', 'gantt', 'habit'];

export const isDayPaced = (layout: Layout): boolean =>
  layout.surface.placed.some(k => DAY_PACED.includes(k));

export const hasDatedPart = (layout: Layout): boolean =>
  !!layout.spanning || layout.surface.placed.some(k => MONTH_PACED.includes(k)) || isDayPaced(layout);

// Which placed part owns the date range, for the button that opens it. The
// day-paced ones come first: on a sheet carrying both, the run is paced by
// days and that is the setting the range button has to reach.
export const datedSlotOf = (layout: Layout): number =>
  [...DAY_PACED, ...MONTH_PACED]
    .map(k => layout.surface.placed.indexOf(k))
    .find(i => i >= 0) ?? -1;

// How many sheets the run comes to, which is what the export has to warn
// about: a year of weeks is 52, a year of single days is 365.
export const sheetCount = (layout: Layout): number => {
  if (!hasDatedPart(layout)) return Math.max(1, layout.pages ?? 1);
  if (isDayPaced(layout)) return sheetStarts(layout).length;
  return Math.ceil(Math.max(1, layout.monthCount) / monthsPerSheet(layout));
};

// Every sheet's dates, in order. A weekly paces the refill by days; everything
// else by months.
function sheetsOf(layout: Layout): Layout[] {
  // Nothing dated on it: what decides how many sheets come out is how many
  // were asked for. Ten sheets of squared paper are ten of the same sheet.
  if (!hasDatedPart(layout)) {
    return Array.from({ length: Math.max(1, layout.pages ?? 1) }, () => layout);
  }
  if (isDayPaced(layout)) {
    return sheetStarts(layout).map(start => ({
      ...layout,
      // The month a sheet belongs to is the month it starts in, which is what
      // a calendar printed beside the week should show.
      year: start.getFullYear(),
      month: start.getMonth() + 1,
      sheetStart: isoDate(start),
    }));
  }
  const per = monthsPerSheet(layout);
  return Array.from({ length: Math.ceil(Math.max(1, layout.monthCount) / per) },
    (_, i) => ({ ...layout, ...addMonths(layout.year, layout.month, i * per) }));
}

// What one sheet of a section is, said the way its dates would be read. The
// export screen needs it to answer "what is this page" when someone presses
// one, which is how a run gets cut back to the length it should have been.
export function sheetLabel(layout: Layout, nth: number): string {
  if (!hasDatedPart(layout)) return `${nth + 1}枚目`;
  const all = sheetsOf(layout);
  const sheet = all[Math.max(0, Math.min(nth, all.length - 1))];
  if (isDayPaced(layout) && sheet.sheetStart) {
    const d = new Date(`${sheet.sheetStart}T00:00:00`);
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日の週`;
  }
  const per = monthsPerSheet(layout);
  if (per > 1) {
    const last = addMonths(sheet.year, sheet.month, per - 1);
    return `${sheet.year}年${sheet.month}月・${last.month}月`;
  }
  return `${sheet.year}年${sheet.month}月`;
}

// The last month the run actually prints. With two calendars to a sheet an odd
// number of months still fills its final spread, so what comes out is a month
// further on than the range was set to -- and the range has to say so rather
// than the sheet quietly carrying a month nobody asked for.
export function runEnd(layout: Layout): { year: number; month: number } {
  const months = Math.max(1, layout.monthCount);
  if (!hasDatedPart(layout) || isDayPaced(layout)) {
    return addMonths(layout.year, layout.month, months - 1);
  }
  const per = monthsPerSheet(layout);
  return addMonths(layout.year, layout.month, Math.ceil(months / per) * per - 1);
}

// Every printable face in binder order, sheet after sheet.
function facesInOrder(layout: Layout, size: SizeSpec, duplex: boolean): Face[] {
  const faces: Face[] = [];

  const [near, far] = bindingPair(size);
  const fold = foldOf(layout, size);
  for (const sheet of sheetsOf(layout)) {
    if (fold) {
      // A strip is one face however many panels it carries, so a fold runs
      // front, back, front, back exactly as a single page does.
      const onBack = duplex && faces.length % 2 === 1;
      faces.push({ primitives: foldFace(sheet, size, fold, onBack), side: onBack ? far : near });
    } else if (layout.spread) {
      // A spread is the back of one sheet facing the front of the next, so its
      // first page always lands on a back and its second on a front.
      const pages = buildPages(sheet, size);
      faces.push({ primitives: flattenToSheet(pages[0]), side: far });
      faces.push({ primitives: flattenToSheet(pages[1]), side: near });
    } else {
      // Single pages run front, back, front, back down the stack, and a page
      // on a back binds on the other edge.
      const onBack = duplex && faces.length % 2 === 1;
      const page = buildPages(sheet, size, onBack)[0];
      faces.push({ primitives: flattenToSheet(page), side: onBack ? far : near });
    }
  }
  return faces;
}

// One design's punched sheets, front and back, in binder order. Pulled out of
// the imposition so that several designs can be laid out on one paper: the
// paper does not care whose refill a sheet is, only that they are the same
// size.
function sheetsOfLayout(layout: Layout, size: SizeSpec, opts: PrintOptions): Duplexed[] {
  const faces = facesInOrder(layout, size, opts.duplex);
  const fold = foldOf(layout, size);
  const sheetSize = sheetSizeOf(layout, size);
  // On a fold the far edge is the turned-over strip, which is what decides
  // which end of it the punch goes.
  const flipped = (side: Side) => side === (bindingPair(size)[1] as Side);

  const asSheet = (f: Face): SheetContent => ({
    ...sheetSize,
    primitives: opts.punchGuides
      ? [
          ...(fold ? foldPunchGuide(size, fold, flipped(f.side)) : punchGuide(size, f.side)),
          ...f.primitives,
        ]
      : f.primitives,
  });
  const spare = (side: Side) => asSheet({
    primitives: fold
      ? foldFiller(size, fold, opts.backFill, flipped(side), paletteOf(layout))
      : fillerFace(size, opts.backFill, side, paletteOf(layout)),
    side,
  });

  const sheets: Duplexed[] = [];
  const [near, far] = bindingPair(size);
  if (opts.duplex) {
    let i = 0;
    // A spread begins on a back, so only the very first front is spare.
    if (layout.spread) sheets.push({ front: spare(near), back: asSheet(faces[i++]) });
    while (i < faces.length) {
      const front = asSheet(faces[i++]);
      sheets.push({ front, back: i < faces.length ? asSheet(faces[i++]) : spare(far) });
    }
  } else {
    faces.forEach(f => sheets.push({ front: asSheet(f), back: spare(mirror(f.side)) }));
  }
  return sheets;
}

// Whether two designs can share one sheet of paper. The tiling lays out one
// tile size, so what has to match is the punched sheet -- and that is a
// narrower thing than the refill size: a Bible page and a Bible three-panel
// strip are both "Bible" and are 95×170 and 268.5×170.
//
// A spread and a single page are the same punched sheet, and do mix: a spread
// is two faces of the ordinary sheet, and each design brings its own chain of
// physical sheets, so the pairing inside it survives being laid out next to
// something else. Turning a refill does not change its paper either.
export const sameSheet = (a: Layout, b: Layout, size: SizeSpec): boolean => {
  const x = sheetSizeOf(a, size), y = sheetSizeOf(b, size);
  return a.size === b.size && x.widthMm === y.widthMm && x.heightMm === y.heightMm;
};

// The refills as they will print: every month in the range, flattened onto
// their punched sheets, chained front to back, then laid out on paper.
//
// `also` are other designs of the same sheet to fill the paper with. A year of
// monthlies is twelve refills and an A3 holds sixteen, so the last four places
// would otherwise print as filler and go in the bin.
export function buildPrintSheets(
  layout: Layout, size: SizeSpec, opts: PrintOptions, also: Layout[] = [],
): SheetContent[] {
  const spec = {
    ...DEFAULT_IMPOSE,
    paper: PAPERS[opts.paper], cutLines: opts.cutLines, scalePercent: opts.scalePercent,
  };
  const sheetSize = sheetSizeOf(layout, size);
  const sheets = [layout, ...also.filter(l => sameSheet(l, layout, size))]
    .flatMap(l => sheetsOfLayout(l, size, opts));

  const all = Array.from({ length: Math.max(1, opts.copies) }, () => sheets).flat();

  if (!opts.impose) {
    return opts.duplex ? all.flatMap(s => [s.front, s.back]) : all.map(s => s.front);
  }

  // One plan for the whole job. Both runs place the same number of refills, so
  // the count is the same either way -- but it has to be decided once, or the
  // fronts and the backs could be arranged differently and nothing would line
  // up through the paper.
  const plan = planTiles(sheetSize, spec, all.length);
  const note = duplexNote(plan, duplexFlip(plan));
  const withNote = (page: SheetContent): SheetContent =>
    ({ ...page, primitives: [...page.primitives, ...note] });

  const fronts = impose(all.map(s => s.front), spec, false, plan);
  if (!opts.duplex) return fronts;

  const backs = impose(all.map(s => s.back), spec, true, plan);
  // Interleaved, so a duplex printer lands each back behind its own front.
  return fronts.flatMap((f, i) => (backs[i] ? [withNote(f), withNote(backs[i])] : [withNote(f)]));
}

// How the refills will sit on the paper, for telling the user before they
// print: how many to a sheet, and how close to the paper's edge they come.
// The count matters -- it is what decides which way the paper is turned -- so
// the screen passes what the run actually comes to.
export const paperPlan = (
  size: SizeSpec, count?: number, sheet?: { widthMm: number; heightMm: number },
  paper: PaperId = 'a4',
): TilePlan => planTiles(
  sheet ?? { widthMm: size.widthMm, heightMm: size.heightMm },
  { ...DEFAULT_IMPOSE, paper: PAPERS[paper] },
  count,
);

export const perPaperCount = (
  size: SizeSpec, count?: number, sheet?: { widthMm: number; heightMm: number },
  paper: PaperId = 'a4',
): number => paperPlan(size, count, sheet, paper).perPage;

// What the export screen has to say before anything is printed: a duplex job
// only lands right if the paper is turned the way the tiling assumes.
export const duplexFlipOf = (
  layout: Layout, size: SizeSpec, count?: number, paper: PaperId = 'a4',
): DuplexFlip => duplexFlip(paperPlan(size, count, sheetSizeOf(layout, size), paper));

// How many physical refill sheets a run comes to, which is what a single
// imposition run has to place. A spread is two faces on one sheet's back and
// the next one's front, so it is not simply the sheet count.
export const imposeCount = (
  layout: Layout, size: SizeSpec, opts: PrintOptions, also: Layout[] = [],
): number => [layout, ...also.filter(l => sameSheet(l, layout, size))].reduce((n, l) => {
  const faces = facesInOrder(l, size, opts.duplex).length * Math.max(1, opts.copies);
  return n + (opts.duplex ? Math.ceil(faces / 2) + (l.spread ? 1 : 0) : faces);
}, 0);

// The nearest ink gets to the edge of a refill, which is what decides whether
// a printer's unprintable border eats any of it. Measured, not assumed: the
// content sits OUTER_MM in with each part's own PAD on top of that, and the
// punch guide is a circle whose outer rim comes nearer still. Only the edges
// with no clearance are at risk, so the caller pairs this with the plan.
export const INK_INSET_MM = 4.2;
export const punchInset = (size: SizeSpec): number =>
  size.ringMarginMm / 2 - size.holes.diameterMm / 2;

