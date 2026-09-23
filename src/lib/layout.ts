import type {
  FoldCount, FoldGroup, Layout, PageKey, PartKind, SizeSpec, Spanning, Surface,
} from '../types';
import { MAX_PARTS, PART_FIT } from '../types';
import type { FoldPanels, FoldPlan } from './fold';
import { foldGroups, foldPanels, foldPlan } from './fold';
import type { SheetRotation } from './draw';
import { monthGrid } from './dates';
import { holeCentres, SIZES } from './sizes';

// All geometry here is millimetres. Nothing knows about screens or CSS; the
// editor scales it and the PDF exporter prints it, so what you drag is what
// you print.
//
// Two coordinate spaces matter:
//   page space    — one physical sheet as the user reads it
//   surface space — the area left over once the calendar has its band, with a
//                   spread's two halves laid end to end. A region that crosses
//                   the halfway mark spans the gutter; one that does not sits
//                   on a single page.

export type RingEdge = 'left' | 'right' | 'top' | 'bottom';

export interface Rect { x: number; y: number; w: number; h: number }

export type DividerKey = 'span' | 'a' | 'b' | 'c';

// Where a part was dropped, in surface millimetres. `band` is set when the
// pointer was over the calendar rather than over the surface, and says how
// far down the calendar it landed: near its foot means under it, anywhere
// else means beside it.
// What a drop works out to. `landed` is the region the first dropped part
// ends up in, so the editor can show where it is going before the finger
// comes off the glass.
export interface Placement {
  layout: Layout;
  overflow: number;
  landed: number | null;
}

export interface DropPoint {
  sx: number;
  sy: number;
  band?: number;
}

export interface Divider {
  id: string;
  key: DividerKey;
  // Which fold group's ratio this border belongs to. A plain sheet has one
  // set of ratios and leaves this out.
  group?: number;
  axis: 'h' | 'v';
  x: number; y: number; length: number;
  ratio: number;
  // The extent the ratio is a fraction of, so a drag converts back to a ratio.
  extentMm: number;
}

// Where a page's slice of the surface sits, in both spaces.
export interface SurfaceSlice {
  key: PageKey;
  fromMm: number;
  toMm: number;
  // Page-space position of this slice's top-left corner.
  ox: number;
  oy: number;
}

export interface PageGeometry {
  key: PageKey;
  widthMm: number;
  heightMm: number;
  sheet: { widthMm: number; heightMm: number; rotation: SheetRotation };
  ringEdge: RingEdge;
  ringBand: Rect;
  holes: { cx: number; cy: number; r: number }[];
  spanRect: Rect | null;
  // The calendar band's lower edge, draggable in page space.
  spanDivider: Divider | null;
}

export interface Geometry {
  pages: PageGeometry[];
  landscape: boolean;
  flow: 'row' | 'column';
  // Where the paper bends, in surface millimetres. Empty unless this is a
  // fold. A crease is not a page boundary -- the strip is one sheet and one
  // canvas -- so it is carried separately, for the editor to mark and for
  // the print path to draw a fold line on.
  creases: number[];
  surface: {
    widthMm: number;
    heightMm: number;
    slices: SurfaceSlice[];
    // One rect per placed part, in surface space.
    regions: Rect[];
    dividers: Divider[];
  };
}

const EVEN = 0.5;
// Trim margin on the edges that are not the binding. Parts add their own small
// inset on top of this, so a few millimetres here is enough to stop the content
// reading as cramped without eating the page.
export const OUTER_MM = 3;
export const MIN_RATIO = 0.18;
// How far down the calendar a drop stops meaning "beside it" and starts
// meaning "under it".
export const BESIDE_BAND = 0.75;
export const MAX_RATIO = 0.82;

// The calendar's weekday header. It lives here because the spread geometry has
// to reserve it on both pages to keep the week rows the same height.
export const MONTHLY_HEADER_MM = 3.8;

// A landscape spread puts the fuller half first: five weeks go three and two,
// and the shorter page's leftover becomes writing space.
export function weekSplit(totalRows: number): [number, number] {
  const top = Math.ceil(totalRows / 2);
  return [top, totalRows - top];
}

// The fold this layout asks for, or null when it is a plain refill. A size
// whose panels would come out unusably narrow simply does not fold, and the
// layout falls back to one page rather than drawing something that cannot be
// folded.
export const foldOf = (layout: Layout, size: SizeSpec): FoldPlan | null =>
  foldCountOf(layout) > 1 ? foldPlan(size, foldCountOf(layout) as FoldPanels) : null;

// Defaulted rather than read straight off the layout: a layout that reached
// here without going through the migration has no say in whether it folds,
// and `undefined > 1` quietly answering "no" to one question and "not
// portrait" to the next is the kind of thing that shows up as a turned page.
export const foldCountOf = (layout: Layout): FoldCount => layout.fold ?? 1;

