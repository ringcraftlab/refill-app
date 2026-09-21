import type { Layout, PageKey, PartKind, SizeSpec, Spanning, Surface } from '../types';
import { MAX_PARTS, PART_FIT } from '../types';
import type { SheetRotation } from './draw';
import { monthGrid } from './dates';
import { holeCentres } from './sizes';

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

export interface Divider {
  id: string;
  key: DividerKey;
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

// Landscape is the planner turned a quarter turn. It never transposes a
// calendar grid — only the page shape and the ring edge change.
export const isLandscape = (layout: Layout): boolean => layout.orientation === 'landscape';

function ringEdgeFor(spread: boolean, landscape: boolean, key: PageKey, flip: boolean): RingEdge {
  // A single sheet binds on its outer edge. In a spread the binding is always
  // the seam between the two pages, whichever way the pages sit.
  //
  // `flip` is for a single page printed on the back of a sheet: turning the
  // paper over puts the binding on the other side.
  if (!spread) {
    if (landscape) return flip ? 'bottom' : 'top';
    return flip ? 'right' : 'left';
  }
  if (landscape) return key === 'left' ? 'bottom' : 'top';
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

function pageBox(spread: boolean, landscape: boolean, key: PageKey, W: number, H: number, ring: number, flip: boolean): PageBox {
  const edge = ringEdgeFor(spread, landscape, key, flip);
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

// `flipBinding` mirrors a single page's binding edge, for when that page is
// printed on the back of a sheet.
export function buildGeometry(layout: Layout, size: SizeSpec, flipBinding = false): Geometry {
  const landscape = isLandscape(layout);
  const W = landscape ? size.heightMm : size.widthMm;
  const H = landscape ? size.widthMm : size.heightMm;
  const ring = size.ringMarginMm;
  const sheet = {
    widthMm: size.widthMm,
    heightMm: size.heightMm,
    rotation: (landscape ? 90 : 0) as SheetRotation,
  };

  const keys: PageKey[] = layout.spread ? ['left', 'right'] : ['single'];
  const boxes = keys.map(key => ({ key, box: pageBox(layout.spread, landscape, key, W, H, ring, flipBinding) }));
  const usableH = boxes[0].box.usableH;
  const usableW = boxes[0].box.usableW;

  // Band heights. A landscape spread gives its pages different week counts, so
  // the shorter page's band is shorter too and its rows stay the same height.
  const span = layout.spanning;
  const totalRows = monthGrid(layout.year, layout.month, layout.weekStart).length;
  const bandOf = (key: PageKey): number => {
    if (!span) return 0;
    const top = usableH * span.ratio;
    if (!landscape) return top;
    const [topRows, bottomRows] = weekSplit(totalRows);
    const rowH = (top - MONTHLY_HEADER_MM) / topRows;
    return key === 'left' ? top : MONTHLY_HEADER_MM + rowH * bottomRows;
  };

  const pages: PageGeometry[] = boxes.map(({ key, box }) => {
    const bandH = bandOf(key);
    // Dragging either page's band edge moves the same ratio; on the shorter
    // page of a landscape spread a millimetre of drag is worth proportionally
    // more ratio, so its extent shrinks to match.
    const extent = span && span.ratio > 0 ? bandH / span.ratio : usableH;
    return {
      key,
      widthMm: W,
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
  // landscape spread the fuller page is filled by the calendar, so the surface
  // is only the shorter page's leftover.
  const slices: SurfaceSlice[] = [];
  let cursor = 0;
  boxes.forEach(({ key, box }) => {
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
  return {
    pages,
    landscape,
    // A landscape spread is the booklet rotated, so its pages stack.
    flow: layout.spread && landscape ? 'column' : 'row',
    surface: {
      widthMm: surfaceW,
      heightMm: surfaceH,
      slices,
      regions: splitRegions(count, layout.surface, surfaceW, surfaceH),
      dividers: surfaceDividers(count, layout.surface, surfaceW, surfaceH),
    },
  };
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
  at: { sx: number; sy: number }, prev: Layout, next: Layout, size: SizeSpec,
): { sx: number; sy: number } {
  const a = buildGeometry(prev, size).surface;
  const b = buildGeometry(next, size).surface;
  if (!a.slices.length || !b.slices.length || a.heightMm <= 0) return at;
  const from = a.slices.find(s => at.sx >= s.fromMm && at.sx <= s.toMm) ?? a.slices[a.slices.length - 1];
  const to = b.slices.find(s => s.key === from.key) ?? b.slices[0];
  const across = from.toMm - from.fromMm;
  const share = across > 0 ? (at.sx - from.fromMm) / across : 0.5;
  return {
    sx: to.fromMm + share * (to.toMm - to.fromMm),
    sy: (at.sy / a.heightMm) * b.heightMm,
  };
}

export function placeParts(
  prev: Layout, size: SizeSpec, kinds: PartKind[], at: { sx: number; sy: number } | null,
): { layout: Layout; overflow: number } | null {
  const spanned = attempt(prev, size, kinds, at);
  if (spanned) return spanned;
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
    if (onOnePage.surface.placed.length > MAX_PARTS) return null;
    return attempt(onOnePage, size, kinds, at && remapDrop(at, prev, onOnePage, size), true);
  }
  // The calendar is arriving now and no band fits around what is already
  // here, so it lands as an ordinary part instead of being refused.
  if (kinds.includes('monthly')) return attempt(prev, size, kinds, at, true);
  return null;
}

function attempt(
  prev: Layout, size: SizeSpec, kinds: PartKind[], at: { sx: number; sy: number } | null,
  monthlyAsPart = false,
): { layout: Layout; overflow: number } | null {
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
      if (everyPartFits(layout, size)) return { layout, overflow };
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
      candidates.push({
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
        candidates.push({ placed: [...cur.placed, ...order], ratios: {}, split });
      }
    }
  }

  // An even split is only a preference. A wide part beside a narrow one is
  // refused by a 50/50 cut although the sheet has room for both, so the main
  // division is tried off-centre as well -- even first, so a deliberate
  // arrangement is never quietly skewed.
  const offCentre = (c: Surface): Surface[] =>
    [undefined, 0.66, 0.34].map(a => (a === undefined ? c : { ...c, ratios: { ...c.ratios, a } }));

  // Widest calendar first, so it only narrows when the arrangement needs it.
  for (const band of bands) {
    for (const candidate of candidates) {
      for (const surface of offCentre(candidate)) {
        const layout = { ...prev, spanning: band, surface };
        if (everyPartFits(layout, size)) return { layout, overflow };
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