// A 蛇腹 is upright only. Turning it a quarter turn would put the rings along
// the top, and a page turned about its top edge shows its back upside down --
// so the back of every panel would have to print inverted, and the duplex
// setting would stop matching the one the sheet asks for. Not worth it for a
// shape the binder holds sideways anyway.
export const canTurn = (layout: Layout, size: SizeSpec): boolean => !foldOf(layout, size);

// Landscape is the planner turned a quarter turn. It never transposes a
// calendar grid — only the page shape and the ring edge change.
export const isLandscape = (layout: Layout): boolean =>
  layout.orientation === 'landscape' && foldCountOf(layout) <= 1;

// Whether the rings run along the top of the sheet rather than down its side.
// A refill bound on its long edge has them on the side until it is turned a
// quarter turn; one bound on its short edge starts the other way round. This
// decides the ring edge, which way a spread opens, and how the calendar is
// split across it -- everything that follows from where the binder holds the
// paper, as opposed to how the paper is shaped.
export const ringsOnTop = (layout: Layout): boolean =>
  ((SIZES[layout.size].ringsOn ?? 'side') === 'side') === isLandscape(layout);

// The panel keys a fold uses, in the order they sit on the strip. Counted from
// the punched panel, so f1 is always the one in the rings however the strip is
// turned over.
export const foldKeys = (count: FoldCount): PageKey[] =>
  (['f1', 'f2', 'f3'] as PageKey[]).slice(0, count);

function ringEdgeFor(spread: boolean, onTop: boolean, key: PageKey, flip: boolean): RingEdge {
  // A single sheet binds on its outer edge. In a spread the binding is always
  // the seam between the two pages, whichever way the pages sit.
  //
  // `flip` is for a single page printed on the back of a sheet: turning the
  // paper over puts the binding on the other side.
  if (!spread) {
    if (onTop) return flip ? 'bottom' : 'top';
    return flip ? 'right' : 'left';
  }
  if (onTop) return key === 'left' ? 'bottom' : 'top';
  return key === 'left' ? 'right' : 'left';
}

// Which way a surface wants to be cut: a long thin strip divides across its
// length, so both halves stay usable. Splitting the strip left over under a
// spread calendar the other way would leave two bands too shallow to write in.
export const splitFor = (w: number, h: number): 'h' | 'v' => (w >= h ? 'v' : 'h');

const cut = (r: Rect, ratio: number, vertical: boolean): [Rect, Rect] => vertical
  ? [{ ...r, w: r.w * ratio }, { ...r, x: r.x + r.w * ratio, w: r.w * (1 - ratio) }]
  : [{ ...r, h: r.h * ratio }, { ...r, y: r.y + r.h * ratio, h: r.h * (1 - ratio) }];

function splitRegions(count: number, s: Surface, w: number, h: number): Rect[] {
  const a = s.ratios.a ?? EVEN, b = s.ratios.b ?? EVEN, c = s.ratios.c ?? EVEN;
  if (count <= 0) return [];
  // One part owns the whole surface. Space is only carved up once something
  // else actually joins it — never reserved in advance.
  const whole = { x: 0, y: 0, w, h };
  if (count === 1) return [whole];

  const vertical = s.split === 'v';
  const [r1, r2] = cut(whole, a, vertical);
  if (count === 2) return [r1, r2];
  // Anything further divides the other way, so regions stay close to square.
  if (count === 3) return [r1, ...cut(r2, b, !vertical)];
  return [...cut(r1, b, !vertical), ...cut(r2, c, !vertical)];
}

function surfaceDividers(count: number, s: Surface, w: number, h: number): Divider[] {
  const a = s.ratios.a ?? EVEN, b = s.ratios.b ?? EVEN, c = s.ratios.c ?? EVEN;
  if (count < 2) return [];

  const vertical = s.split === 'v';
  const whole = { x: 0, y: 0, w, h };
  const [r1, r2] = cut(whole, a, vertical);
  const border = (id: DividerKey, r: Rect, ratio: number, vert: boolean): Divider => vert
    ? { id, key: id, axis: 'v', x: r.x + r.w * ratio, y: r.y, length: r.h, ratio, extentMm: r.w }
    : { id, key: id, axis: 'h', x: r.x, y: r.y + r.h * ratio, length: r.w, ratio, extentMm: r.h };

  const out = [border('a', whole, a, vertical)];
  if (count === 3) out.push(border('b', r2, b, !vertical));
  if (count === 4) {
    out.push(border('b', r1, b, !vertical));
    out.push(border('c', r2, c, !vertical));
  }
  return out;
}

interface PageBox {
  edge: RingEdge;
  ringBand: Rect;
  ox: number; oy: number;
  usableW: number; usableH: number;
}

function pageBox(spread: boolean, onTop: boolean, key: PageKey, W: number, H: number, ring: number, flip: boolean): PageBox {
  const edge = ringEdgeFor(spread, onTop, key, flip);
  const vertical = edge === 'left' || edge === 'right';
  const O = OUTER_MM;
  // The ring strip is the margin on the binding edge; the other three get the
  // trim margin.
  return {
    edge,
    ringBand: vertical
      ? { x: edge === 'left' ? 0 : W - ring, y: 0, w: ring, h: H }
      : { x: 0, y: edge === 'top' ? 0 : H - ring, w: W, h: ring },
    ox: vertical ? (edge === 'left' ? ring : O) : O,
    oy: vertical ? O : (edge === 'top' ? ring : O),
    usableW: vertical ? W - ring - O : W - O * 2,
    usableH: vertical ? H - O * 2 : H - ring - O,
  };
}

// Holes are measured along the sheet's binding edge, which is its long side in
// both orientations. The patterns are symmetric end to end, so turning the page
// a quarter turn does not change where they land.
function punchHoles(box: PageBox, size: SizeSpec) {
  const vertical = box.edge === 'left' || box.edge === 'right';
  const across = vertical
    ? box.ringBand.x + box.ringBand.w / 2
    : box.ringBand.y + box.ringBand.h / 2;
  const r = size.holes.diameterMm / 2;
  return holeCentres(size.holes).map(along => ({
    cx: vertical ? across : along,
    cy: vertical ? along : across,
    r,
  }));
}

interface Pane { key: PageKey; W: number; H: number; box: PageBox }

// A fold prints on one strip of paper, so it is one page: the panels are not
// separate sheets and nothing is trimmed where they meet. Only the punched
// panel's outer edge keeps a ring strip clear; the far end takes the ordinary
// trim margin, and everything between is continuous paper. Turning the strip
// over puts the punched panel -- and its rings -- at the other end.
function foldStripPane(plan: FoldPlan, H: number, ring: number, flip: boolean): Pane {
  const W = plan.alongMm;
  const O = OUTER_MM;
  const edge: RingEdge = flip ? 'right' : 'left';
  return {
    key: 'f1', W, H,
    box: {
      edge,
      ringBand: { x: flip ? W - ring : 0, y: 0, w: ring, h: H },
      ox: flip ? O : ring,
      oy: O,
      usableW: W - ring - O,
      usableH: H - O * 2,
    },
  };
}

// The creases, in surface millimetres. Measured from the punched end, so
// turning the strip over reverses them with the panels.
function foldCreases(plan: FoldPlan, ox: number, flip: boolean): number[] {
  const widths = foldPanels(plan).map(p => p.widthMm);
  const drawn = flip ? [...widths].reverse() : widths;
  const out: number[] = [];
  let at = 0;
  for (let i = 0; i < drawn.length - 1; i++) {
    at += drawn[i];
    out.push(at - ox);
  }
  return out;
}

// How the panels are shared out. A layout that has not said -- one saved
// before groups existed, or one with nothing on it yet -- gets the reading
// that was true then: every part on its own panel, or the single part across
// the whole strip.
export function foldLayoutOf(surface: Surface, panels: number): FoldGroup[] {
  const count = surface.placed.length;
  const saved = surface.fold;
  if (saved?.length) {
    const ok = saved.reduce((t, g) => t + g.parts, 0) === count
      && saved.reduce((t, g) => t + g.panels, 0) === panels;
    if (ok) return saved;
  }
  if (count === 0) return [];
  if (count > panels) return [{ panels, parts: count }];
  return foldGroups(panels, count).map(([a, b]) => ({ panels: b - a + 1, parts: 1 }));
}

// Where each group sits on the strip, in surface millimetres. The trim margin
// goes on at whichever ends are creases, so a group stops short of a fold it
// does not cross and runs straight through one it does.
function foldRects(
  groups: FoldGroup[], creases: number[], surfaceW: number, surfaceH: number,
): Rect[] {
  const edges = [0, ...creases, surfaceW];
  const out: Rect[] = [];
  let panel = 0;
  for (const g of groups) {
    const a = panel, b = Math.min(panel + g.panels - 1, creases.length);
    const from = edges[a] + (a > 0 ? OUTER_MM : 0);
    const to = edges[b + 1] - (b < creases.length ? OUTER_MM : 0);
    out.push({ x: from, y: 0, w: Math.max(0, to - from), h: surfaceH });
    panel += g.panels;
  }
  return out;
}

// A group divides its own area exactly as a sheet divides its surface, so the
// same splitter does both -- it is handed the group's parts, ratios and
// direction, and its answer is moved onto the strip.
const groupSurface = (g: FoldGroup, placed: PartKind[], r: Rect): Surface => ({
  placed,
  ratios: g.ratios ?? {},
  split: g.split ?? splitFor(r.w, r.h),
});

// `flipBinding` mirrors a single page's binding edge, for when that page is
// printed on the back of a sheet.
export function buildGeometry(layout: Layout, size: SizeSpec, flipBinding = false): Geometry {
  const fold = foldOf(layout, size);
  const landscape = isLandscape(layout);
  // Where the rings are is not the same question as which way the sheet is
  // turned: a card bound across its top is upright with the rings on top.
  const onTop = ringsOnTop(layout);
  const W = landscape ? size.heightMm : size.widthMm;
  const H = landscape ? size.widthMm : size.heightMm;
  const ring = size.ringMarginMm;
  // A fold prints as one strip, not as separate sheets: the panels are cut
  // apart by nobody, they are folded.
  const sheet = fold
    ? { widthMm: fold.alongMm, heightMm: fold.acrossMm, rotation: 0 as SheetRotation }
    : {
        widthMm: size.widthMm,
        heightMm: size.heightMm,
        rotation: (landscape ? 90 : 0) as SheetRotation,
      };

  const boxes: Pane[] = fold
    ? [foldStripPane(fold, H, ring, flipBinding)]
    : (layout.spread ? (['left', 'right'] as PageKey[]) : (['single'] as PageKey[]))
        .map(key => ({ key, W, H, box: pageBox(layout.spread, onTop, key, W, H, ring, flipBinding) }));
  const usableH = boxes[0].box.usableH;

  // Band heights. A spread whose pages stack gives them different week counts,
  // so the shorter page's band is shorter too and its rows stay the same
  // height.
  const span = layout.spanning;
  const totalRows = monthGrid(layout.year, layout.month, layout.weekStart).length;
  const bandOf = (key: PageKey): number => {
    if (!span) return 0;
    const top = usableH * span.ratio;
    if (!onTop) return top;
    const [topRows, bottomRows] = weekSplit(totalRows);
    const rowH = (top - MONTHLY_HEADER_MM) / topRows;
    return key === 'left' ? top : MONTHLY_HEADER_MM + rowH * bottomRows;
  };

  const pages: PageGeometry[] = boxes.map(({ key, W: paneW, box }) => {
    const bandH = bandOf(key);
    // Dragging either page's band edge moves the same ratio; on the shorter
    // page of a stacked spread a millimetre of drag is worth proportionally
    // more ratio, so its extent shrinks to match.
    const extent = span && span.ratio > 0 ? bandH / span.ratio : usableH;
    return {
      key,
      widthMm: paneW,
      heightMm: H,
      sheet,
      ringEdge: box.edge,
      ringBand: box.ringBand,
      holes: punchHoles(box, size),
      spanRect: span ? { x: box.ox, y: box.oy, w: box.usableW, h: bandH } : null,
      spanDivider: span && layout.surface.placed.length > 0
        ? { id: `${key}-span`, key: 'span', axis: 'h', x: box.ox, y: box.oy + bandH, length: box.usableW, ratio: span.ratio, extentMm: extent }
        : null,
    };
  });

  // Pages whose band leaves room contribute a slice of the surface. In a
  // stacked spread the fuller page is filled by the calendar, so the surface
  // is only the shorter page's leftover.
  const slices: SurfaceSlice[] = [];
  let cursor = 0;
  boxes.forEach(({ key, box }) => {
    // A surface held to one page of a spread contributes only that page; the
    // other stays blank, which is what was asked for by dropping on the edge.
    if (layout.surface.page && key !== layout.surface.page) return;
    const leftover = box.usableH - bandOf(key);
    if (leftover <= 0.5) return;
    slices.push({ key, fromMm: cursor, toMm: cursor + box.usableW, ox: box.ox, oy: box.oy + bandOf(key) });
    cursor += box.usableW;
  });

  const surfaceW = cursor;
  const surfaceH = slices.length ? Math.min(...slices.map(s => {
    const box = boxes.find(b => b.key === s.key)!.box;
    return box.usableH - bandOf(s.key);
  })) : 0;

  const count = layout.surface.placed.length;
  // A crease is not a divider. The paper bends there, so a part cannot be
  // dragged across one and the panels are the surface's divisions -- fixed by
  // the fold, not by a ratio. One part to a panel, which is also what a folded
  // refill is for: a month you turn to rather than a page you share.
  const creases = fold ? foldCreases(fold, boxes[0].box.ox, flipBinding) : [];
  const groups = fold ? foldLayoutOf(layout.surface, creases.length + 1) : [];
  const rects = foldRects(groups, creases, surfaceW, surfaceH);
  const partsOf = (i: number): PartKind[] => {
    const from = groups.slice(0, i).reduce((t, g) => t + g.parts, 0);
    return layout.surface.placed.slice(from, from + groups[i].parts);
  };
  const shift = (r: Rect, by: Rect): Rect => ({ ...r, x: r.x + by.x, y: r.y + by.y });

  const foldRegions = (): Rect[] => groups.flatMap((g, i) =>
    splitRegions(g.parts, groupSurface(g, partsOf(i), rects[i]), rects[i].w, rects[i].h)
      .map(r => shift(r, rects[i])));

  const foldDividers = (): Divider[] => groups.flatMap((g, i) =>
    surfaceDividers(g.parts, groupSurface(g, partsOf(i), rects[i]), rects[i].w, rects[i].h)
      .map(d => ({ ...d, id: `f${i}-${d.id}`, x: d.x + rects[i].x, y: d.y + rects[i].y, group: i })));

  return {
    pages,
    landscape,
    // Pages hanging from rings along their top stack; pages held at their
    // side sit next to each other. A fold is one page, so its flow never
    // comes up.
    flow: !fold && layout.spread && onTop ? 'column' : 'row',
    creases,
    surface: {
      widthMm: surfaceW,
      heightMm: surfaceH,
      slices,
      regions: fold ? foldRegions() : splitRegions(count, layout.surface, surfaceW, surfaceH),
      dividers: fold ? foldDividers() : surfaceDividers(count, layout.surface, surfaceW, surfaceH),
    },
  };
}

// How much of a side-by-side split a column-shaped part should take. Only
// one of the two can be a column -- two columns side by side is just an even
// split -- and it gets the width its content needs rather than half the
// sheet. The extra quarter over the bare minimum is writing room.
function columnShare(surface: Surface, totalMm: number): number | null {
  const [a, b] = surface.placed;
  const tall = (k: PartKind) => PART_FIT[k].prefer === 'tall';
  if (tall(a) === tall(b) || totalMm <= 0) return null;
  const column = tall(a) ? a : b;
  const share = (PART_FIT[column].minWMm * 1.25) / totalMm;
  if (share >= EVEN) return null;
  return tall(a) ? Math.max(MIN_RATIO, share) : Math.min(MAX_RATIO, 1 - share);
}

function fits(kind: PartKind, r: Rect): boolean {
  const f = PART_FIT[kind];
  // Any shape the part can take is a fit. A day list refused for being 50mm
  // short of a 31-row column still fits as two columns of sixteen.
  return [f, ...(f.alt ?? [])].some(s => r.w >= s.minWMm && r.h >= s.minHMm);
}

function everyPartFits(layout: Layout, size: SizeSpec): boolean {
  const { regions } = buildGeometry(layout, size).surface;
  return layout.surface.placed.every((kind, i) => !!regions[i] && fits(kind, regions[i]));
}

// Every order of the parts. Four land at once at most, so this tops out at
// twenty-four arrangements to try.
function orderings<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  const out: T[][] = [];
  items.forEach((item, i) => {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const tail of orderings(rest)) out.push([item, ...tail]);
  });
  return out;
}

// Works out where a dropped part goes, and refuses rather than squeezing it
// into a region too small to write in. Returns null when nothing fits.
//
// A spread can carry its calendar two ways. Normally it is one calendar across
// both pages -- the band -- which is what printed refills do when the month is
// the whole point of the spread. But a month on one page facing a list of days
// on the other is just as standard, and there the calendar is an ordinary part
// holding one page. The band is tried first; when nothing fits underneath it,
// the calendar gives up spanning and becomes a part like any other.
// A drop point is in the surface space of the layout the user was looking at.
// When the calendar leaves the band that surface changes shape -- a strip
// under the calendar becomes the whole spread -- so the point is carried over
// by the page it landed on rather than by its millimetres. Without this a part
// dropped on the right page can come out on the left.
function remapDrop(
  at: DropPoint, prev: Layout, next: Layout, size: SizeSpec,
): DropPoint {
  const a = buildGeometry(prev, size).surface;
  const b = buildGeometry(next, size).surface;
  // A drop on the calendar itself sits above the surface, so the height ratio
  // would carry it outside the new one. It lands on the page the pointer was
  // over, at whatever height that page has.
  const sy = Math.max(0, Math.min(b.heightMm,
    a.heightMm > 0 ? (at.sy / a.heightMm) * b.heightMm : at.sy));
  // With the calendar over the whole spread there are no slices to map from;
  // the drop already carries the page in its width.
  if (!a.slices.length || !b.slices.length) return { sx: at.sx, sy };
  const from = a.slices.find(s => at.sx >= s.fromMm && at.sx <= s.toMm) ?? a.slices[a.slices.length - 1];
  const to = b.slices.find(s => s.key === from.key) ?? b.slices[0];
  const across = from.toMm - from.fromMm;
  const share = across > 0 ? (at.sx - from.fromMm) / across : 0.5;
  return { sx: to.fromMm + share * (to.toMm - to.fromMm), sy };
}

// How far in from a spread's outer edge still counts as asking for that page
// alone. A quarter of the page: far enough in to be deliberate, and it leaves
// the middle half of the spread meaning what it always meant.
const EDGE_SHARE = 0.25;

// Which page a drop is asking for, or null for the spread as a whole. Only
// the first thing on an empty spread can ask: once something is placed, the
// surface has a shape and a drop against its edge means a region within it.
function edgePage(layout: Layout, size: SizeSpec, at: DropPoint): PageKey | null {
  if (!layout.spread || layout.surface.placed.length > 0 || layout.spanning) return null;
  const { slices } = buildGeometry(layout, size).surface;
  if (slices.length < 2) return null;
  const first = slices[0];
  const last = slices[slices.length - 1];
  if (at.sx <= first.fromMm + (first.toMm - first.fromMm) * EDGE_SHARE) return first.key;
  if (at.sx >= last.toMm - (last.toMm - last.fromMm) * EDGE_SHARE) return last.key;
  return null;
}

// Which panel a drop landed on. Nowhere in particular means the last one.
function panelAt(layout: Layout, size: SizeSpec, at: DropPoint | null): number {
  const { creases } = buildGeometry(layout, size);
  if (!at) return creases.length;
  return creases.filter(c => at.sx > c).length;
}

// How much a fold can carry. Two to a panel: a panel is a page, and a page of
// a folded refill is small enough that a third thing on it is a stripe rather
// than a place to write.
export const foldMaxParts = (panels: number): number => panels * 2;

// Adding one part to a fold. The creases decide the shape, so there are only
// two things that can happen: the panel dropped on splits off as its own
// division, or -- if it already is one -- the part joins what is there and the
// two share it, with a border between them to drag.
function addToFold(
  groups: FoldGroup[], panels: number, placed: PartKind[], kind: PartKind,
  panel: number, stack: boolean,
): { groups: FoldGroup[]; placed: PartKind[]; at: number } | null {
  if (!groups.length) {
    return { groups: [{ panels, parts: 1 }], placed: [kind], at: 0 };
  }
  let lo = 0, g = 0;
  for (; g < groups.length; g++) {
    if (panel < lo + groups[g].panels) break;
    lo += groups[g].panels;
  }
  if (g >= groups.length) { g = groups.length - 1; lo -= groups[g].panels; }
  const group = groups[g];
  const hi = lo + group.panels - 1;
  const before = groups.slice(0, g).reduce((t, x) => t + x.parts, 0);

  // Dropped low, or onto a panel that is already a division of its own:
  // share what is there rather than breaking the paper up further. Low means
  // the same quarter of the height that puts a part under a spread's calendar
  // -- one gesture, whichever shape is on the screen.
  if (group.panels === 1 || stack) {
    if (group.parts >= MAX_PARTS) return null;
    const at = before + group.parts;
    return {
      // Under, not beside: that is what the drop said.
      groups: groups.map((x, i) => (i === g ? { ...x, parts: x.parts + 1, split: 'h' } : x)),
      placed: [...placed.slice(0, at), kind, ...placed.slice(at)],
      at,
    };
  }

  // Spans more than one: the dropped panel breaks off, and what was here keeps
  // the rest. Dropping on the near end puts the new part first, so the split
  // always leaves two runs of panels rather than a hole in the middle.
  const near = panel === lo;
  const kept: FoldGroup = {
    ...group,
    panels: near ? group.panels - 1 : panel - lo,
    // The ratios described a different shape; keeping them would move borders
    // nobody dragged.
    ratios: {},
  };
  const made: FoldGroup = { panels: near ? 1 : hi - panel + 1, parts: 1 };
  const at = near ? before : before + group.parts;
  return {
    groups: [...groups.slice(0, g), ...(near ? [made, kept] : [kept, made]), ...groups.slice(g + 1)],
    placed: [...placed.slice(0, at), kind, ...placed.slice(at)],
    at,
  };
}

// Taking one out. The group it was in gives up a part, and a group left with
// none gives its panels back to the neighbour rather than leaving a gap.
export function removeFromFold(surface: Surface, panels: number, slot: number): Surface {
  const groups = foldLayoutOf(surface, panels);
  const placed = surface.placed.filter((_, i) => i !== slot);
  let seen = 0;
  const next: FoldGroup[] = [];
  for (const g of groups) {
    const mine = slot >= seen && slot < seen + g.parts;
    seen += g.parts;
    const parts = mine ? g.parts - 1 : g.parts;
    if (parts === 0) {
      // Fold its panels into whichever neighbour there is.
      if (next.length) next[next.length - 1].panels += g.panels;
      else if (groups.length > 1) groups[groups.indexOf(g) + 1].panels += g.panels;
      continue;
    }
    next.push({ ...g, parts, ratios: mine ? {} : g.ratios });
  }
  return { ...surface, placed, fold: placed.length ? next : undefined };
}

// A fold fills panels, so placing is a question of which panel rather than of
// how to divide one shared area. Nothing to search: the panel widths are the
// paper's, and a part either fits where it lands or does not.
function placeOnFold(
  prev: Layout, size: SizeSpec, fold: FoldPlan, kinds: PartKind[], at: DropPoint | null,
): Placement | null {
  const panel = panelAt(prev, size, at);
  // Low on the paper means under what is there; anywhere else means the panel
  // dropped on becomes a division of its own.
  const surfaceH = buildGeometry(prev, size).surface.heightMm;
  const stack = !!at && surfaceH > 0 && at.sy > surfaceH * BESIDE_BAND;
  const room = foldMaxParts(fold.panels) - prev.surface.placed.length;
  const toAdd = kinds.slice(0, Math.max(0, room));
  if (!toAdd.length) return null;

  let groups = foldLayoutOf(prev.surface, fold.panels);
  let placed = prev.surface.placed;
  let landed: number | null = null;
  for (const kind of toAdd) {
    const step = addToFold(groups, fold.panels, placed, kind, panel, stack);
    if (!step) return null;
    groups = step.groups;
    placed = step.placed;
    if (landed === null) landed = step.at;
  }

  const layout: Layout = {
    ...prev,
    // The band is a spread's way of holding one calendar across two pages. A
    // fold has no seam to cross, so the calendar is an ordinary part.
    spanning: null,
    surface: { ...prev.surface, placed, fold: groups, page: undefined },
  };
  if (!everyPartFits(layout, size)) return null;
  return { layout, overflow: kinds.length - toAdd.length, landed };
}

export function placeParts(
  prev: Layout, size: SizeSpec, kinds: PartKind[], at: DropPoint | null,
): Placement | null {
  const fold = foldOf(prev, size);
  if (fold) return placeOnFold(prev, size, fold, kinds, at);

  // Dropped against the outer edge of a spread: that page, and the facing one
  // left blank. A calendar arriving this way is a part on a page rather than
  // the band across both, which is the whole point of aiming at the edge.
  const page = at ? edgePage(prev, size, at) : null;
  if (page) {
    const onePage: Layout = { ...prev, surface: { ...prev.surface, page } };
    const held = attempt(onePage, size, kinds, remapDrop(at!, prev, onePage, size), true);
    if (held) return held;
  }
  // Dropping onto the calendar, rather than under it, asks for a place beside
  // it. The band runs the full width of the spread, so there is no side of it
  // to be on: the only arrangement that answers the gesture is the calendar
  // holding one page and the new part the other. A drop near the calendar's
  // foot still means underneath -- that is where the part would land -- so
  // only the upper part of it counts as beside.
  const beside = !!at && at.band !== undefined && at.band < BESIDE_BAND
    && prev.spread && !!prev.spanning;

  if (!beside) {
    const spanned = attempt(prev, size, kinds, at);
    if (spanned) return spanned;
  }
  if (!prev.spread) return null;

  // The calendar is already the band, so take it out of the band and let it
  // queue for a region like anything else.
  if (prev.spanning) {
    const onOnePage: Layout = {
      ...prev,
      spanning: null,
      // First, so an even split hands it the left page.
      surface: { ...prev.surface, placed: ['monthly', ...prev.surface.placed], ratios: {} },
    };
    const sideways = onOnePage.surface.placed.length <= MAX_PARTS
      ? attempt(onOnePage, size, kinds, at && remapDrop(at, prev, onOnePage, size), true)
      : null;
    if (sideways) return sideways;
    // Nothing fits beside the calendar after all, so the band was the better
    // answer to begin with.
    return beside ? attempt(prev, size, kinds, { sx: at!.sx, sy: 0 }) : null;
  }
  // The calendar is arriving now and no band fits around what is already
  // here, so it lands as an ordinary part instead of being refused.
  if (kinds.includes('monthly')) return attempt(prev, size, kinds, at, true);
  return null;
}

function attempt(
  prev: Layout, size: SizeSpec, kinds: PartKind[], at: DropPoint | null,
  monthlyAsPart = false,
): Placement | null {
  let spanning = prev.spanning;
  let rest = kinds;
  // On a spread the calendar is one part across both pages, so it becomes the
  // band rather than a surface region.
  if (prev.spread && !spanning && !monthlyAsPart && kinds.includes('monthly')) {
    spanning = { ratio: 1 };
    rest = kinds.filter(k => k !== 'monthly');
  }
  // The calendar keeps the whole page until something else actually joins it —
  // space is never reserved in advance.
  // Anything sharing the sheet counts, whether it is arriving now or was
  // already here: a calendar that keeps the whole page would leave the parts
  // under it nothing to stand on.
  const joining = !!spanning && (rest.length > 0 || prev.surface.placed.length > 0);
  const bandStart = joining && spanning!.ratio >= 0.95
    ? (isLandscape(prev) ? 0.48 : 0.72)
    : spanning?.ratio ?? 0;
  // If that share still leaves too little, the calendar gives up more rather
  // than the part being refused. A share is a preference; a part that fits
  // nowhere is a dead end. Micro 5 is the case that made this necessary: the
  // fixed 72% left 27.7mm against a to-do list's 28mm.
  const bands: (Spanning | null)[] = spanning
    ? (joining ? [bandStart, bandStart * 0.85, bandStart * 0.7] : [bandStart])
        .map(ratio => ({ ...spanning!, ratio: Math.max(MIN_RATIO, ratio) }))
    : [null];

  const cur = prev.surface;
  const room = MAX_PARTS - cur.placed.length;
  const toAdd = rest.slice(0, room);
  const overflow = rest.length - toAdd.length;
  if (toAdd.length === 0) {
    // Nothing new to arrange, but the band has changed shape, so what is
    // already placed still has to fit under it.
    for (const band of bands) {
      const layout = { ...prev, spanning: band };
      if (everyPartFits(layout, size)) return { layout, overflow, landed: null };
    }
    return null;
  }

  const candidates: Surface[] = [];
  if (cur.placed.length === 1 && toAdd.length === 1) {
    const incoming = toAdd[0];
    const { widthMm, heightMm } = buildGeometry(prev, size).surface;
    const pref = PART_FIT[incoming].prefer;
    // A part that needs width gets a full-width band; one that stacks items
    // gets a full-height column; anything else follows the surface's shape.
    const order: ('h' | 'v')[] = pref === 'wide' ? ['h', 'v']
      : pref === 'tall' ? ['v', 'h']
      : splitFor(widthMm, heightMm) === 'v' ? ['v', 'h'] : ['h', 'v'];
    for (const split of order) {
      const first = at
        ? (split === 'v' ? at.sx < widthMm / 2 : at.sy < heightMm / 2)
        : false;
      // Spread, not rebuilt: an arrangement is the surface with its parts
      // rearranged, and anything else the surface carries -- the page it is
      // held to -- belongs to the surface, not to the arrangement.
      candidates.push({
        ...cur,
        placed: first ? [incoming, ...cur.placed] : [...cur.placed, incoming],
        ratios: {},
        split,
      });
    }
  } else {
    // Several at once. Dropping the same parts one by one lets each drop pick
    // a direction and a slot, so a single gesture has to search that same
    // space -- otherwise it refuses arrangements that plainly work by hand.
    const { widthMm, heightMm } = buildGeometry(prev, size).surface;
    const keep = cur.placed.length > 0 ? cur.split : splitFor(widthMm, heightMm);
    for (const split of [keep, keep === 'h' ? 'v' : 'h'] as const) {
      for (const order of orderings(toAdd)) {
        candidates.push({ ...cur, placed: [...cur.placed, ...order], ratios: {}, split });
      }
    }
  }

  // An even split is only a preference. A wide part beside a narrow one is
  // refused by a 50/50 cut although the sheet has room for both, so the main
  // division is tried off-centre as well. A part that stacks items down a
  // column comes first, though: a 31-row list wants a strip about as wide as
  // its dates, not half the sheet, and half the sheet is not what a printed
  // refill gives it either.
  const { widthMm: surfaceW } = buildGeometry(prev, size).surface;
  const shares = (c: Surface): (number | undefined)[] => {
    const narrow = c.split === 'v' && c.placed.length === 2 ? columnShare(c, surfaceW) : null;
    return narrow === null ? [undefined, 0.66, 0.34] : [narrow, undefined, 0.66, 0.34];
  };
  const offCentre = (c: Surface): Surface[] =>
    shares(c).map(a => (a === undefined ? c : { ...c, ratios: { ...c.ratios, a } }));

  // Widest calendar first, so it only narrows when the arrangement needs it.
  for (const band of bands) {
    for (const candidate of candidates) {
      for (const surface of offCentre(candidate)) {
        const layout = { ...prev, spanning: band, surface };
        if (everyPartFits(layout, size)) {
          return { layout, overflow, landed: surface.placed.indexOf(toAdd[0]) };
        }
      }
    }
  }
  return null;
}

// Which surface region a point in surface space falls in.
export function regionAt(regions: Rect[], x: number, y: number): number | null {
  for (let i = 0; i < regions.length; i++) {
    const r = regions[i];
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i;
  }
  return null;
}
