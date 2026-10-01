import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import type {
  Background, BackgroundKind, Book, DateWords, FoldCount, FoldGrain, InkTone, Layout, PartKind,
  RefillSize, RuleWeight, SizeSpec,
} from './types';
import { MAX_PARTS, SCHEMA_VERSION } from './types';
import { holeCentres, SIZES } from './lib/sizes';
import {
  buildGeometry, foldMaxParts, foldOf, isLandscape, MAX_RATIO, MIN_RATIO,
  eachOf, photosOf, placeParts as planPlacement, regionAt, removeFromFold, ringsOnTop,
  someEach,
} from './lib/layout';
import type { Divider, DropPoint, Geometry, PageGeometry } from './lib/layout';
import type { Page } from './lib/draw';
import { BACKGROUND_COLORS } from './lib/background';
import { paletteOf, RULE_WEIGHT_ORDER, RULE_WEIGHTS, TONE_ORDER, TONES } from './lib/palette';
import { importPhoto, PHOTO_WARN_BYTES, photoBytes } from './lib/photo';
import { IMPORT_ACCEPT, printedDpi, readImportFile } from './lib/importfile';
import type { ImportPage, ImportRead } from './lib/importfile';
import { FOLD_PANELS, foldGrainsOf, foldPanels, foldPlan } from './lib/fold';
import type { FoldPlan } from './lib/fold';
import { nextMonthCell } from './lib/parts';
import { addDays, addMonths, isoDate, runDates } from './lib/dates';
import {
  buildPages, buildPrintSheets, datedSlotOf, DEFAULT_PRINT, hasDatedPart, INK_INSET_MM, isDayPaced,
  chainCount, chainOwners, duplexFlipOf, imposeCount, isDatedKind, MONTH_PACED, paperPlan, punchInset, runEnd,
  sameSheet, sheetAt, sheetCount, sheetLabel, sheetSizeOf,
} from './lib/render/pages';
import type { BackFill, PrintOptions } from './lib/render/pages';
import type { TilePlan } from './lib/render/impose';
import { PAPER_ORDER, PAPERS } from './lib/render/impose';
import type { PaperId } from './lib/render/impose';
import { PageSvg, SheetSvg } from './lib/render/svg';
import { downloadPdf, sheetsToPdf } from './lib/render/pdf';
import { deleteBook, listBooks, newId, saveBook, storeRevision } from './lib/storage';
import { Button, PRESS } from './ui/Button';
import { Field, Segmented, Stepper } from './ui/Field';
import { Dialog, Modal, Sheet, Toast } from './ui/Overlay';
import { DockGrip, DockTab } from './ui/Dock';

type Stage = 'size' | 'sides' | 'contents' | 'canvas' | 'book';
// A rectangle on screen, in the page area's own pixels.
type Box = { key: string; left: number; top: number; width: number; height: number };
type SheetTarget =
  { slot: number } | 'spanning' | 'load' | 'save' | 'print'
  // `sheet` is the refill itself -- which size it is and what form it takes.
  // `paper` is the A4 it gets printed on. Two different pieces of paper, and
  // the confusion between them is why they are named apart here.
  | 'sheet' | 'paper' | 'background' | 'look' | 'import' | null;

const GAP = 6;

// The app is one phone-width column whatever it is shown on. Layout only —
// anything pressable comes from ui/.
// Phone-first, but a tablet is not a tall phone: on a wide screen the column
// was 430px of app in the middle of 834, and the drawing -- which is what the
// whole app is -- came out at a third of the glass. The cap lifts once there
// is room for it, and everything in the column simply gets wider with it.
const SCREEN = 'relative mx-auto flex h-full max-w-[430px] flex-col overflow-hidden bg-bg md:max-w-[680px]';
// The editor, and only the editor, spreads out on a desktop: the paper takes
// the room and the tools stand beside it. The pickers stay a column -- a list
// of sizes 1400px wide is harder to read, not easier.
const CANVAS_SCREEN = `${SCREEN} screen-in lg:max-w-[1440px] lg:flex-row`;
// Kept in step with the `lg` variant in styles.css.
const WIDE = '(min-width: 1024px), (orientation: landscape) and (max-height: 540px) and (min-width: 640px)';

// A mouse and a window are a different shape from a thumb and a phone, and the
// difference is structural rather than a matter of spacing: the tray turns
// from a scroller into a list, and the settings stop covering the paper. So it
// is read once here rather than expressed as a dozen `lg:` classes.
function useWide(): boolean {
  const [wide, setWide] = useState(
    () => typeof matchMedia === 'function' && matchMedia(WIDE).matches,
  );
  useLayoutEffect(() => {
    const mq = matchMedia(WIDE);
    const read = () => setWide(mq.matches);
    read();
    mq.addEventListener('change', read);
    return () => mq.removeEventListener('change', read);
  }, []);
  return wide;
}
const SCREEN_PAD = `${SCREEN} gap-[18px] px-[22px] py-7`;
// The two pickers on a desktop. Wider than the phone column, because the cards
// are a comparison and a comparison reads across: the four common sizes fit on
// one row and the whole list is in view without scrolling. Not as wide as the
// editor -- past four across the cards get narrower than the phone's, which is
// how a list of nine turns back into a wall.
const PICK_SCREEN = `${SCREEN_PAD} screen-in lg:max-w-[1000px]`;

// What a stamp shows. A character said what the part was called -- 時 for the
// vertical, 週 for the horizontal -- which is no help at all when the question
// is what the two of them are. The real page shrunk to this size is no help
// either: measured at the stamp's own height, a monthly, a gantt and a habit
// tracker come out as the same smudge, and it takes about six times the room
// before they separate. So the stamp draws the part's shape instead: columns,
// bands, staggered bars, a tick grid. Nothing is to scale and nothing is
// dated -- it is the arrangement, which is the one thing that tells these
// apart at twenty-six pixels across.
//
// Drawn on a 26x18 grid, in the same stroke weight, so twelve of them read as
// one set rather than twelve drawings.
const ICON_W = 26;
const ICON_H = 18;

function StampIcon({ kind }: { kind: PartKind }) {
  const line = (x1: number, y1: number, x2: number, y2: number, i: number) =>
    <line key={`l${i}`} x1={x1} y1={y1} x2={x2} y2={y2} />;
  const cells: React.ReactNode[] = [];

  // A frame every one of them sits in, so the set has one silhouette.
  const frame = <rect key="f" x={0.75} y={0.75} width={ICON_W - 1.5} height={ICON_H - 1.5} rx={1.5} />;
  const cols = (n: number, from = 0) =>
    Array.from({ length: n - 1 }, (_, i) =>
      line(from + ((ICON_W - from) / n) * (i + 1), 0.75, from + ((ICON_W - from) / n) * (i + 1), ICON_H - 0.75, i));
  const rows = (n: number, from = 0) =>
    Array.from({ length: n - 1 }, (_, i) =>
      line(0.75, from + ((ICON_H - from) / n) * (i + 1), ICON_W - 0.75, from + ((ICON_H - from) / n) * (i + 1), 100 + i));

  if (kind === 'monthly') { cells.push(...cols(7), ...rows(4, 4), line(0.75, 4, ICON_W - 0.75, 4, 9)); }
  // A date gutter down the side, and a line to write on for each day.
  if (kind === 'daylist') { cells.push(line(6, 0.75, 6, ICON_H - 0.75, 0), ...rows(5)); }
  // Hours down the left, a day to each column, a header band on top.
  if (kind === 'weekvert') { cells.push(line(5, 0.75, 5, ICON_H - 0.75, 0), line(0.75, 4.5, ICON_W - 0.75, 4.5, 1), ...cols(5, 5)); }
  // A band to a day, each with its date at the start.
  if (kind === 'weekhoriz') { cells.push(...rows(4), line(5, 0.75, 5, ICON_H - 0.75, 0)); }
  // Bars at different starts and lengths -- the one thing a gantt looks like.
  if (kind === 'gantt') {
    cells.push(line(0.75, 4.5, ICON_W - 0.75, 4.5, 0));
    cells.push(<rect key="b1" x={4} y={6.5} width={9} height={2.4} rx={1.2} />);
    cells.push(<rect key="b2" x={9} y={10.5} width={11} height={2.4} rx={1.2} />);
    cells.push(<rect key="b3" x={6} y={14.5} width={7} height={2.4} rx={1.2} />);
  }
  // Named lanes on the left and marks across them. Drawn as marks rather than
  // as an empty grid, or it is the calendar again: what a habit tracker looks
  // like in use is the ticks, not the ruling.
  if (kind === 'habit') {
    cells.push(line(9, 0.75, 9, ICON_H - 0.75, 0), ...rows(4));
    const at = [[0, 0], [2, 0], [3, 0], [1, 1], [2, 1], [0, 2], [3, 2]];
    cells.push(<g key="ticks" strokeWidth={0}>
      {at.map(([c, r], i) => (
        <circle key={i} cx={11.8 + c * 3.6} cy={5.1 + r * 4.4} r={1.15} fill="currentColor" />
      ))}
    </g>);
  }
  if (kind === 'todo') {
    cells.push(...[4.5, 9.5, 14.5].flatMap((y, i) => [
      <rect key={`b${i}`} x={3.5} y={y - 1.6} width={3.2} height={3.2} rx={0.8} />,
      line(9, y, ICON_W - 3.5, y, i),
    ]));
  }
  // A heading, then the box you write the goal in. Short rule over a panel,
  // so it does not read as another ruled sheet.
  if (kind === 'goal') {
    cells.push(line(3.5, 5, 11, 5, 0));
    cells.push(<rect key="panel" x={3.5} y={8} width={ICON_W - 7} height={6.5} rx={1} />);
  }
  // What it was and what it cost: two columns, the money one narrow.
  if (kind === 'budget') { cells.push(line(17, 0.75, 17, ICON_H - 0.75, 0), ...rows(4)); }
  // Finer and lighter than the calendar's cells, or the two read as the same
  // grid: this one is paper to draw on, not a month to fill in.
  if (kind === 'grid') {
    cells.push(<g key="fine" strokeWidth={0.45}>{[...cols(8), ...rows(6)]}</g>);
  }
  if (kind === 'lines') { cells.push(...rows(5)); }
  // Fewer lines than the ruled sheet, and not to the edges: somewhere to put
  // a few words rather than a page to fill.
  if (kind === 'memo') { cells.push(line(3.5, 6.5, ICON_W - 3.5, 6.5, 0), line(3.5, 11.5, ICON_W - 3.5, 11.5, 1)); }
  // The shape a picture makes in a frame: a horizon and a sun. Drawn rather
  // than ruled, because this is the one stamp that holds something that is
  // not lines.
  // A card for one ink: the number and its name on a rule, the bottle to paint
  // in, and the lines to write on. The bottle is what tells it apart from the
  // memo at this size.
  if (kind === 'swatch') {
    cells.push(line(7.5, 4.6, ICON_W - 2, 4.6, 0));
    cells.push(<rect key="cap" x={4.1} y={7.4} width={2.4} height={1.6} rx={0.5} />);
    cells.push(<rect key="bot" x={2.4} y={9} width={5.8} height={5.4} rx={0.8} />);
    cells.push(line(10.5, 9.4, ICON_W - 2, 9.4, 1));
    cells.push(line(10.5, 12, ICON_W - 2, 12, 2));
    cells.push(line(10.5, 14.6, ICON_W - 2, 14.6, 3));
  }

  if (kind === 'photo') {
    cells.push(<circle key="sun" cx={8} cy={6} r={1.8} />);
    cells.push(<path key="hill" d={`M 2 ${ICON_H - 3.5} L 9 8 L 14 13 L 17 10 L ${ICON_W - 2} ${ICON_H - 3.5} Z`} />);
  }

  return (
    // Sized in CSS rather than in attributes, so the same drawing can be bigger
    // where there is room for it. The strokes are in viewBox units and grow
    // with it, which is what keeps the set looking like one set.
    <svg
      viewBox={`0 0 ${ICON_W} ${ICON_H}`}
      className="h-[18px] w-[26px] lg:h-[26px] lg:w-[38px]"
      fill="none" stroke="currentColor" strokeWidth={0.9} strokeLinecap="round"
      aria-hidden="true"
    >
      {frame}
      <g strokeWidth={0.7}>{cells}</g>
    </svg>
  );
}

const TRAY: { kind: PartKind; label: string }[] = [
  { kind: 'monthly', label: 'マンスリー' },
  { kind: 'daylist', label: '日付リスト' },
  { kind: 'weekvert', label: 'バーチカル' },
  { kind: 'weekhoriz', label: 'ウィークリー' },
  { kind: 'gantt', label: 'ガント' },
  { kind: 'habit', label: 'ハビット' },
  { kind: 'todo', label: 'TODO' },
  { kind: 'goal', label: '目標' },
  { kind: 'budget', label: '家計' },
  { kind: 'grid', label: '方眼' },
  { kind: 'lines', label: '罫線' },
  { kind: 'memo', label: 'メモ' },
  { kind: 'photo', label: '写真' },
  { kind: 'swatch', label: 'インク見本' },
];

const TAUGHT_KEY = 'ringcraft.dividerTaught';
// How far the clear button sits in from the block's right edge. It has to
// overlap a little to read as attached, without sitting on top of a date.
const CLEAR_INSET = 17;

// What the design is, in the header. A fold says how many panels because that
// is the thing you chose, and the thing the paper has to carry.
// The outline of a fold that was cut back, as a clip path. The cut is always
// a corner: it runs the whole way along one edge and out to the end of the
// strip, so the paper is an L and six points describe it.
function notchClip(pg: PageGeometry): string | undefined {
  const n = pg.notch;
  if (!n) return undefined;
  const W = pg.widthMm, H = pg.heightMm;
  const at = (x: number, y: number) => `${(x / W * 100).toFixed(3)}% ${(y / H * 100).toFixed(3)}%`;
  const x0 = n.x, x1 = n.x + n.w, y0 = n.y, y1 = n.y + n.h;
  const left = n.x < 0.01, top = n.y < 0.01;
  const pts: [number, number][] = left && top
    ? [[x1, 0], [W, 0], [W, H], [0, H], [0, y1], [x1, y1]]
    : left
      ? [[0, 0], [W, 0], [W, H], [x1, H], [x1, y0], [0, y0]]
      : top
        ? [[0, 0], [x0, 0], [x0, y1], [W, y1], [W, H], [0, H]]
        : [[0, 0], [W, 0], [W, y0], [x0, y0], [x0, H], [0, H]];
  return `polygon(${pts.map(([x, y]) => at(x, y)).join(', ')})`;
}

// The L-shaped fold is a different sheet from the rectangular one -- it is cut
// back on the binding side -- so it says so. The picker calls them 蛇腹N面 and
// L字N面; the editor used to call both 蛇腹N面, which left no way to tell from
// inside what you had picked.
const formLabel = (l: Layout, grain?: FoldGrain): string =>
  l.fold > 1 ? `${grain === 'along' ? 'L字' : '蛇腹'}${l.fold}面`
    : l.spread ? '見開き' : '片面';

// Not "ja / mix / en" but what each one prints. The name of a parameter tells
// you nothing about what comes out of the printer; the sample is the answer.
const WORD_SAMPLE: Record<DateWords, string> = {
  ja: '9月 月', mix: '9月 Mon', en: 'Sep Mon',
};

const cssColor = (c: [number, number, number]) =>
  `rgb(${c.map(v => Math.round(v * 255)).join(',')})`;

const BACKGROUND_LABEL: Record<BackgroundKind, string> = {
  none: '背景なし', tint: '背景：色', grid: '背景：方眼',
  dot: '背景：ドット', lines: '背景：罫線', image: '背景：画像',
};

const PART_LABEL: Record<PartKind, string> = {
  monthly: 'マンスリー', daylist: '日付リスト',
  weekvert: '週間バーチカル', weekhoriz: '週間ホリゾンタル', gantt: 'ガントチャート',
  habit: 'ハビットトラッカー', todo: 'TODOリスト',
  goal: '今月の目標', budget: '家計', grid: '方眼', lines: '罫線', memo: 'メモ',
  photo: '写真', swatch: 'インク見本',
};

function createLayout(): Layout {
  const now = new Date();
  return {
    version: SCHEMA_VERSION,
    id: newId(),
    name: '新しいリフィル',
    size: 'M6',
    spread: true,
    fold: 1,
    spanning: null,
    surface: { placed: [], ratios: {}, split: 'h' },
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    monthCount: 12,
    daysPerSheet: 7,
    weekStart: 1,
    dayStartHour: 6,
    dayEndHour: 24,
    weekTiers: 1,
    orientation: 'portrait',
    showNextMonth: true,
    habitCount: 4,
    updatedAt: now.toISOString(),
  };
}

// A section is a refill on the same paper as the rest of the book: same size,
// same form, same way up. Everything that decides the punched sheet has to
// carry over or it could not be bound in. The 体裁 comes too -- one binder,
// one hand.
//
// `kind` is either a part to fill the sheet with (a note section: squared,
// ruled, dotted, blank) or 'blank', which is an empty sheet for someone to
// design. The note sections are the answer to "the paper has three places
// left": they are one sheet each and need nothing decided about them.
type SectionKind = PartKind | 'blank' | 'cover' | 'backcover';

// How long a dated run starts out, from how fast it eats paper.
//
// The period used to be twelve months for everything, because a year is what
// a monthly means -- twelve sheets, four of A4. The same twelve months on a
// weekly is 53 sheets: A4 14 on Mini6 and 27 on A5, printed double-sided,
// nobody's idea of a first try. A run you have to cut back is worse than one
// you have to extend, because extending is one tap on the period and cutting
// back is something you only learn to do after wasting the paper.
//
// So the number is not the months, it is the sheets: about fifteen, which is
// four or five of A4 on most sizes. A month to a sheet lands on twelve months
// by itself, which is why the monthly is unchanged.
const RUN_SHEETS = 15;
const runMonths = (daysPerSheet: number): number =>
  Math.max(1, Math.min(12, Math.round((RUN_SHEETS * Math.max(1, daysPerSheet)) / 30.4)));

// A section that is paced by days starts at that length rather than at the
// book's. Applied where the pacing is decided -- when the part lands -- and
// never afterwards: silently shortening a run someone set is as bad as
// handing them a long one.
const pacedFor = (l: Layout): Layout =>
  (isDayPaced(l) ? { ...l, monthCount: runMonths(l.daysPerSheet) } : l);

// `single` is for a section that has to be exactly one page -- what an empty
// page in the book asks for. It is not an option on a run of dates, which is
// as long as its dates whatever page it was asked for from.
function sectionOf(kind: SectionKind, base: Layout, single = false): Layout {
  const sheet: Layout = {
    ...createLayout(),
    size: base.size,
    spread: single && base.fold <= 1 ? false : base.spread,
    single: single || undefined,
    fold: base.fold,
    foldGrain: base.foldGrain,
    orientation: base.orientation,
    year: base.year,
    month: base.month,
    monthCount: base.monthCount,
    weekStart: base.weekStart,
    words: base.words,
    hideRokuyo: base.hideRokuyo,
    tone: base.tone,
    ruleWeight: base.ruleWeight,
    pages: 1,
  };
  if (kind === 'blank') return sheet;
  // The back cover is the cover's twin at the other end: one page, nothing
  // on it, named for what it is. It fills the face the last spread leaves,
  // so it is `single` -- which is also what turns its holes to the right.
  if (kind === 'backcover') {
    return { ...sheet, name: '裏表紙', backCover: true, single: true, spread: base.fold > 1 ? base.spread : false };
  }
  // A cover is a picture filling the sheet. Nobody would arrive at that by
  // dropping a 写真 part on a blank section and stretching it, so it is a
  // thing you can ask for by name -- and it keeps that name, because what it
  // is for is not readable from what is on it.
  if (kind === 'cover') {
    return {
      ...sheet,
      name: '表紙',
      cover: true,
      // One page, even in a book of spreads: a cover is the outside of the
      // stack, not a pair of facing pages. A spread and a single page are the
      // same punched sheet, so it binds in either way -- which is exactly why
      // this is allowed to differ from the rest of the book.
      spread: base.fold > 1 ? base.spread : false,
      // Nothing on it. A cover is the first page of the book, not a
      // photograph: what goes on it is a picture for some people, a title for
      // others, and nothing at all for plenty. Putting a 写真 part on it was
      // the app's own shortage talking -- there is no way to type a word onto
      // a page yet, so a photograph was the only content anyone could supply.
    };
  }
  return pacedFor({ ...sheet, surface: { ...sheet.surface, placed: [kind] } });
}

// The empty sheet a new book starts with. It is somewhere to draw, not a
// thing anyone asked to print, so the first real section takes its place
// rather than printing beside it.
function isPlaceholder(l: Layout): boolean {
  return !l.spanning && l.surface.placed.length === 0 && !l.background && !l.imported;
}

// Where a new section goes, and what it replaces. `where` is the index it
// lands at -- an empty page knows which one it is, so pressing it puts what
// is chosen exactly there.
function withSection(sections: Layout[], made: Layout, where: number | boolean): Layout[] {
  const rest = sections.length === 1 && isPlaceholder(sections[0]) ? [] : sections;
  let at = where === true ? 0 : where === false ? rest.length : Math.min(where, rest.length);
  // The back cover stays the last page: what is added "at the end" goes in
  // front of it.
  if (at === rest.length && rest[rest.length - 1]?.backCover && !made.backCover) at--;
  return [...rest.slice(0, at), made, ...rest.slice(at)];
}

// What a section is called in the contents: what is on it, which is what
// anyone scanning a list of them is looking for.
function sectionLabel(l: Layout): string {
  // A cover is a cover, not 「写真」: what it is for is not readable from
  // what is on it.
  if (l.cover) return '表紙';
  if (l.backCover) return '裏表紙';
  if (l.imported) return '取り込んだリフィル';
  if (l.name && l.name !== '新しいリフィル') return l.name;
  const parts = [
    ...(l.spanning ? ['マンスリー'] : []),
    ...l.surface.placed.map(k => PART_LABEL[k]),
  ];
  return parts.length ? parts.slice(0, 3).join('＋') : '白紙';
}

// The section a new one is copied from: the book's own form, its dates and its
// look. Never the cover, whatever order the book is in -- a cover is one page
// however the book is folded, so it carries 片面, and a monthly added to a book
// of spreads after a cover had been put on the front came out single-sided.
// The one form the whole book is in, or nothing when it is in more than one.
// A planner is allowed to be mixed -- the monthly a spread, the notes at the
// back single sheets -- and then there is no single answer to 「この束の体裁」,
// so the panel says the size and lets each section say its own.
const oneForm = (sections: Layout[]): Layout | null => {
  const real = sections.filter(l => !l.cover && !l.single);
  const first = real[0];
  if (!first) return null;
  return real.every(l => (
    l.spread === first.spread && l.fold === first.fold && l.foldGrain === first.foldGrain
  )) ? first : null;
};

const bodyOf = (b: Book): Layout =>
  b.sections.find(l => !l.cover && !l.single) ?? b.sections.find(l => !l.cover) ?? b.sections[0];

// A book of one empty section, which is what every refill made so far was.
function createBook(): Book {
  const only = createLayout();
  return {
    version: SCHEMA_VERSION,
    id: newId(),
    name: '新しい束',
    sections: [only],
    updatedAt: only.updatedAt,
  };
}

// One taken-in page as a section: a single page in the book's size and form,
// carrying the picture. A file of several pages becomes several sections, in
// the file's order, so a left page and its right page land as a pair.
function importedSection(page: ImportPage, i: number, read: ImportRead, fit: 'contain' | 'cover', base: Layout): Layout {
  return {
    ...sectionOf('blank', base, true),
    name: '取り込んだリフィル',
    imported: { src: page.src, fit, pxW: page.pxW, pxH: page.pxH, wMm: page.wMm, hMm: page.hMm, file: read.name, page: i + 1, of: read.pages.length },
  };
}

// The taken-in pages put into the book, with one blank page in front of them
// when the first one would otherwise land on the wrong side. A file drawn as
// a spread leaves the punch side free on each page -- its left page has room
// on the right -- and landing that page on the right of the book puts the
// holes through what is printed.
function placeImported(sections: Layout[], made: Layout[], base: Layout, sideOfFirst: 'L' | 'R' | undefined): { sections: Layout[]; padded: boolean } {
  // The blank goes in after the pages are placed, beside the first of them:
  // put in on its own it would be taken for the empty starting page and
  // replaced by the next one.
  const put = (pad: boolean) => {
    const all = made.reduce((acc, l) => withSection(acc, l, false), sections);
    if (!pad) return all;
    const at = all.indexOf(made[0]);
    return [...all.slice(0, at), sectionOf('blank', base, true), ...all.slice(at)];
  };
  const plain = put(false);
  if (!sideOfFirst) return { sections: plain, padded: false };
  const i = pagesOf(plain).findIndex(leaf => leaf.at !== null && plain[leaf.at] === made[0]);
  const onLeft = i % 2 === 1;
  if ((sideOfFirst === 'L') === onLeft) return { sections: plain, padded: false };
  return { sections: put(true), padded: true };
}

// The logo's mark. Three rings where it is shown at a size that can hold
// them; the browser tab (public/favicon.svg) is drawn with two, because at
// 16px three bars run together into one.
function LogoMark({ className = '' }: { className?: string }) {
  const navy = '#1A3A6B';
  const ys = [29.76, 62, 94.24];
  return (
    <svg viewBox="-4 -4 220 132" className={className} role="img" aria-label="RingCraftLab">
      <rect x={0} y={0} width={100} height={124} rx={6} fill="#1D73BE" />
      <rect x={112} y={0} width={100} height={124} rx={6} fill="#FBD212" />
      {ys.map(y => (
        <g key={y}>
          <circle cx={86} cy={y} r={7.02} fill={navy} opacity={0.35} />
          <circle cx={126} cy={y} r={7.02} fill={navy} opacity={0.35} />
          <line x1={86} y1={y} x2={126} y2={y} stroke={navy} strokeWidth={9} strokeLinecap="round" />
        </g>
      ))}
    </svg>
  );
}

export function App() {
  const [stage, setStage] = useState<Stage>('size');
  // Where each screen was opened from. Not a parent -- an opener: the contents
  // reached from the editor closes back to the editor, and the editor reached
  // from the contents closes back to the contents. A fixed hierarchy cannot
  // say that, which is why pressing back in the contents used to come out at
  // the form picker however you had got there.
  const [openedFrom, setOpenedFrom] = useState<Partial<Record<Stage, Stage>>>({});
  const go = (next: Stage) => {
    setOpenedFrom(m => ({ ...m, [next]: stage }));
    setStage(next);
  };
  const back = () => { const prev = openedFrom[stage]; if (prev) setStage(prev); };
  const [book, setBook] = useState<Book>(createBook);
  // Where the editor is: which section, and which of its sheets. Turning the
  // page moves the second; the contents moves both.
  const [at, setAt] = useState(0);
  const [nth, setNth] = useState(0);
  const goTo = (i: number, sheet = 0) => { setAt(i); setNth(sheet); };
  // The paper is the book's, not a section's: everything in it is printed in
  // one run, on one kind of paper.
  const [print, setPrint] = useState<PrintOptions>(DEFAULT_PRINT);
  // What the editor should open on when it is entered from the contents: the
  // question that was being asked there, rather than the paper again.
  // Taking a file in. It joins the book being made; the size screen offers no
  // way in, because bringing a file is a side road and not how a book starts.
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState<ImportRead | null>(null);
  const [importBusy, setImportBusy] = useState<string | null>(null);
  const startImport = () => fileRef.current?.click();
  const [openOn, setOpenOn] = useState<{ key: number; what: 'range' | 'part0' }>(
    { key: 0, what: 'range' },
  );
  // Size and form belong to the book: a section on a different punched sheet
  // could not be bound into it. They are kept on every section because that
  // is all `src/lib` knows how to read.
  // A cover stays one page whatever the book is folded into, so the form the
  // picker shows -- and the form it sets -- is the rest of the book's.
  const body = bodyOf(book);
  const finishImport = (fit: 'contain' | 'cover') => {
    const read = importing!;
    setImporting(null);
    const made = read.pages.map((pg, i) => importedSection(pg, i, read, fit, body));
    const placed = placeImported(book.sections, made, body, read.pages[0]?.side);
    setBook(b => ({ ...b, sections: placed.sections }));
    goTo(Math.max(0, placed.sections.indexOf(made[0])), 0);
    if (stage !== 'canvas') go('canvas');
  };
  const importEl = (
    <>
      <input
        ref={fileRef}
        type="file"
        accept={IMPORT_ACCEPT}
        className="importfile hidden"
        onChange={async e => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          setImportBusy('読み込み中…');
          try {
            // Read for the largest size it could go to, so the picture is
            // fine enough whichever size it ends up on.
            const read = await readImportFile(file, { w: 148, h: 210 });
            setImportBusy(null);
            setImporting(read);
          } catch (err) {
            setImportBusy(`${err instanceof Error ? err.message : '読めませんでした'}。JPEG・PNG・PDFのファイルを選んでください`);
          }
        }}
      />
      {importBusy && (
        <Modal title="ファイルから取り込む" onClose={() => setImportBusy(null)}>
          <p className="importbusy m-0 text-[14px] leading-relaxed text-muted">{importBusy}</p>
        </Modal>
      )}
      {importing && (
        <ImportSheet
          read={importing}
          size={SIZES[body.size]}
          pad={placeImported(
            book.sections,
            importing.pages.map((pg, i) => importedSection(pg, i, importing, 'contain', body)),
            body, importing.pages[0]?.side,
          ).padded}
          onConfirm={finishImport}
          onClose={() => setImporting(null)}
        />
      )}
    </>
  );
  const withImport = (screen: ReactNode) => <>{screen}{importEl}</>;
  // The section being worked on. The form belongs to it -- a book of spreads
  // with single-sheet notes at the back is an ordinary planner -- while the
  // size belongs to the book, because a sheet punched differently does not go
  // in the same binder.
  const onlyHere = (fn: (l: Layout) => Layout) =>
    setBook(b => ({
      ...b,
      sections: b.sections.map((l, i) => (i === Math.min(at, b.sections.length - 1) ? fn(l) : l)),
    }));
  const every = (fn: (l: Layout) => Layout) =>
    setBook(b => ({
      ...b,
      sections: b.sections.map(l => (
        l.cover || l.single ? { ...fn(l), spread: l.fold > 1 ? fn(l).spread : false } : fn(l)
      )),
    }));

  if (stage === 'size') {
    return withImport(
      <SizeScreen
        selected={body.size}
        onPick={(size) => { every(l => ({ ...l, size })); go('sides'); }}
      />
    );
  }
  if (stage === 'sides') {
    // The refill being made, which on the first run through is the only one.
    const here = book.sections[Math.min(at, book.sections.length - 1)];
    return (
      <SidesScreen
        size={here.size}
        spread={here.spread}
        fold={here.fold}
        foldGrain={here.foldGrain}
        onPick={(v) => onlyHere(l => ({
          ...l,
          ...v,
          single: undefined,
          // A fold holds one part per panel and has no band, so anything the
          // previous shape carried beyond that goes rather than staying in the
          // layout as a part with nowhere to be drawn.
          spanning: v.fold > 1 ? null : l.spanning,
          surface: v.fold > 1
            ? {
                ...l.surface,
                placed: l.surface.placed.slice(0, v.fold),
                page: undefined, ratios: {},
                // The panels are a different shape now, so how they were
                // shared out says nothing about this strip.
                fold: undefined,
              }
            : l.surface,
        }))}
        onBack={back}
        onConfirm={() => { setAt(0); go('canvas'); }}
      />
    );
  }
  if (stage === 'contents') {
    return withImport(
      <ContentsScreen
        onImport={() => startImport()}
        book={book}
        setBook={setBook}
        print={print}
        at={Math.min(at, book.sections.length - 1)}
        nth={nth}
        onOpen={(i: number, open?: 'range' | 'part0', sheet = 0) => {
          goTo(i, sheet);
          if (open) setOpenOn(o => ({ key: o.key + 1, what: open }));
          go('canvas');
        }}
        onBack={back}
      />
    );
  }
  // Turning through the book as a book. A screen rather than an overlay,
  // because it is a place you go and come back from: pressing a page there
  // opens the editor on it, and closing that editor comes back here, to the
  // same page, still open at the same spread.
  if (stage === 'book') {
    return (
      <BookView
        book={book}
        at={Math.min(at, book.sections.length - 1)}
        nth={nth}
        print={print}
        onClose={back}
        onEdit={(i, sheet) => { goTo(i, sheet); go('canvas'); }}
        // Chosen on an empty page, so it goes at that page. A cover and a
        // blank are not finished when they are chosen -- one wants a picture,
        // the other wants everything -- so both open in the editor; anything
        // else is already what it is, and stays here to be looked at.
        onAddAt={(where, kind) => {
          // A cover is the outside of the stack, so it goes on the front
          // wherever it was asked for -- from the last page of the book it was
          // landing on the last page, which is not a cover of anything.
          // Everything else goes where it was asked for, and is one page,
          // because an empty page is one page: a spread put there takes two
          // and leaves the same empty page one further on.
          const at = kind === 'cover' ? 0 : where;
          setBook(b => ({
            ...b,
            sections: withSection(b.sections, sectionOf(kind, bodyOf(b), true), at),
          }));
          if (kind === 'cover' || kind === 'blank') { goTo(at, 0); go('canvas'); }
        }}
      />
    );
  }
  return withImport(
    <CanvasScreen
      onImport={() => startImport()}
      book={book}
      at={Math.min(at, book.sections.length - 1)}
      nth={nth}
      setBook={setBook}
      onList={() => go('contents')}
      onFlip={() => go('book')}
      // The way home, and where home is. The editor is the workshop, so it has
      // no way out of its own -- only the one back to whatever opened it.
      backTo={openedFrom.canvas === 'contents' || openedFrom.canvas === 'sides'
        || openedFrom.canvas === 'book'
        ? openedFrom.canvas
        : null}
      onBack={back}
      goTo={goTo}
      print={print}
      setPrint={setPrint}
      openOn={openOn}
    />
  );
}

// The picker's two groups. Four sizes are what almost everyone has; the rest
// exist and have to be reachable, but putting them in the same run makes the
// first choice harder than it is. Rows inside a group are pairs, and a size
// with no partner leaves the rest of its row empty.
const SIZE_GROUPS: { title: string; rows: RefillSize[][] }[] = [
  { title: 'よく使われるサイズ', rows: [['M5', 'M6'], ['BIBLE', 'A5']] },
  { title: 'その他サイズ', rows: [['MINI3', 'CARD3'], ['M5SQ', 'NARROW'], ['A5SLIM']] },
];

// Pixels per millimetre. One number for all nine, which is the whole trick:
// what lets the eye compare is not the drawing on any one card but the fact
// that every card is the same box and only the paper inside it changes. Two
// numbers, one per group, was worse than the bug it replaced -- A5 slim is
// 210mm and came out shorter than Bible's 170mm, and M5 and M5 square are
// both 105mm tall and were drawn 8px apart. A drawing that contradicts the
// millimetres printed under it is worth less than no drawing.
const SHEET_SCALE = 0.34;

// Every sheet sits in a box the size of the largest, on every card and on the
// screen after it. That box is the ruler: a sheet filling it is A5, one
// filling a third of it is a third of A5, and that reads without moving the
// eye off the card.
// How far a ring stands out past the paper it grips. Drawn only inside the
// sheet it is a tab, not a ring: what says "ring" is that it goes round the
// edge -- and on a spread, that the one coming off the left page and the one
// off the right page are the same ring, seen between them.
const ringOut = (size: SizeSpec) => size.ringMarginMm * 0.55;

const SHEET_SLOT = {
  width: Math.max(...Object.values(SIZES).map(s => s.widthMm + ringOut(s))) * SHEET_SCALE,
  height: Math.max(...Object.values(SIZES).map(s => s.heightMm)) * SHEET_SCALE,
};

// The nine colours of the sizes, each named: コケモモ, マスタード, フィヨルド
// ブルー, ヘザー, スプルース, モス, ティール, ローズ, スレート. Toned down
// and brought to one lightness, the way Nordic textiles carry many colours
// without shouting -- nine full-strength hues side by side were the loudest
// thing in the app. Their places on the wheel are unchanged, with two
// exceptions: M5スクエア was orange, the accent's own colour, and A5スリム
// was a yellow too pale to see on white.
//
// The line is the size's badge -- bars, outlines, rings, the border of the
// chosen card. The fill is the same colour mixed 92% into white, which is to
// say paper: a sheet is white, and a sheet flooded with its own label colour
// stops being paper and becomes a swatch. The colour belongs on the rings,
// where it is the binder holding the paper.
const SIZE_COLOR: Record<RefillSize, string> = {
  M5: '#B4474C',
  M6: '#C38A2C',
  BIBLE: '#4F86B2',
  A5: '#86679E',
  MINI3: '#4C8A64',
  CARD3: '#879A45',
  M5SQ: '#3B8C92',
  NARROW: '#BC5F80',
  A5SLIM: '#6A7888',
};

// Paper is white. It was drawn in a wash of the size's own colour, which made
// every sheet on the picker a swatch of its label rather than a sheet -- and
// the app prints on white, so a tinted sheet on screen was a promise the
// paper cannot keep. The colour goes on the rings, the outline and the bar,
// where it stands for the binder and the badge rather than the paper.
const PAPER = '#fff';

// The same colour, dark enough to be read as words on white. A colour can be
// a bar, an outline or a fill at any lightness, but 「6穴」 set in サンイエロー
// is 1.5 times the lightness of the paper behind it and simply is not there;
// ライムグリーン and スカイブルー are not much better. So the label darkens the
// hue until it reads, and nothing else does -- the badge colour stays the
// colour that was chosen. Computed rather than listed, so a new size's colour
// cannot arrive without its readable form.
const srgb = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const luminance = (c: number[]) =>
  0.2126 * srgb(c[0] / 255) + 0.7152 * srgb(c[1] / 255) + 0.0722 * srgb(c[2] / 255);
// 4.5 is where a word stops being a shape: the contrast the WCAG asks of body
// text, and the number this app was failing on every one of its greys and on
// its own orange. Measured against the ground the app is actually drawn on.
const readable = (hex: string, ratio = 4.5): string => {
  let c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  for (let i = 0; i < 40 && 1.05 / (luminance(c) + 0.05) < ratio; i++) c = c.map(v => v * 0.94);
  return `#${c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
};
const SIZE_WORD: Record<string, string> = Object.fromEntries(
  Object.entries(SIZE_COLOR).map(([id, c]) => [id, readable(c)]),
);
// One name per size: the one people say. Three of these used to be a code
// with its reading underneath -- M5 over マイクロ5 -- which spent a line of
// the card saying the same size twice and left the reader to work out that
// they were one thing, not two.
const SIZE_NAME: Record<RefillSize, string> = {
  M5: 'Micro5',
  M6: 'Mini6',
  BIBLE: 'バイブル',
  A5: 'A5',
  MINI3: '縦長ミニ3穴',
  CARD3: '横長ミニ3穴',
  M5SQ: 'M5スクエア',
  NARROW: 'ナロー',
  A5SLIM: 'A5スリム',
};
// Under the name, and on every card. Between them they settle it when the
// name is unfamiliar -- and which binder a sheet fits is the hole count, not
// the millimetres: 縦長ミニ3穴 and Micro5 are both small sheets and will not
// go on each other's rings. Both are read off the size itself, so neither can
// drift from what gets punched.
const sizeMm = (s: SizeSpec) => `${s.widthMm}×${s.heightMm}mm`;
const ymd = (d: Date) => `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;

// Move a day-paced run to begin on a day. The months go with it: they still
// name how long the run is and still feed everything paced by months, so a
// start in August with the months left saying September would have the two
// halves of the same setting disagreeing.
const startOn = (l: Layout, d: Date): Layout => ({
  ...l, runStart: isoDate(d), year: d.getFullYear(), month: d.getMonth() + 1,
});
const sizeHoles = (s: SizeSpec) => `${s.holes.count}穴`;

// Truncating a Japanese name to 「縦長ミ…」 throws away the one word that
// tells the two three-hole sizes apart, so the wide names shrink instead of
// being cut -- and shrink once more on a 320px phone, where two columns and a
// sheet drawn to scale leave them 60px and they want 62. One pixel off six
// characters buys it; taking it out of the sheet instead would cost every
// size on the screen 6% to fit two names.
//
// Wide, not long: a kana or a kanji is a full em and a Latin letter about
// half, so counting characters says little. 「縦長ミニ3穴」 and 'Micro5' are
// both six characters and one is two thirds wider on screen.
const emWidth = (name: string) =>
  [...name].reduce((w, c) => w + (/[^\u0020-\u00ff]/.test(c) ? 1 : 0.55), 0);
const nameSize = (name: string) =>
  (emWidth(name) > 4.5 ? 'text-[13px] min-[360px]:text-[13px]' : 'text-[14px]');

// Selection is the size's own colour, drawn as an outline and a glow around
// the card, and nothing at all inside it. The card was once washed with that
// colour, which took contrast off everything standing on it at the one moment
// it mattered most -- the millimetres fell from 2.11 to 1.8, the colour bar
// from 3.5 to 2.4, and the sheet, being that same colour at full strength,
// was left with nothing but its outline to be seen by. Outside the border the
// colour can be as strong as it likes, because nothing has to be read
// through it.
//
// The border is the only hard edge; everything outside it is blur. A second
// crisp ring around the first read as a stroke rather than as light, so there
// is one soft shadow in the colour and then the card's own, which stays so a
// selected card still sits on the page rather than floating off it.
//
// It was 22px of blur spread 6px wide at 36% -- weather around the card
// rather than a mark on it, and on the picker, where the chosen card sits
// among others, the haze reached them too. Enough to see, not enough to be
// the loudest thing on the screen.
const CARD_SHADOW = '0 1px 3px rgba(38,36,31,0.07)';
// Chosen has to be visible from arm's length. A 1.5px border in the size's own
// colour is nothing at all on the pale ones -- Bible's blue against white is a
// hairline, and on the recording of a real phone you cannot tell which card is
// picked. A ring outside the border says it in a band three times as wide,
// without moving anything by a pixel.
const cardSkin = (on: boolean, line: string) =>
  ({
    borderColor: on ? line : 'var(--color-line)',
    background: '#fff',
    boxShadow: on ? `0 0 0 3px ${line}33, ${CARD_SHADOW}` : CARD_SHADOW,
    transition: 'box-shadow 140ms ease-out, border-color 140ms ease-out',
  }) as const;

// The paper is in millimetres and scaled as a whole to fit the box -- that is
// what makes this read as a sheet rather than as a box with dots on it -- but
// the pen that draws it is not. A 0.8mm line is 0.46px wide on M5 and 0.21px
// on A5, so the bigger the sheet the fainter its own outline, and A5 came out
// as a wash with no edge and no visible punch at all. `pen` turns a thickness
// on screen back into millimetres, which gives all nine sheets one line.
// 0.8 was a hairline: on the pale sizes -- Bible's blue, A5 slim's yellow --
// the sheet read as a smudge rather than as a drawn thing. 1.2 is where it
// becomes a line without becoming an icon (1.6 made the outline the subject
// and the paper the gap inside it).
const OUTLINE_PX = 1.2;
// The ring around a punch does NOT follow the outline up. The hole is about a
// pixel across on the small sizes, and a 1.2px ring on each side of a 1px
// white centre closes it: the holes came out as beads with no hole in them.
// The ring stays thin and the centre is what grew instead.
const HOLE_RING_PX = 0.9;
// The punch shrinks the same way: 5.5mm on A5 is a 0.7px dot. A hole keeps
// its true size wherever that still reads, and stops shrinking below a dot
// that does -- never past three quarters of the margin it sits in, or it
// would break out through the edge of the paper it is punched in. 1.4, not 1:
// with the outline at 1.2 a 1px hole is smaller than the line beside it, and
// reads as a dot rather than as something the ring passes through.
const HOLE_MIN_PX = 1.4;

// The binder, drawn where it grips the paper: one bar per hole, from a little
// outside the edge through the hole and a little past it, with the punched
// hole left white on top. A refill is a thing that gets bound, and a picture
// of one that shows only the holes leaves the reader to supply the binder --
// which is what made a spread hard to read, because the two pages of a spread
// are two sheets held by the same rings in the middle.
function Rings({ size, color, flip, pen, holeR }: {
  size: SizeSpec; color: string; flip: boolean;
  pen: (onScreen: number) => number; holeR: number;
}) {
  const onTop = size.ringsOn === 'top';
  const far = onTop ? size.heightMm : size.widthMm;
  const over = ringOut(size);
  const reach = size.ringMarginMm * 0.92;
  const thick = Math.max(holeR * 2.4, pen(3));
  const from = flip ? far - reach : -over;
  return (
    <g fill={color}>
      {holeCentres(size.holes).map((at, i) => (
        <rect
          key={i}
          x={onTop ? at - thick / 2 : from}
          y={onTop ? from : at - thick / 2}
          width={onTop ? thick : reach + over}
          height={onTop ? reach + over : thick}
          rx={thick / 2}
        />
      ))}
    </g>
  );
}

function SizeIcon({ size, color, flip = false, scale = SHEET_SCALE, rings = false }: {
  size: SizeSpec; color: string; flip?: boolean;
  scale?: number; rings?: boolean;
}) {
  const k = scale;
  const pen = (onScreen: number) => onScreen / k;
  const onTop = size.ringsOn === 'top';
  // `flip` is the left page of a spread: the binding is the seam between the
  // pages, so that one's holes sit on its far edge.
  const margin = size.ringMarginMm / 2;
  const band = flip ? (onTop ? size.heightMm : size.widthMm) - margin : margin;
  const hole = Math.min(
    Math.max(size.holes.diameterMm / 2, pen(HOLE_MIN_PX)),
    margin * 0.75,
  );
  const inset = pen(OUTLINE_PX) / 2;
  // The paper keeps its scale; the box around it gains the room the rings
  // stand out into, on the bound side only.
  const over = rings ? ringOut(size) : 0;
  // And half a pixel of air all round. Without it the outline's outer edge
  // lands exactly on the box's edge, and the box is a fractional number of
  // pixels tall (横長ミニ3穴 came to 18.7), so the bottom and right of the
  // sheet fell across a device pixel and came out visibly paler than the top
  // -- measured at 105 against 117. The air costs nothing and makes the four
  // sides the same weight.
  const air = pen(0.75);
  const vbX = (!onTop && !flip ? -over : 0) - air;
  const vbY = (onTop && !flip ? -over : 0) - air;
  const vbW = size.widthMm + (onTop ? 0 : over) + air * 2;
  const vbH = size.heightMm + (onTop ? over : 0) + air * 2;
  return (
    <svg
      width={vbW * k} height={vbH * k}
      viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
      className="block shrink-0"
      aria-hidden="true"
    >
      <rect
        x={inset} y={inset}
        width={size.widthMm - inset * 2} height={size.heightMm - inset * 2}
        rx={pen(2)} fill={PAPER} stroke={color} strokeWidth={pen(OUTLINE_PX)}
      />
      {rings && <Rings size={size} color={color} flip={flip} pen={pen} holeR={hole} />}
      {holeCentres(size.holes).map((at, i) => (
        <circle
          key={i}
          cx={onTop ? at : band} cy={onTop ? band : at}
          r={hole}
          fill="#fff" stroke={color} strokeWidth={pen(HOLE_RING_PX)}
        />
      ))}
    </svg>
  );
}

// The nine sizes, laid out to be compared. Extracted from the screen that
// asks for one first, because the same cards are what the paper's own chip
// opens later -- the size is a property of the paper, not a step you passed.
function SizeCards({ selected, wide, onPick }: {
  selected: RefillSize; wide: boolean; onPick: (s: RefillSize) => void;
}) {
  return (
          <div className="mb-auto flex w-full flex-col gap-3 py-0.5">
            {SIZE_GROUPS.map(group => (
              <section key={group.title} className="flex flex-col gap-1.5">
                <h2 className="sect m-0 flex items-center gap-2 text-[13px] font-bold tracking-[0.04em] text-muted">{group.title}</h2>
                {/* A grid, not nested flex rows: its columns are exactly half
                    each, where a flex item would refuse to shrink below its own
                    name and the longest one on a row would push the column edge
                    over. */}
                <div className="grid grid-cols-2 gap-1.5 lg:grid-cols-4">
                  {(wide ? group.rows.flat() : group.rows.flatMap(row => (row.length === 1 ? [...row, null] : row))).map((id, i) => (
                    id === null
                      // A size with no partner leaves the rest of its row empty
                      // rather than pulling the next pair apart.
                      ? <span key={`empty-${i}`} aria-hidden="true" />
                      : (
                        <button
                          key={id}
                          onClick={() => onPick(id)}
                          className={`sizerow relative flex min-w-0 items-center gap-1 overflow-hidden rounded-[18px] border-[1.5px] py-2 pl-3 pr-1 text-left`}
                          style={cardSkin(selected === id, SIZE_COLOR[id])}
                          aria-pressed={selected === id}
                        >
                          {/* A colour a glance can learn the size by, before the
                              name is read. Flush to the card's own edge and its
                              full height: a bar with air around it is a shape
                              sitting on the card, and this is meant to be the
                              card's edge. */}
                          <span
                            className="absolute inset-y-0 left-0 w-1.5"
                            style={{ background: SIZE_COLOR[id] }}
                          />
                          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <strong className={`truncate font-semibold leading-tight ${nameSize(SIZE_NAME[id])}`}>
                              {SIZE_NAME[id]}
                            </strong>
                            <span className="truncate text-[13px] leading-tight text-muted">
                              {sizeMm(SIZES[id])}
                            </span>
                            {/* In the size's own colour, which is the one place
                                that colour carries a fact rather than a label:
                                the sizes sharing a hole count are the sizes
                                whose sheets swap between binders. Darkened to
                                the point where ten pixels of it can be read. */}
                            <span
                              className="truncate text-[13px] font-semibold leading-tight"
                              style={{ color: SIZE_WORD[id] }}
                            >
                              {sizeHoles(SIZES[id])}
                            </span>
                          </span>
                          <span className="flex shrink-0 items-center justify-center" style={SHEET_SLOT}>
                            <SizeIcon size={SIZES[id]} color={SIZE_COLOR[id]} rings />
                          </span>
                          {/* Decoration: it says "this opens something", which
                              the button already says, so it stays out of the
                              name a screen reader reads -- and off a 320px
                              screen entirely. It and its gap cost 9px of the
                              135px card, which at that width is the difference
                              between "148×210mm" and "148×210m…", and the
                              millimetres are the only clue left to someone who
                              does not know the names. */}
                          <span aria-hidden="true" className="hidden shrink-0 text-[14px] leading-none text-muted min-[360px]:block">›</span>
                        </button>
                      )
                  ))}
                </div>
              </section>
            ))}
          </div>
  );
}

// Choosing a size and going on are two presses, as they are on the form
// screen: the card pressed stays chosen where it can be seen and changed,
// and the move to the next screen is the button's, not the card's.
function SizeScreen({ selected, onPick }: { selected: RefillSize; onPick: (s: RefillSize) => void }) {
  const wide = useWide();
  const [chosen, setChosen] = useState<RefillSize>(selected);
  return (
    <div className={`sizescreen ${PICK_SCREEN}`}>
      {/* The mark: a spread in the app's blue and yellow, held by rings seen
          from straight above -- upright, so short rigid bars from hole to
          hole rather than loops lying on the paper. Only here, before
          anything is made. */}
      <div className="brand flex items-center gap-2.5 text-[13px] font-semibold tracking-[0.22em] text-label">
        <LogoMark className="h-[30px] w-auto" />
        RING CRAFT LAB
      </div>
      <div>
        <h1 className="font-serif text-[22px] font-semibold">手帳のサイズを選ぶ</h1>
        <p className="m-0 mt-1 text-[13px] text-muted">お使いの手帳のサイズを選んでください</p>
        <i aria-hidden="true" className="mt-2.5 block h-[3px] w-7 bg-hi" />
      </div>
      {/* The list starts under the heading rather than floating in the middle
          of the screen, and `mb-auto` keeps it there whether or not it
          overflows -- `justify-center` on a scrolling column would push the
          first row above the scroll origin, where nothing can reach it. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <SizeCards selected={chosen} wide={wide} onPick={setChosen} />
      </div>
      <Button variant="cta" className="sizego shrink-0" onClick={() => onPick(chosen)}>
        {SIZE_NAME[chosen]}で作る
      </Button>
    </div>
  );
}

// The same card as the size picker, one per choice: the colour of the size
// just chosen, its own sheet drawn to scale, and the accent outline for the
// one that is selected. Two screens in a row that look unrelated read as two
// unrelated decisions, and this is the second half of one decision -- so the
// sheet keeps the picker's scale and the picker's slot, and the paper the
// finger just touched is the same paper, the same size, on the screen that
// follows. Drawing it larger here because there was room made the two
// screens look like two different apps.
// The forms this paper can take, drawn to one scale. It lives apart from the
// screen that first asks for it, because the same cards are what the paper's
// own chip opens afterwards: a form is not a step in a setup, it is a
// property of the paper, and a property has to be reachable while working.
function FormCards({ size, spread, fold, foldGrain, wide, onPick, onScale }: {
  size: RefillSize;
  spread: boolean;
  fold: FoldCount;
  foldGrain?: FoldGrain;
  wide: boolean;
  onPick: (v: { spread: boolean; fold: FoldCount; foldGrain?: FoldGrain }) => void;
  // Whatever draws this paper above the cards has to draw it the same size,
  // so the scale the cards settle on is handed back.
  onScale?: (k: number) => void;
}) {
  const spec = SIZES[size];
  const color = SIZE_COLOR[size];
  const flat = fold <= 1;
  const grains = foldGrainsOf(spec);
  const grain = foldGrain && grains.includes(foldGrain) ? foldGrain : grains[0];

  // Every choice is its own card with its own drawing, because the drawing is
  // the choice: a control that redraws one card makes the fold a setting of
  // something else, and you cannot compare two shapes you cannot see at once.
  // A size whose panels would come out unusably narrow simply has no card --
  // A5 at three panels is the one, where the paper runs out before the rings
  // do and each inner panel comes to half a page.
  type Choice = {
    key: string; on: boolean; pick: { spread: boolean; fold: FoldCount; foldGrain?: FoldGrain };
    title: string; note: string; sheets?: boolean[]; plan?: FoldPlan;
  };
  const foldCards = (g: FoldGrain): Choice[] => FOLD_PANELS.flatMap(n => {
    const plan = foldPlan(spec, n, g);
    if (!plan) return [];
    return [{
      key: `fold${n}${g}`,
      on: fold === n && grain === g,
      pick: { spread: false, fold: n as FoldCount, foldGrain: g },
      title: `${g === 'along' ? 'L字' : '蛇腹'}${n}面`,
      // The box you would measure on the table, not the fold's own axis:
      // folding along the binding stands the strip up.
      // The width is on the drawing now; what is left to say is what it comes
      // to when it is shut, which is the page it lives as in the binder.
      note: g === 'along'
        ? `広げて${plan.sheetWmm}×${plan.sheetHmm}mm`
        : `畳むと${spec.widthMm}×${spec.heightMm}mm`,
      plan,
    }];
  });
  const choices: Choice[] = [
    {
      key: 'spread', on: flat && spread, pick: { spread: true, fold: 1 },
      title: '見開き（2ページ）', note: '左右セットで1ヶ月分',
      // The left page's rings are drawn on its right: in a spread the binding
      // is the seam, which is the one thing a picture of it has to get right.
      sheets: [true, false],
    },
    {
      key: 'single', on: flat && !spread, pick: { spread: false, fold: 1 },
      title: '片面（1ページ）', note: '1ページで完結', sheets: [false],
    },
    ...foldCards('out'),
  ];
  // The L goes below, under a heading of its own. It is not a fourth way of
  // arranging pages: it is the same fold with the paper cut into an L, which
  // one size can do and the rest cannot. Mixed into the run above it read as
  // an ordinary alternative, and the extra cut went unsaid.
  const special = grains.includes('along') ? foldCards('along') : [];
  // The drawing is the choice, so it gets the room: as large as the widest
  // one on this screen can be and still fit a card, and one box only as tall
  // as the tallest of them -- the picker's own slot is A5's, which on
  // 横長ミニ3穴 left four rows of empty air above a 55mm strip. One scale for
  // every card, or a folded strip and a pair of pages could not be compared.
  const all = [...choices, ...special];
  const widestMm = Math.max(...all.map(c => (c.plan ? c.plan.sheetWmm : spec.widthMm * c.sheets!.length)));
  const tallestMm = Math.max(...all.map(c => (c.plan ? c.plan.sheetHmm : spec.heightMm)));
  const k = Math.min(SHEET_SCALE * 2.2, (wide ? 190 : 140) / widestMm);
  // The box the sheets are drawn in: one constant area, the same on every
  // card, so a sheet that fills more of it is a bigger sheet. The slot was
  // already this ruler -- shading it makes the comparison visible instead of
  // leaving it to be noticed. Plain grey, not ruled: a field of dots behind a
  // ruled sheet is two grids arguing, and the one that matters is the sheet's.
  // A margin of table around even the widest sheet: with the box cut exactly
  // to the widest one, that card's grey never showed, and a ruler you cannot
  // see on the longest thing you are measuring is not a ruler.
  const field = {
    width: (widestMm + ringOut(spec)) * k + 16,
    height: tallestMm * k + 12,
    backgroundColor: 'rgba(38,36,31,0.05)',
  } as const;
  // How wide the thing is when it is open, said under the drawing as the line
  // anyone measuring it would draw. The L folds downward, where a line under
  // it would be measuring the wrong edge, so it keeps to its note.
  const span = (c: Choice) => {
    if (c.plan) {
      return c.plan.grain === 'along'
        ? null
        : { mm: c.plan.sheetWmm, text: `広げて${Math.round(c.plan.sheetWmm)}mm` };
    }
    // Just the number: the title above already says how many pages it is.
    const mm = spec.widthMm * c.sheets!.length;
    return { mm, text: `${mm}mm` };
  };

  const card = (choice: Choice) => (
    <button
      key={choice.key}
      className="card flex flex-col items-center gap-2 rounded-[18px] border-[1.5px] px-2 py-3 text-center"
      style={cardSkin(choice.on, color)}
      aria-pressed={choice.on}
      onClick={() => onPick(choice.pick)}
    >
      {/* No gap between the two pages of a spread: each page's box already
          carries the room its own rings stand out into, and what meets in the
          middle is the one ring the two of them hang on. */}
      <span className="ruler flex items-center justify-center rounded-[10px]" style={field}>
        {choice.plan
          ? <FoldIcon size={spec} color={color} plan={choice.plan} scale={k} rings />
          : choice.sheets!.map((flip, i) => (
            <SizeIcon
              key={i} size={spec} color={color} flip={flip} scale={k} rings
            />
          ))}
      </span>
      {/* The rule keeps the size's bright colour -- a rule is a shape, not a
          word -- and the millimetres under it take the darkened one: Bible's
          pale blue at 11px came to 2.45:1. */}
      {span(choice) && (
        <span className="dim -mt-1 flex flex-col items-center" style={{ color }}>
          <svg width={Math.round(span(choice)!.mm * k)} height={7} aria-hidden="true" className="block">
            <g stroke="currentColor" strokeWidth={1}>
              <line x1={0.5} y1={3.5} x2={span(choice)!.mm * k - 0.5} y2={3.5} />
              <line x1={0.5} y1={0.5} x2={0.5} y2={6.5} />
              <line x1={span(choice)!.mm * k - 0.5} y1={0.5} x2={span(choice)!.mm * k - 0.5} y2={6.5} />
            </g>
          </svg>
          <em
            className="not-italic text-[13px] font-semibold leading-tight"
            style={{ color: SIZE_WORD[size] }}
          >{span(choice)!.text}</em>
        </span>
      )}
      <span className="flex flex-col gap-0.5">
        <strong className="text-[14px] font-semibold leading-tight">{choice.title}</strong>
        <span className="text-[13px] leading-tight text-muted">{choice.note}</span>
      </span>
    </button>
  );

  useLayoutEffect(() => { onScale?.(k); }, [k, onScale]);

  return (
    <>
      {/* Side by side. A comparison reads across, not down: stacked, these
          were the same drawing seen twice in a row instead of one beside the
          other. Every card keeps one box the height of the largest sheet, so
          a folded strip and a pair of pages are drawn to the same scale. */}
      <div className="grid grid-cols-2 gap-1.5 lg:grid-cols-4">
        {choices.map(choice => card(choice))}
      </div>
      {special.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div>
            <h2 className="m-0 text-[14px] font-semibold">特殊蛇腹（L字）</h2>
            <p className="m-0 mt-0.5 text-[13px] leading-snug text-muted">
              {`${SIZE_NAME[size]}だけの形。折り目がリングと直角なので、`
                + `内側の面は綴じ側を${special[0].plan!.insetMm}mm切り落とします`}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-1.5 lg:grid-cols-4">
            {special.map(choice => card(choice))}
          </div>
        </div>
      )}
    </>
  );
}

function SidesScreen({ size, spread, fold, foldGrain, onPick, onBack, onConfirm }: {
  size: RefillSize;
  spread: boolean;
  fold: FoldCount;
  foldGrain?: FoldGrain;
  onPick: (v: { spread: boolean; fold: FoldCount; foldGrain?: FoldGrain }) => void;
  onBack: () => void; onConfirm: () => void;
}) {
  const wide = useWide();
  const spec = SIZES[size];
  const color = SIZE_COLOR[size];
  // The cards below decide it; the sheet in the strip above has to match.
  const [k, setK] = useState(SHEET_SCALE);
  return (
    <div className={PICK_SCREEN}>
      {/* The card below is the size and can be pressed to change it, but a way
          back has to be where a way back is looked for. Leaving it to the card
          meant leaving it to be discovered, and it was not. */}
      <Button variant="chip" className="self-start" onClick={onBack}>
        <span className="text-[14px] leading-none">←</span>
        サイズを選び直す
      </Button>
      <div>
        <h1 className="text-[20px] font-bold">ページ構成を選ぶ</h1>
        <p className="m-0 mt-1 text-[13px] text-muted">この紙を、どう開く形にしますか</p>
      </div>
      {/* The size just chosen, carried across with its bar and its sheet: said
          in a line of grey text instead, the second screen looked like a
          different app, because the colour and the paper both vanished between
          one tap and the next.
          //
          It is not one of the choices, though, and wearing the chosen card's
          skin -- white card, colour border, glow -- it read as one that had
          already been picked. So it is settled into the page instead: a grey
          strip under a caption that says what it is, with a rule under it, and
          the four things to choose from below that. It stays pressable,
          because the thing to press to change the size is the size. */}
      {/* Everything between the title and the button scrolls, so nothing in it
          is squeezed to fit. As plain children of the screen's column they all
          had flex-shrink, and on a short window the strip was the first to
          give: on Micro5 it went from 97px to 18px and the name and the sheet
          were clipped away, leaving a bar with 「62×105mm」 in it. */}
      <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto">
      <span className="sect m-0 flex items-center gap-2 text-[13px] font-bold tracking-[0.04em] text-muted">作るリフィル</span>
      <button
        // Full width on a phone, where everything is; on a wide window it
        // hugs what it holds, because a strip the width of the screen with a
        // name at one end and a sheet at the other is mostly empty room.
        className="sizenow relative -mt-2 flex w-full min-w-0 shrink-0 items-center gap-3 overflow-hidden rounded-lg border border-line py-2 pl-3 pr-2 text-left hover:border-line-strong lg:w-auto lg:self-start lg:pr-4"
        style={{ background: 'rgba(38,36,31,0.04)' }}
        onClick={onBack}
      >
        <span className="absolute inset-y-0 left-0 w-1.5" style={{ background: color }} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5 lg:flex-none">
          <strong className={`truncate font-semibold leading-tight ${nameSize(SIZE_NAME[size])}`}>
            {SIZE_NAME[size]}
          </strong>
          <span className="truncate text-[13px] leading-tight text-muted">{sizeMm(spec)}</span>
          <span
            className="truncate text-[13px] font-semibold leading-tight"
            style={{ color: SIZE_WORD[size] }}
          >
            {sizeHoles(spec)}
          </span>
        </span>
        {/* The same scale as the cards below. At the picker's scale it was the
            same sheet drawn twice on one screen at two sizes -- and on a wide
            window, where the cards get the room to draw big, the one up here
            read as a thinner paper than the one being chosen. */}
        <span
          className="flex shrink-0 items-center justify-center"
          style={{ width: (spec.widthMm + ringOut(spec)) * k, height: spec.heightMm * k }}
        >
          <SizeIcon size={spec} color={color} scale={k} rings />
        </span>
        <span className="shrink-0 pr-0.5 text-[13px] text-accent-text">変更</span>
      </button>
      {/* The line between what is already decided and what is being asked. */}
      <hr className="m-0 w-full shrink-0 border-0 border-t border-line" />
      {/* Side by side, on the same two-column grid as the picker. A comparison
          reads across, not down: stacked, these were the same drawing seen
          twice in a row instead of one beside the other. Which also settles
          the shape of the card -- half the screen is too narrow to set a title
          beside the paper, so the paper goes on top and the words underneath.
          Every card keeps one box the height of the largest sheet, so a folded
          strip and a pair of pages are drawn to the same scale. */}
      <FormCards
        size={size} spread={spread} fold={fold} foldGrain={foldGrain}
        wide={wide} onPick={onPick} onScale={setK}
      />
      {/* The note that was here said three things about a fold, and the
          drawing now says two of them better: the rings are on the head panel
          only because that is where they are drawn, and what it comes to when
          shut is the card's own line (「畳むと80×128mm」). The third was the
          inner panels' millimetres, which is a number for laying parts out,
          not for choosing a form -- and the picture of a strip cut into
          numbered panels is what the choice is made on. */}
      </div>
      <Button variant="cta" className="mt-auto shrink-0" onClick={onConfirm}>この構成で作る</Button>
    </div>
  );
}

// The strip a fold unfolds into, drawn at the picker's scale so it can be
// compared with the pages above it. Only the first panel is punched, and the
// creases are where the paper actually bends.
function FoldIcon({ size, color, plan, scale = SHEET_SCALE, rings = false }: {
  size: SizeSpec; color: string; plan: FoldPlan;
  scale?: number; rings?: boolean;
}) {
  const k = scale;
  const pen = (onScreen: number) => onScreen / k;
  const margin = size.ringMarginMm / 2;
  const hole = Math.min(
    Math.max(size.holes.diameterMm / 2, pen(HOLE_MIN_PX)),
    margin * 0.75,
  );
  const line = pen(OUTLINE_PX) / 2;
  const W = plan.sheetWmm, H = plan.sheetHmm;
  const down = plan.grain === 'along';
  const panels = foldPanels(plan);
  // Folding along the binding cuts a corner off, so the outline is an L and
  // the picture has to be that L -- it is the whole difference between this
  // shape and the other one.
  const cut = plan.insetMm;
  const outline = `M ${line} ${line} L ${W - line} ${line} L ${W - line} ${H - line}`
    + ` L ${cut + line} ${H - line} L ${cut + line} ${plan.headMm} L ${line} ${plan.headMm} Z`;
  const out = rings ? ringOut(size) : 0;
  return (
    <svg
      width={(W + out) * k} height={H * k}
      viewBox={`${-out} 0 ${W + out} ${H}`}
      className="block shrink-0"
      aria-hidden="true"
    >
      {down ? (
        <path d={outline} fill={PAPER} stroke={color} strokeWidth={pen(OUTLINE_PX)} strokeLinejoin="round" />
      ) : (
        <rect
          x={line} y={line}
          width={W - line * 2} height={H - line * 2}
          rx={pen(2)} fill={PAPER} stroke={color} strokeWidth={pen(OUTLINE_PX)}
        />
      )}
      {/* Which panel is which. A strip with two dashed lines on it says there
          are three of something; the numbers say the three are the pages you
          will be laying parts on. */}
      {panels.length > 1 && panels.map((p, i) => (
        <text
          key={`n${p.atMm}`}
          x={down ? W / 2 : p.atMm + p.widthMm / 2}
          y={down ? p.atMm + p.widthMm / 2 : H - pen(4)}
          fill={color} opacity={0.75}
          fontSize={pen(8)} fontWeight={700} textAnchor="middle"
        >
          {i + 1}
        </text>
      ))}
      {panels.slice(1).map(p => (
        <line
          key={p.atMm}
          x1={down ? cut : p.atMm} y1={down ? p.atMm : 0}
          x2={down ? W : p.atMm} y2={down ? p.atMm : H}
          stroke={color} strokeWidth={pen(OUTLINE_PX * 0.8)} strokeDasharray={`${pen(3)} ${pen(2.4)}`}
        />
      ))}
      {rings && (
        <g fill={color}>
          {holeCentres(size.holes).map((at, i) => {
            const thick = Math.max(hole * 2.4, pen(3));
            return (
              <rect
                key={i}
                x={-ringOut(size)} y={at - thick / 2}
                width={ringOut(size) + size.ringMarginMm * 0.92} height={thick}
                rx={thick / 2}
              />
            );
          })}
        </g>
      )}
      {holeCentres(size.holes).map((at, i) => (
        <circle
          key={i}
          cx={margin} cy={at} r={hole}
          fill="#fff" stroke={color} strokeWidth={pen(HOLE_RING_PX)}
        />
      ))}
    </svg>
  );
}

// Whether the refills reach the paper's edge, and what that costs. Packing
// them edge to edge is what buys A5 its second refill and Micro5 its seventh
// and eighth, and the price is that a printer's unprintable border eats into
// whichever side has no clearance. Which side matters: the binding edge
// carries the punch guide, whose rim comes 2.0-3.3mm in, while every other
// edge is clear for 4.2mm. So the note says the number the user has to
// compare against their own printer rather than a verdict this cannot reach.
function EdgeNote({ size, count, sheet, paper }: {
  size: SizeSpec; count: number; sheet?: { widthMm: number; heightMm: number }; paper: PaperId;
}) {
  const plan = paperPlan(size, count, sheet, paper);
  const tight: string[] = [];
  if (plan.sideMm < 0.75) tight.push('左右');
  if (plan.endMm < 0.75) tight.push('上下');
  if (!tight.length) {
    return (
      <p className="edge-note m-0 mb-[13px] text-[13px] text-muted">
        外周に{Math.floor(Math.min(plan.sideMm, plan.endMm))}mm余ります。端まで刷る必要はありません
      </p>
    );
  }
  // The binding edge runs down the side of every size the app carries, so a
  // size whose left and right reach the paper is the only one whose punch
  // guide is in the firing line.
  const onEdge = tight.includes('左右') ? punchInset(size) : INK_INSET_MM;
  return (
    <p className="edge-note m-0 mb-[13px] text-[13px] text-muted">
      <span className="font-semibold text-label">{tight.join('と')}は紙の端まで使います。</span>
      お使いのプリンタの余白が{onEdge.toFixed(onEdge < 4 ? 2 : 1)}mmより広いと、
      {tight.includes('左右') ? '穴の目印の外側' : '中身のふち'}がそのぶん欠けます
    </p>
  );
}

interface DragState {
  kinds: PartKind[];
  fromSlot: number | null;
  moved: boolean;
  startX: number;
  startY: number;
}

// The contents of one book, in the order it is bound. A commercial refill set
// is a sequence -- year planner, then monthlies, then weeklies, then notes --
// and that sequence is the thing being made. Everything else in this app
// (dividing a surface, dropping parts, the paper) is about one section of it.
//
// The list is a list rather than a picture on purpose: what it answers is
// "what is in here and in what order", and a picture of the paper answers a
// different question (which the export screen answers, with the ＋ on it).
function ContentsScreen({ book, setBook, print, at, nth, onOpen, onBack, onImport }: {
  onImport: () => void;
  book: Book;
  setBook: (fn: (b: Book) => Book) => void;
  print: PrintOptions;
  // Which section the editor was on, so that going back goes back.
  at: number;
  // And which sheet of it, so that the page being edited is the one marked
  // here. Someone who came from the page number is looking for where they
  // just were; a wall of thumbnails with nothing marked does not say.
  nth: number;
  // `'range'` opens that section's period straight away (the number someone
  // wants to change is the one they just read in this row); `'part0'` opens
  // what the section is still missing.
  // The sheet as well as the section: pressing the ninth page of a run and
  // landing on its first one is the panel lying about what it just did.
  onOpen: (i: number, open?: 'range' | 'part0', sheet?: number) => void;
  onBack: () => void;
}) {
  const size = SIZES[book.sections[0].size];
  // A cover is one page in a book of spreads, so it is not what the form of
  // the book is read from -- and neither is a section that is mixed in with a
  // form of its own. `same` is null for a mixed book, and then the form is
  // said on each chip instead of once at the top, where it would be a lie.
  const same = oneForm(book.sections);
  const job = usePaperJob(book.sections, size, print);
  const [adding, setAdding] = useState(false);
  const [ask, setAsk] = useState<number | null>(null);
  // Which section's settings are open, and where a pressed empty page would
  // put what it is given.
  const [picked, setPicked] = useState<number | null>(null);
  const [addAt, setAddAt] = useState<number | null>(null);
  const pages = useMemo(() => pagesOf(book.sections), [book.sections]);
  // A phone has the width for pages half as large again as a desk's column
  // of them, and the pictures at the desk size were too small to read there.
  const big = !useWide();
  const box = big ? { w: 80, h: 112 } : { w: 54, h: 74 };
  const leafW = box.w + 8;
  // The sheet each page actually is, not the section it belongs to. A run of
  // fifty-three weeks drew fifty-three pictures of its first week: the panel
  // was a list of identical thumbnails, which is not a list of anything.
  // Cached by identity so a redraw of the panel is not fifty-three rebuilds --
  // `Thumb` remembers its drawing per layout object, and a fresh object every
  // render would remember nothing.
  const sheetFor = useMemo(() => {
    const seen = new Map<string, Layout>();
    return (at: number, nth: number): Layout => {
      const key = `${at}:${nth}`;
      const had = seen.get(key);
      if (had) return had;
      const made = sheetAt(book.sections[at], nth);
      seen.set(key, made);
      return made;
    };
  }, [book.sections]);
  // The page the editor was on, brought into view. A book of thirty pages
  // opens this panel scrolled to the top, which is not where you were.
  const hereRef = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => { hereRef.current?.scrollIntoView({ block: 'center' }); }, []);

  // The last sheet of paper is mostly empty, and one section is what fills it:
  // saying which one, and by how much, turns "too many" into one press. The
  // section chosen is the last that can give the sheets up -- notes before
  // dates, because a note has nothing to lose by being shorter.
  const over = job.perPaper - job.spare;
  const trim = useMemo(() => {
    if (!print.impose || job.sheets < 2 || job.spare === 0) return null;
    const order = book.sections.map((sec, at) => ({ sec, at }))
      .filter(x => sheetCount(x.sec) > 1)
      .sort((a, b) => (
        Number(hasDatedPart(a.sec)) - Number(hasDatedPart(b.sec)) || b.at - a.at
      ));
    for (const { sec, at } of order) {
      const to = shortenTo(sec, sheetCount(sec) - over);
      if (to) return { at, to, by: sheetCount(sec) - sheetCount(to) };
    }
    return null;
  }, [book.sections, job.sheets, job.spare, over, print.impose]);

  const move = (i: number, d: number) => setBook(b => {
    const to = i + d;
    if (to < 0 || to >= b.sections.length) return b;
    const sections = [...b.sections];
    [sections[i], sections[to]] = [sections[to], sections[i]];
    return { ...b, sections };
  });
  const setPages = (i: number, d: number) => setBook(b => ({
    ...b,
    sections: b.sections.map((sec, k) => (
      k === i ? { ...sec, pages: Math.max(1, Math.min(60, (sec.pages ?? 1) + d)) } : sec
    )),
  }));
  const drop = (i: number) => setBook(b => ({
    ...b,
    sections: b.sections.length > 1 ? b.sections.filter((_, k) => k !== i) : b.sections,
  }));

  return (
    <div className={PICK_SCREEN}>
      <header className="flex shrink-0 items-center gap-2 pb-1 pt-1 text-[13px] font-semibold text-label">
        <Button variant="icon" onClick={onBack} aria-label="戻る">←</Button>
        <span className="min-w-0 truncate">
          {size.label} {size.widthMm}×{size.heightMm}mm
          {same && (
            <>
              <span className="mx-1.5 text-muted">・</span>
              {formLabel(same, foldOf(same, size)?.grain)}
            </>
          )}
        </span>
      </header>
      <h1 className="m-0 mb-0.5 text-[20px]">
        ページの並び
        <span className="ml-2 align-middle text-[13px] font-normal text-muted">
          全{pages.length}ページ
        </span>
      </h1>

      {/* What the book is made of, above the pages it comes to -- the way a
          page panel keeps the masters above the pages. Pressing one is how
          its length, its order and its removal are reached: the pages
          themselves are the result and are not rearranged one by one. */}
      <ul className="sections m-0 flex shrink-0 list-none flex-wrap gap-1.5 p-0 pb-1">
        {book.sections.map((sec, i) => (
          <li key={i}>
            <Button
              variant="chip"
              className={`section ${i === at ? 'border-accent' : ''}`}
              onClick={() => setPicked(i)}
            >
              <span className="text-accent-text">{sectionMark(book.sections, i)}</span>
              <span className="secname">{sectionLabel(sec)}</span>
              <em className="not-italic text-muted">
                {runText(sec)}
                {/* Only where it is not already said at the top: in a mixed
                    book this is what explains the empty page between two
                    sections -- a spread has to start on an even page. */}
                {!same && !sec.cover && !sec.backCover && (
                  <>・{sec.single ? '1ページ' : formLabel(sec, foldOf(sec, size)?.grain)}</>
                )}
              </em>
            </Button>
          </li>
        ))}
        <li>
          <Button variant="chip" className="addsection" onClick={() => setAdding(true)}>
            ＋ 足す
          </Button>
        </li>
      </ul>

      {/* The pages, as they are turned: 1 alone on the right, then 2-3, 4-5.
          An empty page is a page -- press it and something goes there. */}
      <ul className="contents-list m-0 flex min-h-0 list-none flex-col items-center gap-2 overflow-y-auto p-0 pb-1">
        {Array.from({ length: Math.ceil((pages.length + 1) / 2) }, (_, row) => {
          // Row 0 is page 1 by itself; every row after it is a pair.
          const left = row === 0 ? null : pages[row * 2 - 1];
          const right = row === 0 ? pages[0] : pages[row * 2];
          if (!left && !right) return null;
          return (
            <li key={row} className="spread flex items-start gap-[3px]">
              {[left, right].map((leaf, half) => {
                const no = row === 0 ? (half === 1 ? 1 : 0) : row * 2 + half;
                if (!leaf) {
                  return <span key={half} style={{ width: leafW }} />;
                }
                const sec = leaf.at === null ? null : book.sections[leaf.at];
                // The sheet the editor is on -- both its pages, because a
                // spread is one sheet and turning lands on the pair.
                const here = !!sec && leaf.at === at && leaf.nth === nth;
                return (
                  <button
                    key={half}
                    ref={here && half === 0 ? hereRef : undefined}
                    style={{ width: leafW }}
                    className={`leaf flex flex-col items-center gap-0.5 p-0 ${
                      sec ? '' : 'empty'
                    } ${here ? 'here' : ''}`}
                    onClick={() => (sec ? onOpen(leaf.at!, undefined, leaf.nth) : setAddAt(leaf.before))}
                  >
                    {sec ? (
                      <Thumb
                        layout={sheetFor(leaf.at!, leaf.nth)} size={size} side={leaf.side}
                        box={box} ring={here} lazy
                      />
                    ) : (
                      <span style={{ width: box.w, height: box.h }} className="flex items-center justify-center rounded-[3px] border border-dashed border-line-strong text-[16px] text-muted">
                        ＋
                      </span>
                    )}
                    <span className={`text-[13px] leading-none ${here ? 'font-semibold text-accent-text' : 'text-muted'}`}>
                      {no}
                      {sec && <span className="ml-0.5 text-accent-text">{sectionMark(book.sections, leaf.at!)}</span>}
                    </span>
                  </button>
                );
              })}
            </li>
          );
        })}
      </ul>

      {/* What the whole book comes to on paper. The number that makes someone
          want to shorten something is this one, so it is here rather than
          three screens away -- and so is the shortening. */}
      <p className="fill-note m-0 mt-auto pt-2 text-[13px] text-muted">
        {print.impose
          ? `${PAPERS[print.paper].label} ${job.sheets}枚・ぜんぶで${job.used}${job.unit}` +
            (job.spare > 0 ? `・最後の紙にあと${job.spare}${job.unit}ぶん` : '・あきはありません')
          : `1枚ずつ ${job.used}${job.unit}`}
      </p>
      {trim && (
        <span className="trim flex flex-wrap items-center gap-x-2 gap-y-1 pt-0.5">
          <span className="flex-1 text-[13px] text-accent-text">
            {sectionLabel(book.sections[trim.at])}を
            {runText(book.sections[trim.at])}→{runText(trim.to)}にすると
            {PAPERS[print.paper].label} {job.sheets - 1}枚に収まります
          </span>
          <Button variant="quiet" className="dotrim" onClick={() => setBook(b => ({
            ...b,
            sections: b.sections.map((sec, k) => (k === trim.at ? trim.to : sec)),
          }))}>そうする</Button>
        </span>
      )}


      {(adding || addAt !== null) && (
        <AddSection
          job={job} print={print}
          positioned={addAt !== null}
          cover={!book.sections.some(l => l.cover) && (addAt === null || addAt === 0)}
          onImport={addAt === null ? () => { setAdding(false); onImport(); } : undefined}
          onPick={kind => {
            // A cover goes on the front from wherever it was asked for; an
            // empty page takes what it was given, as one page (an empty page
            // is one page); anything else goes on the end.
            const where = kind === 'cover' ? 0 : addAt ?? book.sections.length;
            setAdding(false);
            setAddAt(null);
            setBook(b => ({
              ...b,
              sections: withSection(b.sections, sectionOf(kind, bodyOf(b), addAt !== null), where),
            }));
            if (kind === 'cover' || kind === 'blank') onOpen(where);
          }}
          onClose={() => { setAdding(false); setAddAt(null); }}
        />
      )}

      {/* One section's own settings, from its chip: how long it runs, where
          it sits in the book, and whether it stays. */}
      {picked !== null && book.sections[picked] && (
        <Modal title={sectionLabel(book.sections[picked])} onClose={() => setPicked(null)}>
          <p className="secspan m-0 text-[13px] text-muted">{sectionSpan(book.sections[picked])}</p>
          {hasDatedPart(book.sections[picked]) ? (
            <Button variant="quiet" className="torange" onClick={() => onOpen(picked, 'range')}>
              期間を変える
            </Button>
          ) : (
            <span className="pages flex items-center gap-2">
              <Button variant="icon" onClick={() => setPages(picked, -1)} aria-label="減らす">−</Button>
              <strong className="min-w-[3.5rem] text-center text-[14px]">
                {Math.max(1, book.sections[picked].pages ?? 1)}ページ
              </strong>
              <Button variant="icon" onClick={() => setPages(picked, 1)} aria-label="増やす">＋</Button>
            </span>
          )}
          <span className="flex gap-1.5">
            <Button variant="quiet" className="flex-1" onClick={() => { move(picked, -1); setPicked(picked - 1); }}>
              ↑ 前へ
            </Button>
            <Button variant="quiet" className="flex-1" onClick={() => { move(picked, 1); setPicked(picked + 1); }}>
              ↓ 後ろへ
            </Button>
          </span>
          <Button variant="quiet" className="open" onClick={() => onOpen(picked)}>編集する</Button>
          {book.sections.length > 1 && (
            <Button variant="quiet" className="dropsec" onClick={() => { setAsk(picked); setPicked(null); }}>
              このリフィルを外す
            </Button>
          )}
        </Modal>
      )}
      {ask !== null && (
        <Dialog
          message={`「${sectionLabel(book.sections[ask])}」を外しますか`}
          confirmLabel="外す"
          onConfirm={() => { drop(ask); setAsk(null); }}
          onCancel={() => setAsk(null)}
        />
      )}
    </div>
  );
}

// The book as pages, in the order they are turned. A page is one side of a
// punched sheet, but nobody who owns a planner thinks of it that way: they
// think 1ページ, 2ページ, and a spread is what two facing pages make.
//
// Facing pages: with the rings on the left, page 1 is alone on the right and
// pairs run 2-3, 4-5. So a spread section has to start on an even page, and
// if the page before it is not there, the book has an empty page at that
// point -- which is a page, not waste: it is where a cover or a year planner
// goes. Printing is what turns these into sheets, and it is not this
// screen's business.
interface Leaf {
  // Which section this page belongs to, and which sheet of that section.
  at: number | null;
  nth: number;
  // Which page of that sheet: a spread has a left and a right.
  side: number;
  // For an empty page: where in the book something put here would go.
  before: number;
}

// The letter a page wears to say which section it came from -- A, B, C down
// the book. A page panel marks its pages this way because at thumbnail size
// two monthlies and a weekly are the same grey rectangle.
const sectionMark = (sections: Layout[], at: number): string =>
  String.fromCharCode(65 + (at % 26));

function pagesOf(sections: Layout[]): Leaf[] {
  const out: Leaf[] = [];
  const blank = (before: number) => out.push({ at: null, nth: 0, side: 0, before });
  sections.forEach((sec, at) => {
    const n = sheetCount(sec);
    if (sec.spread && sec.fold <= 1) {
      // A spread's left page is an even page number, which is an odd index.
      if (out.length % 2 === 0) blank(at);
      for (let nth = 0; nth < n; nth++) {
        out.push({ at, nth, side: 0, before: at });
        out.push({ at, nth, side: 1, before: at });
      }
    } else {
      for (let nth = 0; nth < n; nth++) out.push({ at, nth, side: 0, before: at });
    }
  });
  // The back of the last sheet is a page too -- the one a set puts its index
  // or a note page on.
  if (out.length % 2 === 1) blank(sections.length);
  return out;
}

// Whether this sheet of a one-page section is printed on the back of the
// paper. The pages of the book alternate front and back when both sides are
// printed, and a one-page section takes whichever the book has free there --
// which is how the back of the last spread becomes a page with its holes on
// the right.
function backSideOf(sections: Layout[], at: number, nth: number, duplex: boolean): boolean {
  const sec = sections[at];
  if (!duplex || !sec?.single || sec.fold > 1) return false;
  const i = pagesOf(sections).findIndex(l => l.at === at && l.nth === nth);
  return i >= 0 && i % 2 === 1;
}

// The smallest change that gets a section down to `want` sheets or fewer.
// A note section is however many sheets it says; a dated one is as long as
// its dates, so it is shortened a month at a time -- a weekly cannot stop
// mid-month, and pretending otherwise would be a control that lies.
function shortenTo(l: Layout, want: number): Layout | null {
  if (want < 1 || sheetCount(l) <= want) return null;
  if (!hasDatedPart(l)) return { ...l, pages: want };
  let months = Math.max(1, l.monthCount);
  while (months > 1 && sheetCount({ ...l, monthCount: months }) > want) months--;
  const out = { ...l, monthCount: months };
  return sheetCount(out) < sheetCount(l) ? out : null;
}

// How long a section runs, in the words its own content uses: months for a
// monthly, weeks for a weekly, sheets for a note. Not in places on the paper
// -- a week is a page and two pages share a sheet, so "48枚" for a year of
// weeks is true of neither the run nor the paper.
function runText(l: Layout): string {
  // Pages, because the contents is a list of pages: a note section of three
  // is three pages of the book, not three sheets of paper (a sheet carries
  // two). The paper has its own line, in its own unit.
  if (!hasDatedPart(l)) return `${Math.max(1, l.pages ?? 1)}ページ`;
  if (isDayPaced(l)) return l.daysPerSheet === 7 ? `${sheetCount(l)}週` : `${sheetCount(l)}枚`;
  return `${Math.max(1, l.monthCount)}ヶ月`;
}

// How long a section runs, with the dates it covers. This is what someone
// shortens when it turns out to be too much.
function sectionSpan(l: Layout): string {
  if (!hasDatedPart(l)) return runText(l);
  const end = runEnd(l);
  return `${l.year}年${l.month}月 → ${end.year}年${end.month}月・${runText(l)}`;
}

// ── 📖 めくって見る ──────────────────────────────────────────────────────
// The book as a book. Someone who has just finished a month does not want to
// know how many faces fit on A4: they want to know what it will look like in
// the binder, which is a thing you find out by turning the pages. So nothing
// about paper, imposition, sides or cut lines gets in here -- that is the
// export sheet's business, and this screen never mentions it.
//
// It opens on the page the editor was on, because checking the page being
// worked on is what this is used for most, and pressing a page opens it in the
// editor. That makes this a way of getting to work as much as a way of
// looking: turn to the week that is wrong, press it, fix it, come back.

// How long one leaf takes to go over: felt, not watched. A riffle is quicker
// because several are going over at once.
const TURN_MS = 170;
const RIFFLE_MS = 90;
// Past this a swipe is a riffle rather than a turn, in pixels per millisecond.
// A deliberate turn is a third of the screen in a third of a second, which is
// 0.4; a flick is the same distance in a tenth, which is 4. The line between
// them is nearer the flick, because turning one page when three were asked for
// is a smaller mistake than the other way round.
const RIFFLE_SPEED = 1.6;
// How far a swipe has to go before it is a turn at all, and how far down
// before it is the way out.
const SWIPE_PX = 30;
const SHUT_PX = 60;
// The binder's rings: hardware, so neither the paper's colour nor the app's.
const RING_INK = '#D2CCC1';
const RING_EDGE = '#8E887C';
// How many sheet edges a stack shows before one more stops reading.
const STACK_MAX = 8;

function BookView({ book, at, nth, print, onClose, onEdit, onAddAt }: {
  book: Book;
  // Where the editor was, so this opens on that page.
  at: number; nth: number;
  print: PrintOptions;
  onClose: () => void;
  onEdit: (at: number, nth: number) => void;
  // An empty page is a page of the book with nothing in it yet, and pressing
  // one asks what goes there -- the same question the list asks, in the same
  // sheet. Leaving it dead was the one place in the book where pressing the
  // paper did nothing at all.
  onAddAt: (where: number, kind: SectionKind) => void;
}) {
  const size = SIZES[book.sections[0].size];
  // A cover is one page whatever the book is folded into, so it is not what
  // the shape of the book is read from.
  const body = bodyOf(book);
  // Which way the book opens. The rings hold one edge and the leaf swings
  // round it, so a refill bound along the top has its pages above and below
  // each other rather than side by side -- and turning it is a motion up, not
  // across.
  const across = !ringsOnTop(body);
  const leaves = useMemo(() => pagesOf(book.sections), [book.sections]);
  const rows = Math.max(1, Math.ceil((leaves.length + 1) / 2));
  const hasCover = book.sections.some(l => l.cover);
  // Page 1 is alone on the right; every row after it is a facing pair.
  const halves = (r: number): [Leaf | null, Leaf | null] => (
    r <= 0
      ? [null, leaves[0] ?? null]
      : [leaves[r * 2 - 1] ?? null, leaves[r * 2] ?? null]
  );
  const openedAt = leaves.findIndex(l => l.at === at && l.nth === nth);
  const [row, setRow] = useState(() => (openedAt <= 0 ? 0 : Math.floor((openedAt + 1) / 2)));
  // Where something put here would go, while the sheet asking what is open.
  const [addAt, setAddAt] = useState<number | null>(null);
  // The leaf in the air: which pair it left from, which way it is going, and
  // how long it has. While it is up, the half it is uncovering already shows
  // the pair being turned to -- that is what the leaf is uncovering.
  const [flip, setFlip] = useState<{ lo: number; fwd: boolean; ms: number } | null>(null);
  const rowRef = useRef(row);
  const busy = useRef(false);
  const queued = useRef(0);
  const timer = useRef(0);
  useLayoutEffect(() => { rowRef.current = row; }, [row]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const calm = useMemo(
    () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  // One leaf at a time, however many were asked for. A riffle is the same turn
  // done quickly rather than a jump with a fade: what makes a book feel like a
  // book is that the pages in between went past.
  const walk = (n: number) => {
    if (!n) return;
    if (busy.current) { queued.current += n; return; }
    const fwd = n > 0;
    const from = rowRef.current;
    const to = from + (fwd ? 1 : -1);
    if (to < 0 || to >= rows) { queued.current = 0; return; }
    const rest = n - (fwd ? 1 : -1);
    const land = () => { setRow(to); rowRef.current = to; };
    if (calm) { land(); walk(rest); return; }
    const ms = Math.abs(n) > 1 ? RIFFLE_MS : TURN_MS;
    busy.current = true;
    setFlip({ lo: fwd ? from : to, fwd, ms });
    timer.current = window.setTimeout(() => {
      land();
      setFlip(null);
      busy.current = false;
      const more = rest + queued.current;
      queued.current = 0;
      walk(more);
    }, ms);
  };
  // Going somewhere rather than turning: thirty leaves at ninety milliseconds
  // is three seconds of watching paper.
  const jump = (r: number) => {
    window.clearTimeout(timer.current);
    busy.current = false;
    queued.current = 0;
    setFlip(null);
    setRow(r);
    rowRef.current = r;
  };

  // A page with nothing on it is still a page of the book -- the back of the
  // last sheet, or the one a spread needs in front of it -- so it is drawn as
  // paper, punched, rather than as a gap.
  const blankSheet = useMemo((): Layout => ({
    ...createLayout(), size: body.size, orientation: body.orientation,
    spread: false, fold: 1,
  }), [body.size, body.orientation]);

  // The sheet each page actually is -- October's page shows October -- with
  // its drawing and its shape. Cached by page, because turning back to a
  // spread must not rebuild a month's worth of dates.
  //
  // A page in the left half is the back of a sheet, and turning a sheet over
  // puts its rings on the other edge -- which is what `flipBinding` is for,
  // and what the printing path does with the same pages. Only a single-sided
  // page changes: a designed spread already knows which of its two pages
  // carries the seam on which side. Without it a book of single pages came out
  // with the left half's holes on the outer edge, nowhere near the rings.
  const sheets = useMemo(() => new Map<string, Layout>(), [book.sections]);
  const made = useMemo(
    () => new Map<string, { page: Page | null; shape: PageGeometry | null }>(),
    [book.sections, size],
  );
  const sheetOf = (leaf: Leaf): Layout => {
    const key = `${leaf.at}:${leaf.nth}`;
    let one = sheets.get(key);
    if (!one) {
      one = leaf.at === null ? blankSheet : sheetAt(book.sections[leaf.at], leaf.nth);
      sheets.set(key, one);
    }
    return one;
  };
  const paperOf = (leaf: Leaf | null, seam: 'lo' | 'hi') => {
    const back = seam === 'lo';
    if (!leaf) return { page: null, shape: null };
    const key = `${leaf.at}:${leaf.nth}:${leaf.side}:${back}`;
    let one = made.get(key);
    if (!one) {
      const sheet = sheetOf(leaf);
      // Relative to the side the section already knows it is on.
      const pages = buildPages(sheet, size, back !== !!sheet.onBack);
      const geo = buildGeometry(sheet, size, back !== !!sheet.onBack);
      const i = Math.min(leaf.side, pages.length - 1);
      one = { page: pages[i] ?? null, shape: geo.pages[Math.min(leaf.side, geo.pages.length - 1)] ?? null };
      made.set(key, one);
    }
    return one;
  };

  // One scale for the whole book, taken from its largest page: nothing may
  // change size as it is turned.
  const span = useMemo(() => {
    let w = 1, h = 1;
    book.sections.forEach(sec => buildGeometry(sec, size).pages.forEach(p => {
      w = Math.max(w, p.widthMm); h = Math.max(h, p.heightMm);
    }));
    return { w, h };
  }, [book.sections, size]);

  const boxRef = useRef<HTMLDivElement>(null);
  const [glass, setGlass] = useState({ w: 320, h: 480 });
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setGlass({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Room for the rings to stand out into on the bound side, and air all round.
  const out = ringOut(size);
  const pad = 14;
  const scale = Math.max(0.2, Math.min(
    (glass.w - pad * 2 - (across ? GAP : 0)) / ((across ? span.w * 2 : span.w) + (across ? 0 : out)),
    (glass.h - pad * 2 - (across ? 0 : GAP)) / ((across ? span.h : span.h * 2) + (across ? 0 : out)),
  ));
  const boxW = span.w * scale;
  const boxH = span.h * scale;
  const overW = across ? boxW * 2 + GAP : boxW;
  const overH = across ? boxH : boxH * 2 + GAP;
  // Where the second half sits: past the seam, along the bound edge.
  const offX = across ? boxW + GAP : 0;
  const offY = across ? 0 : boxH + GAP;

  // What is on screen. Mid-turn the pair is split across two rows: the half
  // the leaf came off still shows the pair it left, and the half it is
  // uncovering already shows the pair it is going to.
  const lo = flip ? halves(flip.lo)[0] : halves(row)[0];
  const hi = flip ? halves(flip.lo + 1)[1] : halves(row)[1];
  const front = flip ? halves(flip.lo)[1] : null;
  const backOf = flip ? halves(flip.lo + 1)[0] : null;
  // Which pair the numbers and the thickness belong to: the one being turned
  // to, from the moment the leaf leaves the paper.
  const shown = flip ? (flip.fwd ? flip.lo + 1 : flip.lo) : row;
  const [shownLo, shownHi] = halves(shown);
  const noOf = (r: number, half: 0 | 1) => (r === 0 ? (half === 1 ? 1 : 0) : r * 2 + half);
  const numbers = [shownLo ? noOf(shown, 0) : 0, shownHi ? noOf(shown, 1) : 0].filter(n => n > 0);
  // How thick the book is either side of where it is open. Two pages to a
  // sheet, and a stack stops saying anything new after eight edges.
  const edges = (pages: number) => Math.min(STACK_MAX, Math.round(pages / 2));
  const stackLo = edges(shown === 0 ? 0 : shown * 2 - 1);
  const stackHi = edges(Math.max(0, leaves.length - (shown === 0 ? 1 : shown * 2 + 1)));

  // Where a page sits inside its half: against the rings, centred the other
  // way. A section turned on its side is a different shape from the one beside
  // it, and both are held by the same rings.
  const placeOf = (page: Page | null, seam: 'lo' | 'hi') => {
    const pw = (page?.widthMm ?? span.w) * scale;
    const ph = (page?.heightMm ?? span.h) * scale;
    return {
      pw, ph,
      x: across ? (seam === 'hi' ? 0 : boxW - pw) : (boxW - pw) / 2,
      y: across ? (boxH - ph) / 2 : (seam === 'hi' ? 0 : boxH - ph),
    };
  };

  const down = useRef<{ x: number; y: number; t: number } | null>(null);
  const dragged = useRef(false);

  // One face of the book: the paper, the edges of the sheets under it, and a
  // press that opens it in the editor. Not a component -- it is inlined into
  // this screen's own tree, so turning the page does not throw the drawing
  // away and build it again.
  const face = (leaf: Leaf, seam: 'lo' | 'hi', stack: number, live: boolean) => {
    const { page } = paperOf(leaf, seam);
    // A cover with nothing on it yet is a white sheet, and so is a page with
    // nothing in it: the same picture for two different things, one of which
    // takes a press and the other of which asks for one. The cover says which
    // it is -- 「表紙」 on the paper, the way the editor says it on its own.
    const sec = leaf.at === null ? null : book.sections[leaf.at];
    const naming = sec?.cover && isPlaceholder(sec) ? '表紙'
      : sec?.backCover && isPlaceholder(sec) ? '裏表紙' : null;
    const { pw, ph, x, y } = placeOf(page, seam);
    const away = seam === 'hi' ? 1 : -1;
    const sheet = { left: x, top: y, width: pw, height: ph };
    return (
      <>
        {Array.from({ length: stack }, (_, i) => (
          <span
            key={i}
            aria-hidden="true"
            className="absolute rounded-[2px] bg-[#F1EDE4] shadow-[0_0_0_0.5px_rgba(0,0,0,0.12)]"
            style={{
              ...sheet,
              left: x + (across ? away * (i + 1) * 1.7 : (i + 1) * 0.7),
              top: y + (across ? (i + 1) * 0.7 : away * (i + 1) * 1.7),
            }}
          />
        ))}
        {leaf.at !== null && page ? (
          <button
            className="bookpage absolute overflow-hidden rounded-[2px] bg-white p-0 shadow-[0_14px_30px_rgba(0,0,0,0.45)]"
            style={sheet}
            disabled={!live}
            onClick={() => { if (!dragged.current && leaf.at !== null) onEdit(leaf.at, leaf.nth); }}
            aria-label={`${noOf(shown, seam === 'hi' ? 1 : 0)}ページを直す`}
          >
            <PageSvg page={page} scale={scale} showGuides />
            {naming && (
              <span className="absolute inset-0 flex items-center justify-center text-[13px] text-muted">
                {naming}
              </span>
            )}
          </button>
        ) : (
          // Paper with nothing in it yet. It is punched like the rest -- it is
          // a page of this book, not a gap -- and pressing it asks what goes
          // there, which is what every other page's press does in its own way.
          <button
            className="bookblank absolute overflow-hidden rounded-[2px] bg-white p-0 shadow-[0_14px_30px_rgba(0,0,0,0.45)]"
            style={sheet}
            disabled={!live}
            onClick={() => { if (!dragged.current) setAddAt(leaf.before); }}
            aria-label="このページに足す"
          >
            {page && <PageSvg page={page} scale={scale} showGuides />}
            <span className="pointer-events-none absolute inset-0">
              <span
                className="blankmark absolute flex items-center justify-center rounded-[3px] border-[1.4px] border-dashed border-muted/70 text-[26px] leading-none text-muted"
                style={emptyFrame(leaf, seam, pw, ph)}
              >＋</span>
            </span>
          </button>
        )}
      </>
    );
  };

  // Where 「nothing here yet」 is drawn: inside the page, clear of the margin
  // the rings run through, so the dashes read as the empty room on the sheet
  // rather than as a second sheet lying on it.
  const emptyFrame = (leaf: Leaf, seam: 'lo' | 'hi', pw: number, ph: number) => {
    const { shape } = paperOf(leaf, seam);
    const ring = (size.ringMarginMm * scale);
    const onTop = shape ? shape.ringBand.w > shape.ringBand.h : false;
    const pad = Math.max(6, pw * 0.07);
    const left = !onTop && seam === 'hi' ? ring : pad;
    const right = !onTop && seam === 'lo' ? ring : pad;
    const top = onTop && seam === 'hi' ? ring : pad;
    const bottom = onTop && seam === 'lo' ? ring : pad;
    return { left, top, width: pw - left - right, height: ph - top - bottom };
  };

  // The rings, drawn where they grip: one bar per punch, through both pages of
  // the spread and a little past each. This is what says the two pages are
  // held by the same binder -- and on page 1, alone on the right, what says
  // there is nothing on the other side of them yet.
  const ringSide: 'lo' | 'hi' = hi ? 'hi' : 'lo';
  const ringPaper = paperOf(hi ?? lo, ringSide);
  const ringAt = ringPaper.shape;
  const ringSeam = (across ? boxW : boxH) + GAP / 2;
  const reach = size.ringMarginMm * 0.92 * scale + GAP / 2;
  const ringPlace = placeOf(ringPaper.page, ringSide);

  const onDown = (e: ReactPointerEvent) => {
    down.current = { x: e.clientX, y: e.clientY, t: Date.now() };
    dragged.current = false;
  };
  const onMove = (e: ReactPointerEvent) => {
    const d = down.current;
    if (!d) return;
    if (Math.abs(e.clientX - d.x) > 10 || Math.abs(e.clientY - d.y) > 10) dragged.current = true;
  };
  // A swipe along the bound edge turns the page; a pull downwards closes the
  // book. Both exist as buttons as well -- a gesture is never the only way to
  // do something here, because a gesture cannot be seen.
  const onUp = (e: ReactPointerEvent) => {
    const d = down.current;
    down.current = null;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    const along = across ? dx : dy;
    if (Math.abs(along) < SWIPE_PX) {
      if (across && dy > SHUT_PX && Math.abs(dx) < 40) { dragged.current = true; onClose(); }
      return;
    }
    const speed = Math.abs(along) / Math.max(1, Date.now() - d.t);
    const many = speed > RIFFLE_SPEED ? 3 : 1;
    walk(along < 0 ? many : -many);
  };

  return (
    <div className="bookview screen-in fixed inset-0 z-50 flex flex-col bg-[#2E2A25]">
      <header className="flex shrink-0 items-center gap-2 px-3.5 pb-1 pt-3 text-[13px] text-white">
        {/* Which page this is. A number is information, so it may be written;
            it is in the corner because it is not what anyone came to read. */}
        <span className="bookno font-semibold">
          {numbers.join('–') || '1'}
          <span className="ml-1.5 font-normal text-white/70">/ 全{leaves.length}ページ</span>
        </span>
        <button
          className="bookclose ml-auto size-[34px] rounded-full bg-white/20 p-0 text-[18px] leading-[34px] text-white"
          onClick={onClose}
          aria-label="閉じる"
        >×</button>
      </header>

      <div
        ref={boxRef}
        className="relative flex min-h-0 grow touch-none items-center justify-center overflow-hidden"
        style={{ perspective: 1600 }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => { down.current = null; }}
      >
        <div className="relative" style={{ width: overW, height: overH, transformStyle: 'preserve-3d' }}>
          <span className="absolute" style={{ left: 0, top: 0, width: boxW, height: boxH }}>
            {lo && face(lo, 'lo', stackLo, !flip)}
          </span>
          <span className="absolute" style={{ left: offX, top: offY, width: boxW, height: boxH }}>
            {hi && face(hi, 'hi', stackHi, !flip)}
          </span>

          {/* The leaf in the air. Its front is the page it was showing and its
              back is the page it is about to show -- which is what a sheet of
              paper is, and why this reads as turning rather than as sliding. */}
          {flip && front && (
            <span
              className={`bookleaf absolute z-10 ${
                across ? (flip.fwd ? 'leaf-fwd-y' : 'leaf-back-y')
                  : (flip.fwd ? 'leaf-fwd-x' : 'leaf-back-x')
              }`}
              style={{
                left: offX, top: offY, width: boxW, height: boxH,
                transformStyle: 'preserve-3d',
                transformOrigin: across ? 'left center' : 'center top',
                animationDuration: `${flip.ms}ms`,
              }}
            >
              <span className="absolute inset-0" style={{ backfaceVisibility: 'hidden' }}>
                {face(front, 'hi', 0, false)}
              </span>
              {/* Mirrored about its own middle, so that once the leaf is over
                  what is drawn on the back of it reads the right way round. */}
              <span
                className="absolute inset-0"
                style={{
                  backfaceVisibility: 'hidden',
                  transform: across ? 'rotateY(180deg)' : 'rotateX(180deg)',
                }}
              >
                {backOf && face(backOf, 'lo', 0, false)}
              </span>
            </span>
          )}

          {ringAt && ringAt.holes.map((h, i) => {
            // A ring passes through the punch, so the wire is thinner than the
            // hole -- about half of it on a real binder. Drawn as thick as the
            // hole it goes through, it stopped being a ring and became a peg,
            // and the punched holes it is supposed to run through disappeared
            // under it.
            const thick = Math.max(h.r * 2 * 0.55 * scale, 2.2);
            const mid = across ? ringPlace.y + h.cy * scale : ringPlace.x + h.cx * scale;
            return (
              <span
                key={i}
                aria-hidden="true"
                className="absolute z-20 rounded-full"
                style={across ? {
                  left: ringSeam - reach, top: mid - thick / 2,
                  width: reach * 2, height: thick,
                  background: `linear-gradient(to bottom, ${RING_INK}, ${RING_EDGE})`,
                } : {
                  top: ringSeam - reach, left: mid - thick / 2,
                  height: reach * 2, width: thick,
                  background: `linear-gradient(to right, ${RING_INK}, ${RING_EDGE})`,
                }}
              />
            );
          })}
        </div>
      </div>

      {/* Turning, and the two ends of the book. A thumb through thirty pages
          wants both: the front is where the cover and the year planner are,
          and the back is where the notes and the index go -- and someone who
          has just riffled forward to look at December is three seconds from
          the back and thirty from the front.

          The ends are on the outside and the turns in the middle, so the row
          reads the way the book goes. Both ends go dim when you are standing
          on them rather than disappearing, for the same reason the arrows do:
          a row that changes width moves the button under your thumb. */}
      <div className="bookpager flex shrink-0 items-center justify-center gap-2.5 px-3.5 pb-5 pt-1">
        <Button
          variant="chip"
          className="bookstart disabled:opacity-40"
          disabled={row <= 0}
          onClick={() => jump(0)}
        >
          <span className="text-[14px] leading-none">«</span>
          {hasCover ? '表紙へ' : '最初へ'}
        </Button>
        <Button
          variant="edge"
          className="bookprev size-10 text-[18px]"
          disabled={row <= 0}
          onClick={() => walk(-1)}
          aria-label="前のページ"
        >‹</Button>
        <Button
          variant="edge"
          className="booknext size-10 text-[18px]"
          disabled={row >= rows - 1}
          onClick={() => walk(1)}
          aria-label="次のページ"
        >›</Button>
        <Button
          variant="chip"
          className="bookend disabled:opacity-40"
          disabled={row >= rows - 1}
          onClick={() => jump(rows - 1)}
        >
          最後へ
          <span className="text-[14px] leading-none">»</span>
        </Button>
      </div>

      {/* What goes on the page that was pressed. The same sheet the list
          opens, because it is the same question -- but without the line about
          how much room is left on the paper: that belongs to 刷る, and this
          screen does not talk about paper. */}
      {addAt !== null && (
        <AddSection
          job={null} print={print}
          positioned
          // The front page is the only place a cover goes, and there is
          // nowhere for a second one.
          cover={!hasCover && addAt === 0}
          onPick={kind => { const where = addAt; setAddAt(null); onAddAt(where, kind); }}
          onClose={() => setAddAt(null)}
        />
      )}
    </div>
  );
}

function CanvasScreen({
  book, at, nth, setBook, onList, onFlip, backTo, onBack, goTo, print, setPrint, openOn, onImport,
}: {
  onImport: () => void;
  book: Book; at: number; setBook: (fn: (b: Book) => Book) => void;
  // Which sheet of that section the book is turned to.
  nth: number;
  // Opening the list of pages, which is a door forward, not a way back.
  onList: () => void;
  // Turning through the book as a book: the other of the two ways of looking
  // at what has been made, and the one that has nothing to do with paper.
  onFlip: () => void;
  // Where this screen was opened from, or nothing when it is where the app
  // started. The way back wears that place's own picture, so nothing has to
  // be written to say where it goes.
  backTo: 'sides' | 'contents' | 'book' | null;
  onBack: () => void;
  // Editing a different section of the same book, at one of its sheets:
  // turning the page and adding one both land here.
  goTo: (i: number, nth?: number) => void;
  // The paper belongs to the book, so it is held above this screen.
  print: PrintOptions;
  setPrint: (fn: (p: PrintOptions) => PrintOptions) => void;
  // Changes when the contents asked to edit something in particular.
  openOn: { key: number; what: 'range' | 'part0' };
}) {
  // The section being edited. Everything below this line is written against
  // one refill, exactly as it was before books existed.
  // A one-page section on the back of a sheet (the last page of a book of
  // spreads) is drawn with its holes on the right, as it will be printed.
  // Worked out here, from where it sits, never trusted from what was saved:
  // moving a section moves which side of the paper it is on.
  const backSide = useMemo(() => backSideOf(book.sections, at, nth, print.duplex), [book.sections, at, nth, print.duplex]);
  const layout = useMemo(
    () => ({ ...book.sections[at], onBack: backSide }),
    [book.sections, at, backSide],
  );
  const setLayout = (fn: (l: Layout) => Layout) => setBook(b => ({
    ...b,
    sections: b.sections.map((sec, i) => (i === at ? fn(sec) : sec)),
  }));
  const size = SIZES[layout.size];
  const geo = useMemo(() => buildGeometry(layout, size), [layout, size]);
  // What is drawn is the page the book is turned to -- October's sheet shows
  // October. What is edited is still the section: the dates are the only
  // difference between one of its sheets and the next.
  const shown = useMemo(() => sheetAt(layout, nth), [layout, nth]);
  const pages = useMemo(() => buildPages(shown, size), [shown, size]);

  // Every sheet of the book in order, which is what turning the page walks.
  // A sheet is what can be edited: a spread is one sheet with two pages on it.
  const leaves = useMemo(
    () => book.sections.flatMap((sec, i) =>
      Array.from({ length: sheetCount(sec) }, (_, k) => ({ at: i, nth: k }))),
    [book.sections],
  );
  const cursor = leaves.findIndex(l => l.at === at && l.nth === nth);
  // Which way the last turn went. The paper comes in from the side it was
  // turned from, so the press and the movement agree -- arriving from the
  // wrong side reads as a different page rather than as the next one.
  const cameFrom = useRef(cursor);
  const turnedIn = cursor === cameFrom.current ? '' : cursor > cameFrom.current ? 'turn-next' : 'turn-prev';
  useLayoutEffect(() => { cameFrom.current = cursor; });
  // Where this sheet falls in the book, said in pages, which is how anyone
  // holding a planner counts.
  const paging = useMemo(() => {
    const all = pagesOf(book.sections);
    const first = all.findIndex(l => l.at === at && l.nth === nth);
    if (first < 0) return null;
    let last = first;
    while (all[last + 1] && all[last + 1].at === at && all[last + 1].nth === nth) last++;
    return { from: first + 1, to: last + 1, of: all.length };
  }, [book.sections, at, nth]);

  const [traySelected, setTraySelected] = useState<PartKind[]>([]);
  // On a phone the tools are one sheet under the paper with two faces -- the
  // parts, and this paper's settings -- and it can be pulled down to its tabs
  // so the paper has the screen. It does not pull itself down when a part is
  // chosen: several are chosen one tap at a time and put down together.
  const [dock, setDock] = useState<'parts' | 'paper'>('parts');
  const [dockShut, setDockShut] = useState(false);
  // The tray is what this page can take. A cover is one page, so nothing that
  // runs on dates belongs in it -- and offering a part only to refuse it after
  // the drag is worse than not offering it: turning the pages is meant to be
  // something you do without stopping.
  const trayParts = layout.imported ? [] : layout.cover || layout.backCover ? TRAY.filter(t => !isDatedKind(t.kind)) : TRAY;
  const [sheet, setSheet] = useState<SheetTarget>(null);
  const [toast, setToast] = useState<ReactNode>('');
  const [ghost, setGhost] = useState<{ x: number; y: number; kinds: PartKind[] } | null>(null);
  // Which sides of the tray still have stamps out of sight.
  const trayRef = useRef<HTMLDivElement | null>(null);
  const [trayEdge, setTrayEdge] = useState({ left: false, right: false });
  const readTrayEdges = () => {
    const el = trayRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const next = { left: el.scrollLeft > 2, right: el.scrollLeft < max - 2 };
    // Returning the same object when nothing changed lets React bail out,
    // which is what makes it safe to call this from a ref callback -- that
    // runs on every render, and a fresh object every time would loop.
    setTrayEdge(prev => (prev.left === next.left && prev.right === next.right ? prev : next));
  };
  // Three stamps a press: enough to feel like progress, few enough that you
  // do not lose your place in a row of twelve.
  const nudgeTray = (dir: number) =>
    trayRef.current?.scrollBy({ left: dir * 63 * 3, behavior: 'smooth' });
  // Where the part being dragged would land. Two arrangements are possible
  // from the same drop -- beside the calendar or under it -- so the sheet has
  // to say which one the finger is currently asking for.
  const [preview, setPreview] = useState<Box[] | null>(null);
  // Where the last part landed. A quarter of a spread changing from empty to
  // ruled is a change you have to hunt for, especially when the drop was a tap
  // and the eye was on the tray. This is where to look.
  const [landedOn, setLandedOn] = useState<Box[] | null>(null);
  useLayoutEffect(() => {
    if (!landedOn) return;
    const t = window.setTimeout(() => setLandedOn(null), 520);
    return () => window.clearTimeout(t);
  }, [landedOn]);
  // Taking a part out reflows every other part on the sheet, so nothing is
  // removed without a plain question first.
  const [confirm, setConfirm] = useState<{ what: string; run: () => void } | null>(null);
  const askRemove = (what: string, run: () => void) => { setSheet(null); setConfirm({ what, run }); };
  // Dragging a border is the app's one irreplaceable gesture, so the handles
  // keep asking for it until it has been used once.
  // Looking at the design big. A plain tap on the paper is already taken --
  // it places what the tray has selected, and it opens a part's settings --
  // so this is a button of its own rather than a gesture competing with those.
  const [zoomed, setZoomed] = useState(false);
  // The paper the whole book will be printed on, worked out here rather than
  // in the export screen: how much of the sheet the book leaves empty is
  // something to know while designing it, not after pressing 書き出す.
  const job = usePaperJob(book.sections, size, print);
  const wide = useWide();
  const [taught, setTaught] = useState(() => {
    try { return localStorage.getItem(TAUGHT_KEY) === '1'; } catch { return false; }
  });

  const dragRef = useRef<DragState | null>(null);
  const dividerRef = useRef<{ d: Divider; startX: number; startY: number; extentPx: number } | null>(null);
  const setRef = useRef<HTMLDivElement>(null);
  // Set when a tap has just placed something, so the click behind that tap
  // does not also open what it placed.
  const tapPlaced = useRef(false);
  const toastTimer = useRef<number>();

  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 320, h: 360 });
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    // The room the sheets get is inside the padding, not including it.
    // `clientWidth` counts the padding, which let a spread wider than it is
    // tall run off both edges of the screen -- invisible until a size wider
    // than it is tall existed.
    const measure = () => {
      const pad = getComputedStyle(el);
      setBox({
        w: el.clientWidth - parseFloat(pad.paddingLeft) - parseFloat(pad.paddingRight),
        h: el.clientHeight - parseFloat(pad.paddingTop) - parseFloat(pad.paddingBottom),
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const first = geo.pages[0];
  const n = geo.pages.length;
  // A spread's gap is the binder between two sheets. A fold has no gap to
  // draw: it is one sheet that bends, so the panels butt up and the creases
  // are marked on top of them.
  const foldNow = foldOf(layout, size);
  const folded = !!foldNow;
  const gap = folded ? 0 : GAP;
  const gapPx = (n - 1) * gap;
  // A fold's panels are not all the same width -- only the punched one is a
  // whole page -- so the row is measured by what the pages actually add up to
  // rather than by one of them times the count.
  const along = (mm: (p: PageGeometry) => number) => geo.pages.reduce((t, p) => t + mm(p), 0);
  const acrossMm = geo.flow === 'row' ? along(p => p.widthMm) : first.widthMm;
  const downMm = geo.flow === 'column' ? along(p => p.heightMm) : first.heightMm;
  const scale = Math.max(0.1, Math.min(
    (box.w - (geo.flow === 'row' ? gapPx : 0)) / acrossMm,
    (box.h - (geo.flow === 'column' ? gapPx : 0)) / downMm,
  ));
  const pageW = (i: number) => geo.pages[i].widthMm * scale;
  const pageH = (i: number) => geo.pages[i].heightMm * scale;
  const pageOrigin = (i: number) => {
    let at = 0;
    for (let j = 0; j < i; j++) at += (geo.flow === 'row' ? pageW(j) : pageH(j)) + gap;
    return geo.flow === 'row' ? { x: at, y: 0 } : { x: 0, y: at };
  };

  // A message, and how long it stands. Anything with something to press in
  // it needs longer than something to read.
  // Turning to the cover puts down whatever the tray was holding that cannot
  // go on it: a tap on the paper must never place something the tray on that
  // page does not even show.
  useLayoutEffect(() => {
    if (layout.cover || layout.backCover) setTraySelected(sel => (sel.some(isDatedKind) ? sel.filter(k => !isDatedKind(k)) : sel));
  }, [layout.cover, layout.backCover]);

  const say = (text: ReactNode, ms = 1800) => {
    setToast(text);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), ms);
  };

  // The ＋ at the paper's edge puts a page in, here, and turns to it. It
  // used to open a menu of parts first, and the menu was a second way of
  // doing what the tray on this very screen already does: picking マンスリー
  // there and dropping マンスリー here make the same section. So the ＋ now
  // answers the question it asks -- a blank page appears where the ＋ was --
  // and what goes on it is placed the one way this app places anything.
  //
  // The front page is a cover: a single page even in a book of spreads,
  // because the spread was leaving page 1 blank anyway and a cover is the
  // outside of the stack, not a pair of facing pages. Further in, a page
  // matches the book, or it would break the pairing of every spread after it.
  // How many pages the ＋ puts in: a cover is one page whatever the book is,
  // and anywhere else it is a sheet of this book -- which is two pages when
  // the book is spreads and one when it is not.
  const goesIn = at === 0 ? 1 : geo.pages.length;

  // A cover, from the rail. It always goes on the front: the front is the
  // only place a cover is.
  const addCover = () => {
    const where = 0;
    const front = true;
    const was = book.sections;
    const back = () => { setBook(b => ({ ...b, sections: was })); goTo(at, nth); setToast(''); };
    // Put in, never instead of. `withSection` drops an empty starting section,
    // which is right when something is added from the contents (a stub nobody
    // ever opened) and wrong here, because that empty section is the page on
    // screen: pressing 「前に足す」 on a fresh book of spreads used to delete the
    // spread and leave a one-page cover with nowhere to turn to.
    const made = sectionOf(front ? 'cover' : 'blank', layout);
    setBook(b => ({ ...b, sections: [...b.sections.slice(0, where), made, ...b.sections.slice(where)] }));
    goTo(where, 0);
    say(
      <>
        {front ? '表紙になる白紙を入れました' : '白紙を入れました'}
        <button className="undoadd ml-2 underline underline-offset-2" onClick={back}>取り消す</button>
      </>,
      5000,
    );
  };

  // The back cover, the way the cover goes in: a blank page appears where the
  // ＋ was and the editor is on it. Not a menu of note sections -- the back
  // of a planner is a page to make, like the front.
  const addBackCover = () => {
    const was = book.sections;
    const where = was.length;
    const undo = () => { setBook(b => ({ ...b, sections: was })); goTo(at, nth); setToast(''); };
    const made = sectionOf('backcover', bodyOf(book));
    setBook(b => ({ ...b, sections: [...b.sections, made] }));
    goTo(where, 0);
    say(
      <>
        裏表紙になる白紙を入れました
        <button className="undoadd ml-2 underline underline-offset-2" onClick={undo}>取り消す</button>
      </>,
      5000,
    );
  };

  // Client point → surface millimetres, or null when the point is off the
  // pages or on a page the calendar has filled.
  const toSurface = (cx: number, cy: number): DropPoint | null => {
    const el = setRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const lx = cx - r.left, ly = cy - r.top;
    for (let i = 0; i < geo.pages.length; i++) {
      const o = pageOrigin(i);
      if (lx < o.x || lx > o.x + pageW(i) || ly < o.y || ly > o.y + pageH(i)) continue;
      const span = geo.pages[i].spanRect;
      // How far down the calendar the pointer landed, when it landed on it at
      // all. Dropping on the calendar is how you ask for a place beside it,
      // so the gesture has to survive the trip to the layout.
      const inBand = span && span.h > 0
        ? ((ly - o.y) / scale - span.y) / span.h
        : null;
      const band = inBand !== null && inBand >= 0 && inBand <= 1 ? inBand : undefined;
      const s = geo.surface.slices.find(sl => sl.key === geo.pages[i].key);
      if (s) {
        return {
          sx: (lx - o.x) / scale - s.ox + s.fromMm,
          sy: (ly - o.y) / scale - s.oy,
          band,
        };
      }
      // No slice at all means the calendar has taken this whole sheet, so
      // there is no surface to measure against; the page itself is the
      // position.
      if (!span) return null;
      return { sx: span.w * i + (lx - o.x) / scale - span.x, sy: -1, band };
    }
    return null;
  };

  const overPages = (cx: number, cy: number): boolean => {
    const el = setRef.current;
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
  };

  // Where a part goes when the cover cannot take it: the page after the cover,
  // which is the empty one already sitting there, or a new one if it is not
  // empty. The cover stays -- nothing the reader made disappears -- and the
  // book turns to where the part landed, so the answer is on the paper.
  const putOnNextPage = (kinds: PartKind[]) => {
    const nextAt = at + 1;
    const was = book.sections;
    const base = book.sections.find(l => !l.cover) ?? layout;
    setToast('');
    setBook(b => {
      const here = b.sections[nextAt];
      const onto = here && isPlaceholder(here) ? here : sectionOf('blank', base);
      const planned = planPlacement(onto, size, kinds, null);
      const made = planned ? planned.layout : onto;
      return {
        ...b,
        sections: here && isPlaceholder(here)
          ? b.sections.map((sec, i) => (i === nextAt ? made : sec))
          : [...b.sections.slice(0, nextAt), made, ...b.sections.slice(nextAt)],
      };
    });
    goTo(nextAt, 0);
    say(
      <>
        次のページに入れました
        <button
          className="undoadd ml-2 underline underline-offset-2"
          onClick={() => { setBook(b => ({ ...b, sections: was })); goTo(at, 0); setToast(''); }}
        >取り消す</button>
      </>,
      5000,
    );
  };

  const placeParts = (kinds: PartKind[], at: DropPoint | null) => {
    // A cover is one page in a book of spreads, so a calendar laid on it would
    // print as a single-page run -- twelve months of it, in a form the rest of
    // the book is not. It is refused rather than quietly turned into an
    // ordinary spread, because a cover disappearing under your hands is harder
    // to understand than being told no -- but being told no and left holding
    // the part, with homework about some other screen, is worse than either.
    // So the way on is in the message: one press and the part is on the page
    // that can hold it.
    const dated = kinds.find(isDatedKind);
    if (layout.cover && dated) {
      say(
        <span className="dateoncover whitespace-normal">
          表紙は1ページです
          <button
            className="tonext ml-2 underline underline-offset-2"
            onClick={() => putOnNextPage(kinds)}
          >次のページに入れる</button>
        </span>,
        6000,
      );
      return;
    }
    setLayout(prev => {
      const planned = planPlacement(prev, size, kinds, at);
      if (!planned) {
        const what = kinds.length === 1 ? PART_LABEL[kinds[0]] : 'パーツ';
        // A fold has no draggable borders to make room with: the creases are
        // where the paper bends. Either a panel is free or it is not.
        const folded = foldOf(prev, size);
        say(folded && prev.surface.placed.length >= foldMaxParts(folded.panels)
          ? `1ページに2つまでです。外してから置いてください`
          : `${what}を置く広さがありません。仕切りを動かして空けてください`);
        return prev;
      }
      if (planned.overflow > 0) say(`一度に置けるのは${MAX_PARTS}つまでです`);
      // A photo is the one part that does nothing until a picture is chosen,
      // so the place to choose one comes to you rather than waiting to be
      // found. Only when a single photo was dropped: opening a sheet over a
      // handful of parts someone just laid out would be in the way.
      if (kinds.length === 1 && kinds[0] === 'photo') {
        const { placed, photos } = planned.layout.surface;
        for (let i = placed.length - 1; i >= 0; i--) {
          if (placed[i] === 'photo' && !photos?.[i]) { setSheet({ slot: i }); break; }
        }
      }
      if (planned.landed !== null) {
        setLandedOn(regionBoxes(buildGeometry(planned.layout, size), planned.landed));
      }
      // The drop is what decides the pacing: a weekly landing on a monthly's
      // sheet turns twelve sheets into fifty-three. Only on the change, so a
      // second weekly -- or any later edit -- leaves the period alone.
      return isDayPaced(prev) ? planned.layout : pacedFor(planned.layout);
    });
  };

  const swapParts = (a: number, b: number) => {
    if (a === b) return;
    setLayout(prev => {
      const placed = [...prev.surface.placed];
      [placed[a], placed[b]] = [placed[b], placed[a]];
      // The picture belongs to the stamp, not to the slot: swapping the two
      // has to carry it along or the photo stays behind on the other part.
      const photos = photosOf(prev.surface);
      [photos[a], photos[b]] = [photos[b], photos[a]];
      const runs = eachOf(prev.surface);
      [runs[a], runs[b]] = [runs[b], runs[a]];
      return { ...prev, surface: { ...prev.surface, placed, photos, photoEach: someEach(runs) } };
    });
  };

  const removePart = (slot: number) => {
    setLayout(prev => {
      const folded = foldOf(prev, size);
      if (folded) {
        return { ...prev, surface: removeFromFold(prev.surface, folded.panels, slot) };
      }
      const placed = prev.surface.placed.filter((_, i) => i !== slot);
      const photos = photosOf(prev.surface).filter((_, i) => i !== slot);
      const photoEach = someEach(eachOf(prev.surface).filter((_, i) => i !== slot));
      return {
        ...prev,
        // With nothing left beside it the calendar takes the page back, rather
        // than holding on to space it was only sharing.
        spanning: prev.spanning && placed.length === 0
          ? { ...prev.spanning, ratio: 1 }
          : prev.spanning,
        // An empty spread is a whole spread again: the page a part was held
        // to goes with the part, or the next thing dropped in the middle
        // would still come out on one side.
        surface: {
          ...prev.surface, placed, photos, photoEach, ratios: {},
          page: placed.length === 0 ? undefined : prev.surface.page,
        },
      };
    });
    setSheet(null);
  };

  // A finger is not captured here, a mouse is.
  //
  // Capturing a touch pointer takes the gesture off the browser before it
  // knows what the gesture is, and the tray is a horizontal scroller: with
  // every stamp holding a captured pointer there was nothing left to swipe,
  // so the tray could not be scrolled at all. A touch pointer does not need
  // it -- the spec captures it to the element that received the down by
  // itself -- so leaving it alone costs nothing and lets `touch-action:
  // pan-x` do its job. A mouse has no such implicit capture, and without one
  // the moves go to whatever is under the cursor the moment it leaves the
  // stamp, which for anything but a slow short drag is not the stamp.
  const startDrag = (e: React.PointerEvent, kinds: PartKind[], fromSlot: number | null) => {
    if (e.pointerType !== 'touch') (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { kinds, fromSlot, moved: false, startX: e.clientX, startY: e.clientY };
  };

  // The browser took the gesture -- a sideways swipe panning the tray. The
  // part was never picked up.
  const cancelDrag = () => {
    dragRef.current = null;
    setGhost(null);
    setPreview(null);
  };
  const moveDrag = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (!d.moved && Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) < 8) return;
    // `touch-action: pan-x` already tells the browser that up and down belong
    // to us, but Safari can still decide mid-gesture that it wants the touch
    // and fire pointercancel, which drops the part. Saying so again once the
    // drag is real costs nothing where it was never in doubt.
    if (e.cancelable) e.preventDefault();
    d.moved = true;
    setGhost({ x: e.clientX, y: e.clientY, kinds: d.kinds });
    // Only a single part coming from the tray has a landing place to show:
    // dragging a part already on the sheet swaps two of them, and several at
    // once are arranged automatically wherever they fit.
    if (d.fromSlot !== null || d.kinds.length !== 1) return;
    const at = toSurface(e.clientX, e.clientY);
    const planned = at && overPages(e.clientX, e.clientY)
      ? planPlacement(layout, size, d.kinds, at)
      : null;
    setPreview(planned && planned.landed !== null
      ? regionBoxes(buildGeometry(planned.layout, size), planned.landed)
      : null);
  };
  const endTrayDrag = (e: React.PointerEvent, kind: PartKind) => {
    const d = dragRef.current;
    dragRef.current = null;
    setGhost(null);
    setPreview(null);
    if (!d) return;
    if (!d.moved) {
      setTraySelected(prev => prev.includes(kind) ? prev.filter(k => k !== kind) : [...prev, kind]);
      return;
    }
    if (!overPages(e.clientX, e.clientY)) return;
    // Dropping several at once is an automatic arrangement, so the landing
    // point only steers a single part.
    placeParts(d.kinds, d.kinds.length === 1 ? toSurface(e.clientX, e.clientY) : null);
    setTraySelected([]);
  };
  const endPartDrag = (e: React.PointerEvent, slot: number) => {
    const d = dragRef.current;
    dragRef.current = null;
    setGhost(null);
    setPreview(null);
    if (!d) return;
    if (!d.moved) { setSheet({ slot }); return; }
    const at = toSurface(e.clientX, e.clientY);
    if (!at) return;
    const target = regionAt(geo.surface.regions, at.sx, at.sy);
    if (target !== null) swapParts(slot, target);
  };

  const startDivider = (e: React.PointerEvent, d: Divider) => {
    // Same rule as the tray: a mouse has to be captured or its moves go to
    // whatever is under the cursor; a finger already has the capture and
    // taking it again is what stopped a stamp being dragged out of the tray.
    // This one was left capturing both, and a border that will not move under
    // a finger looks exactly like a border that is not draggable.
    if (e.pointerType !== 'touch') (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (!taught) {
      setTaught(true);
      try { localStorage.setItem(TAUGHT_KEY, '1'); } catch { /* private mode */ }
    }
    dividerRef.current = { d, startX: e.clientX, startY: e.clientY, extentPx: d.extentMm * scale };
  };
  const moveDivider = (e: React.PointerEvent) => {
    const drag = dividerRef.current;
    if (!drag) return;
    const { d, extentPx } = drag;
    const delta = d.axis === 'h' ? e.clientY - drag.startY : e.clientX - drag.startX;
    const next = Math.min(MAX_RATIO, Math.max(MIN_RATIO, d.ratio + delta / extentPx));
    setLayout(prev => {
      if (d.key === 'span') {
        return { ...prev, spanning: prev.spanning ? { ...prev.spanning, ratio: next } : null };
      }
      // A fold keeps one set of ratios per group, because each group divides
      // its own panels and knows nothing about the others.
      if (d.group !== undefined && prev.surface.fold) {
        return {
          ...prev,
          surface: {
            ...prev.surface,
            fold: prev.surface.fold.map((g, i) => (
              i === d.group ? { ...g, ratios: { ...g.ratios, [d.key]: next } } : g
            )),
          },
        };
      }
      return { ...prev, surface: { ...prev.surface, ratios: { ...prev.surface.ratios, [d.key]: next } } };
    });
  };
  const endDivider = () => { dividerRef.current = null; };

  const onExport = async (opts: PrintOptions) => {
    // The whole book, in the order it is bound: section by section, each
    // bringing its own front-and-back chain.
    const [first, ...rest] = book.sections;
    const sheets = buildPrintSheets(first, size, opts, rest);
    downloadPdf(await sheetsToPdf(sheets, book.name), `${book.name || 'refill'}.pdf`);
    setSheet(null);
    say(opts.impose
      ? `${PAPERS[opts.paper].label} ${sheets.length}枚を書き出しました`
      : `${sheets.length}枚を書き出しました`);
  };

  // A region crossing the gutter shows up on both pages, so one region can be
  // more than one box on screen.
  const regionBoxes = (g: Geometry, slot: number): Box[] => {
    const out: Box[] = [];
    const region = g.surface.regions[slot];
    if (!region) return out;
    g.surface.slices.forEach(sl => {
      const i = g.pages.findIndex(pg => pg.key === sl.key);
      const o = pageOrigin(i);
      const lo = Math.max(region.x, sl.fromMm), hi = Math.min(region.x + region.w, sl.toMm);
      if (hi <= lo) return;
      out.push({
        key: `${slot}-${sl.key}`,
        left: o.x + (lo - sl.fromMm + sl.ox) * scale,
        top: o.y + (region.y + sl.oy) * scale,
        width: (hi - lo) * scale,
        height: region.h * scale,
      });
    });
    return out;
  };

  // Hit areas and borders are drawn over the sheets rather than inside them, so
  // a border sitting on the gutter stays grabbable from both sides.
  const partBoxes: { key: string; slot: number; left: number; top: number; width: number; height: number }[] = [];
  const dividerBoxes: { key: string; d: Divider; left: number; top: number; width: number; height: number }[] = [];

  geo.surface.slices.forEach(s => {
    const i = geo.pages.findIndex(p => p.key === s.key);
    const o = pageOrigin(i);
    const toX = (sx: number) => o.x + (sx - s.fromMm + s.ox) * scale;
    const toY = (sy: number) => o.y + (sy + s.oy) * scale;

    geo.surface.regions.forEach((r, slot) => {
      const lo = Math.max(r.x, s.fromMm), hi = Math.min(r.x + r.w, s.toMm);
      if (hi <= lo) return;
      partBoxes.push({
        key: `${slot}-${s.key}`, slot,
        left: toX(lo), top: toY(r.y), width: (hi - lo) * scale, height: r.h * scale,
      });
    });

    geo.surface.dividers.forEach(d => {
      if (d.axis === 'h') {
        const lo = Math.max(d.x, s.fromMm), hi = Math.min(d.x + d.length, s.toMm);
        if (hi <= lo) return;
        dividerBoxes.push({ key: `${d.id}-${s.key}`, d, left: toX(lo), top: toY(d.y) - 11, width: (hi - lo) * scale, height: 22 });
      } else if (d.x >= s.fromMm && d.x <= s.toMm) {
        dividerBoxes.push({ key: `${d.id}-${s.key}`, d, left: toX(d.x) - 11, top: toY(d.y), width: 22, height: d.length * scale });
      }
    });
  });

  geo.pages.forEach((pg, i) => {
    if (!pg.spanDivider) return;
    const o = pageOrigin(i);
    const d = pg.spanDivider;
    dividerBoxes.push({ key: d.id, d, left: o.x + d.x * scale, top: o.y + d.y * scale - 11, width: d.length * scale, height: 22 });
  });

  const empty = layout.surface.placed.length === 0 && !layout.spanning && !layout.imported;

  const dated = hasDatedPart(layout);
  const lastMonth = runEnd(layout);
  // A refill paced by days is not described by months: the first sheet of a
  // weekly starts on the week holding the first of the month, which is
  // usually the month before the one that was set.
  const byDay = isDayPaced(layout);
  const [firstDay, lastDay] = runDates(layout);
  // The button that shows the date range opens whatever part owns the dates.
  // A weekly refill may have no calendar on it at all, and a refill of day
  // lists none either, and their range still has to be reachable.
  const datedSlot = datedSlotOf(layout);
  const monthlyTarget: SheetTarget = layout.spanning ? 'spanning' : { slot: datedSlot };
  // Arrived from the contents with something in mind: the period of this
  // section, or the part that is not finished yet (a cover with no picture).
  useLayoutEffect(() => {
    if (openOn.key === 0) return;
    if (openOn.what === 'part0') setSheet({ slot: 0 });
    else if (layout.spanning || datedSlot >= 0) setSheet(monthlyTarget);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openOn.key]);

  // One button per removable thing, at the outer top corner of the whole
  // block. A part straddling the gutter is still one part, and its button
  // belongs at the edge of the spread rather than in the middle of it.
  const clears: {
    key: string; label: string; left: number; top: number;
    run: () => void;
  }[] = [];

  // Turning the refill is a property of the paper, so it works on a blank
  // sheet and on one with only a memo. A calendar follows along: an upright
  // spread splits the weekdays, a turned one splits the weeks.
  // What turning does depends on the sheet, not on the flag: a size that is
  // wider than it is tall starts out "landscape" already, and a square one
  // only moves its rings.
  // Taken from the page the editor is actually drawing, not from the size: a
  // folded strip is a different shape from the sheet it folds down to, and the
  // button has to name the turn the user is about to see.
  const onScreenW = geo.pages[0].widthMm;
  const onScreenH = geo.pages[0].heightMm;
  const turnLabel = onScreenW === onScreenH
    ? (ringsOnTop(layout) ? 'リングを左にする' : 'リングを上にする')
    : onScreenW > onScreenH ? '縦にする' : '横にする';

  const turn = () => setLayout(l => {
    const orientation = l.orientation === 'landscape' ? 'portrait' : 'landscape';
    return {
      ...l,
      orientation,
      // The two ways of splitting leave different amounts of room, so the
      // calendar's band resets to what this one would have taken.
      spanning: l.spanning
        ? {
            ...l.spanning,
            ratio: l.surface.placed.length === 0 ? 1 : (orientation === 'landscape' ? 0.48 : 0.72),
          }
        : null,
    };
  });

  const spanCorners = geo.pages.flatMap((pg, i) => {
    if (!pg.spanRect) return [];
    const o = pageOrigin(i);
    return [{ right: o.x + (pg.spanRect.x + pg.spanRect.w) * scale, top: o.y + pg.spanRect.y * scale }];
  });
  if (spanCorners.length) {
    const c = spanCorners.reduce((a, b) => (b.right > a.right ? b : a));
    clears.push({
      key: 'span', label: 'マンスリー', left: c.right - CLEAR_INSET, top: c.top + 3,
      run: () => setLayout(l => ({ ...l, spanning: null })),
    });
  }

  layout.surface.placed.forEach((kind, slot) => {
    const boxes = partBoxes.filter(b => b.slot === slot);
    if (boxes.length === 0) return;
    const b = boxes.reduce((a, x) => (x.left + x.width > a.left + a.width ? x : a));
    clears.push({
      key: `p${slot}`, label: PART_LABEL[kind],
      left: b.left + b.width - CLEAR_INSET, top: b.top + 3,
      run: () => removePart(slot),
    });
  });
  const teachDivider = !taught && dividerBoxes.length > 0;
  // Nothing anywhere in the book yet -- the only moment the app still has to
  // say how things are placed.
  const nothingPlaced = book.sections.every(l => !l.spanning && l.surface.placed.length === 0 && !l.imported);

  // The next-month calendar is part of the monthly rather than a part of its
  // own, so it gets a clear button on the sheet instead of a tray entry.
  const leftSpan = geo.pages.find(p => p.key === 'left')?.spanRect;
  const miniCell = layout.showNextMonth && leftSpan ? nextMonthCell(leftSpan, layout) : null;

  // Built once and placed in one of two spots: beside the paper on a desktop,
  // over it on a phone. Two copies of the call would be two lists of props to
  // keep in step.
  const sheetEl = sheet && (
    <PartSheet
      target={sheet}
      nth={nth}
      book={book}
      setBook={setBook}
      layout={layout}
      setLayout={setLayout}
      inline={wide}
      onClose={() => setSheet(null)}
      onRemove={slot => askRemove(PART_LABEL[layout.surface.placed[slot]], () => removePart(slot))}
      onRemoveSpanning={() => askRemove('マンスリー', () => setLayout(l => ({ ...l, spanning: null })))}
      onLoad={b => { setBook(() => b); setSheet(null); say('読み込みました'); }}
      onSave={name => {
        const named = { ...book, name };
        setBook(() => named);
        setSheet(null);
        say(saveBook(named)
          ? `「${name}」を保存しました`
          : '保存できませんでした。背景の画像が大きいか、保存先がいっぱいです');
      }}
      size={size}
      onExport={onExport}
      print={print}
      setPrint={setPrint}
      // A section goes on the end of the book, which is where the empty
      // places are. Nothing is saved or named on the way: the book is one
      // thing and it is saved as one thing.
      onImport={() => { setSheet(null); onImport(); }}
      onAddSection={kind => {
        // Copied from the book's form, not from the page you happen to be
        // standing on: standing on the cover, that was 片面.
        const made = sectionOf(kind, bodyOf(book));
        const front = kind === 'cover';
        setBook(b => ({ ...b, sections: withSection(b.sections, made, front) }));
        // A cover is not finished until it has a picture on it, and a blank
        // section is not finished at all, so both open on what is missing.
        setSheet(null);
        if (kind === 'cover' || kind === 'blank') goTo(kind === 'cover' ? 0 : book.sections.length);
        say(`${SECTION_LABEL(kind)}を足しました`);
      }}
      say={say}
    />
  );

  // Above the paper on a phone, where the paper is the whole screen and the
  // book's order is read before the page. On a wide screen the paper has the
  // window's height to itself and the tools stand beside it, so the order of
  // the book stands there too, at the top of the column.
  // Which face of the phone's sheet is showing, if it is open at all. On a
  // wide screen everything is showing: the column has the room.
  const partsShown = wide || (dock === 'parts' && !dockShut);
  const paperShown = wide || (dock === 'paper' && !dockShut);
  const railEl = (
    <BindingRail
          sections={book.sections}
          at={at}
          size={size}
          print={print}
          job={job}
          onGo={i => goTo(i, 0)}
          onAddCover={addCover}
          onFillBack={addBackCover}
          onList={onList}
          onPaper={() => setSheet('paper')}
          compact={!wide}
        />
  );

  // On a phone these sit over and under the paper. Beside a desk-width
  // paper they stand at the top of the tools instead: a single page is
  // tall and narrow, so the height they took was the one thing it was
  // short of, while the width either side of it went unused.
  const headerEl = (
    <header className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-3 text-[13px] font-semibold text-label">
      {/* The way back, and only when there is one: the editor is the
          workshop, so it has no exit of its own. What it wears is the
          picture of the place it would return to -- the pages laid out in
          rows, or the sheet the form was chosen on -- which is why no word
          is needed to say where it goes. 「← 中身」 was that word. */}
      {backTo && (
        <Button
          variant="chip"
          className={`goback ${backTo === 'contents' ? 'tolist' : backTo === 'book' ? 'tobook' : 'toform'}`}
          onClick={onBack}
          aria-label={backTo === 'contents' ? '並びへもどる'
            : backTo === 'book' ? 'めくって見るへもどる' : '構成へもどる'}
        >
          <span className="text-[14px] leading-none">←</span>
          {backTo === 'contents'
            ? <ListGlyph />
            : backTo === 'book'
              ? <BookGlyph />
              : <SizeIcon size={size} color={SIZE_COLOR[layout.size]} scale={0.1} />}
        </Button>
      )}
      {/* The paper itself, pressable. It used to be a line of text saying
          what had been chosen three screens ago, and the way back to change
          it was a button on another screen labelled 「サイズを選び直す」 --
          a sentence explaining a door. The paper IS the door: press it and
          the sizes and the forms are there, and what you pick redraws the
          sheet behind the chip. */}
      <Button
        variant="chip"
        className="papernow min-w-0"
        // The chip variant never shrinks; this one has to, or on the cover
        // (「表紙（1ページ）」) it pushed 大きく off the screen. The words give
        // way, the ▾ does not: it is what says the chip opens something.
        style={{ flexShrink: 1 }}
        onClick={() => setSheet('sheet')}
      >
        <span className="min-w-0 truncate">
        {/* Which page of the book, and which section it came from -- with
            one section and one sheet there is no book to be lost in, and
            the form the refill is folded into is what a phone has room to
            say instead. */}
        {book.sections.length > 1 && !layout.cover && !layout.backCover && (
          <>{sectionLabel(layout)}<span className="mx-1 text-muted">・</span></>
        )}
        {size.label}
        {/* What gives way, in order, as the screen narrows: the millimetres
            first, then the words on the two chips. The form the refill is
            folded into never does -- on a phone it is what the title is
            for, and the picker cannot be consulted afterwards. The chips
            hold on to their words the longest they can, because a button
            nobody recognises is a feature nobody finds. */}
        <span className="hidden min-[400px]:inline"> {size.widthMm}×{size.heightMm}mm</span>
        {/* A cover is one page whatever the book is folded into, so saying
            「片面」 here -- the form of this section, truthfully -- told
            anyone standing on the cover of a book of spreads that their
            book had become single-sided. It says which page it is instead. */}
          {/* A cover is one page whatever the book is folded into, so saying
            「片面」 here -- the form of this section, truthfully -- told
            anyone standing on the cover of a book of spreads that their
            book had become single-sided. It says which page it is instead. */}
        {' ・ '}{layout.cover ? '表紙（1ページ）'
          : layout.backCover ? '裏表紙（1ページ）'
          : layout.single ? '1ページ'
          : formLabel(layout, foldNow?.grain)}
        {/* It opens the sizes and the forms, and says so the way a
            choice does. */}
  </span>
        <span className="ml-1 text-[13px] leading-none text-muted" aria-hidden="true">▾</span>
      </Button>
      {/* Below 360px even these give up their words: what they were pushing
          out of the title is worth more. The icons stay, and so do the
          labels a screen reader reads. */}
      {!wide && (
        <Button variant="ctaSmall" className="ml-auto" onClick={() => setSheet('print')} aria-label="PDF出力プレビュー">
          PDF出力
        </Button>
      )}
      {wide && <>
      <Button variant="chip" className="rotate ml-auto" onClick={turn} aria-label="リフィルを回転">
        <span className="text-[14px] leading-none">↻</span>
        <span className="hidden min-[360px]:inline">{turnLabel}</span>
      </Button>
      <Button variant="chip" className="magnify" onClick={() => setZoomed(true)} aria-label="大きく見る">
        <span className="text-[14px] leading-none">⤢</span>
        {/* The first word to go on a phone: the ▾ on the title made room
            for itself here, because the form in the title never gives way
            and ⤢ reads without its word. */}
        <span className="hidden min-[420px]:inline">大きく</span>
      </Button>
      </>}
    </header>
  );
  const pagerEl = (
    <div className="pager flex shrink-0 items-center justify-center gap-2.5 px-3.5 pt-1">
      {/* The two sides take the same room, so that turning the page stays in
          the middle of the row however wide the word on the right is. */}
      <span className="flex-1" aria-hidden="true" />
      {/* The arrows only exist when there is somewhere to turn to. The
          number is always here, because it is also the door to the pages
          laid out in rows -- a book of one page still has to have one. */}
      {leaves.length > 1 && (
        <Button
          variant="edge"
          className="prevpage size-8 text-[16px]"
          disabled={cursor <= 0}
          onClick={() => goTo(leaves[cursor - 1].at, leaves[cursor - 1].nth)}
          aria-label="前のページ"
        >‹</Button>
      )}
      {paging && (
        <Button variant="chip" className="pageno" onClick={onList} aria-label="並びを見る">
          {paging.from === paging.to ? paging.from : `${paging.from}–${paging.to}`}
          <span className="text-muted">/{paging.of}ページ</span>
        </Button>
      )}
      {leaves.length > 1 && (
        <Button
          variant="edge"
          className="nextpage size-8 text-[16px]"
          disabled={cursor < 0 || cursor >= leaves.length - 1}
          onClick={() => goTo(leaves[cursor + 1].at, leaves[cursor + 1].nth)}
          aria-label="次のページ"
        >›</Button>
      )}
      {/* The other way of looking at what has been made. It belongs in this
          row rather than up in the header: the number beside it opens the
          pages laid out to be rearranged, this opens the book to be turned,
          and those are the two of them. An open book rather than a word --
          the screen it opens is that same picture filling the glass, which
          is also what the way back out of it wears. */}
      <span className="flex flex-1 justify-end">
        <Button variant="chip" className="toflip" onClick={onFlip} aria-label="めくって見る">
          <BookGlyph />
          <span className="hidden min-[400px]:inline">めくる</span>
        </Button>
      </span>
    </div>
  );
  const alsoEl = book.sections.length > 1 && (
      <button
        className="alsonote m-0 shrink-0 px-3.5 pt-1 text-left text-[13px] text-accent-text"
        onClick={onList}
      >
        {book.sections.map(sectionLabel).join(' → ')}
      </button>
  );

  return (
    <div className={CANVAS_SCREEN}>
      {/* The paper's side of a wide screen; the whole screen on a narrow one,
          where the tools below are simply the next rows of the same column. */}
      <div className="flex min-h-0 min-w-0 grow flex-col">
      {/* Turning belongs up here rather than over the paper. A folded strip
          turned a quarter turn fills the drawing area top to bottom, and a
          button floating in its corner sat on the refill itself. */}
      {!wide && headerEl}

      {/* The design filling the glass, to check rather than to edit. Editing
          needs the tray and the borders, which are what make the drawing small
          in the first place; taking them away is the whole point of this. */}
      {zoomed && (
        <ZoomView pages={pages} flow={geo.flow} onClose={() => setZoomed(false)} />
      )}

      {!wide && railEl}

      <div className="relative flex min-h-0 grow items-center justify-center px-3 py-2" ref={boxRef}>
        {/* The book, turned. A planner is something you flip through, so the
            page you are on has the next one to its right and what comes
            before it on its left -- and where a page can be put before this
            one, a ＋ sits exactly there. That is where a cover goes, and it
            is on the paper rather than three screens away. */}
        {/* One ＋, on the left, meaning one thing: a page goes in before
            this one. Two of them at the two edges of the paper were two
            buttons that looked the same and were not, which is worse than no
            button at all. Adding at the end is what the contents is for. */}
        {/* Only the ＋ stays on the paper, because only the ＋ means its
            position: a page goes in HERE, before this one. Turning meant
            nothing by being at the right edge, and a spread binds in the
            middle -- so both outer edges are the refill's own content, and
            a round button sat on the dates. Turning moved under the paper. */}
        <div
          // Keyed on the page, so turning to another one starts the animation
          // over rather than leaving the paper where it was.
          key={`${at}:${nth}`}
          className={`flex items-center justify-center ${turnedIn}`}
          ref={setRef}
          style={{ flexDirection: geo.flow, gap, position: 'relative' }}
          // Tapping the paper places what the tray has selected. Dragging is
          // the better gesture and stays the one the app teaches, but it rides
          // on pointer capture and on the browser not taking the gesture for a
          // scroll, and neither can be guaranteed on every device. A tap has
          // nothing to take.
          //
          // On the pointer going down, not on the click: by the time a click
          // is dispatched the part is already drawn under the finger, and the
          // click carries on into it and opens its settings. Captured, so it
          // lands on the paper rather than on whatever is drawn over it, and
          // the click that follows is swallowed for the same reason.
          onPointerDownCapture={e => {
            if (!traySelected.length) return;
            const at = toSurface(e.clientX, e.clientY);
            if (!at) return;
            e.stopPropagation();
            tapPlaced.current = true;
            placeParts([...traySelected], at);
            setTraySelected([]);
          }}
          onClickCapture={e => {
            if (!tapPlaced.current) return;
            tapPlaced.current = false;
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          {/* Where the paper bends. A fold is one sheet, so this is a line on
              it rather than a gap between two -- which is the difference
              between a fold and a spread, and the picture has to say which
              this is. */}
          {geo.surface.slices[0] && geo.creases.map((at, i) => {
            const s0 = geo.surface.slices[0];
            return geo.foldDown ? (
              <span
                key={`crease-${i}`}
                className="crease pointer-events-none absolute left-0 z-10 w-full border-t border-dashed border-line-strong"
                style={{ top: (s0.oy + at) * scale }}
              />
            ) : (
              <span
                key={`crease-${i}`}
                className="crease pointer-events-none absolute top-0 z-10 h-full border-l border-dashed border-line-strong"
                style={{ left: (s0.ox - s0.fromMm + at) * scale }}
              />
            );
          })}
          {geo.pages.map((pg, i) => (
            <div
              key={pg.key}
              // A cut-back fold is cut out of the paper itself rather than
              // covered by a patch painted the colour of what is behind it.
              // The patch was a hair off the background -- two creams two
              // values apart, meeting in a straight line under the ring band,
              // which reads as a misprint rather than as a cut edge. The
              // shadow has to be a filter to follow the shape: a box-shadow
              // is the shadow of the box, which is not what the paper is.
              className={`page relative shrink-0 touch-none overflow-hidden bg-white ${
                pg.notch ? 'notched' : folded
                  ? 'shadow-[0_10px_30px_rgba(38,36,31,0.10)]'
                  : 'rounded-sm shadow-[0_10px_30px_rgba(38,36,31,0.16)]'
              }`}
              style={{
                width: pageW(i), height: pageH(i),
                clipPath: notchClip(pg),
                filter: pg.notch ? 'drop-shadow(0 6px 14px rgba(38,36,31,0.14))' : undefined,
              }}
            >
              <PageSvg page={pages[i]} scale={scale} showGuides />
              {pg.spanRect && (
                <button
                  className="hitbox absolute cursor-pointer p-0 hover:bg-[color-mix(in_srgb,var(--color-mark)_6%,transparent)]"
                  onClick={() => setSheet('spanning')}
                  style={{
                    left: pg.spanRect.x * scale, top: pg.spanRect.y * scale,
                    width: pg.spanRect.w * scale, height: pg.spanRect.h * scale,
                  }}
                  aria-label="マンスリーの設定"
                />
              )}

            </div>
          ))}

          {empty && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-center text-[13px] leading-[1.7] text-muted">
              {/* A cover is a single page in a book of spreads, and an empty
                  page looks like any other empty page. It says so itself,
                  because the paper is what anyone is looking at. */}
              {layout.cover || layout.backCover
                ? <span className="coverhint">{layout.cover ? '表紙' : '裏表紙'}（1ページ）<br />写真や背景を置けます</span>
                : <>下のパーツをドラッグして<br />ここに置けます</>}
            </div>
          )}

          {preview?.map(b => (
            <div
              key={`preview-${b.key}`}
              className="droptarget pointer-events-none absolute z-[3] rounded-[3px] border-[1.5px] border-[color-mix(in_srgb,var(--color-mark)_60%,transparent)] bg-[color-mix(in_srgb,var(--color-mark)_14%,transparent)]"
              style={{ left: b.left, top: b.top, width: b.width, height: b.height }}
            />
          ))}

          {/* Fades out over the part that just arrived. Over, not under: the
              part is drawn already and this says where it went. */}
          {landedOn?.map(b => (
            <div
              key={`landed-${b.key}`}
              className="drop-flash pointer-events-none absolute z-[3] rounded-[3px] bg-mark"
              style={{ left: b.left, top: b.top, width: b.width, height: b.height }}
            />
          ))}

          {/* A photo slot with nothing in it is the one part that is not
              finished when it is placed, and an empty dashed box does not say
              so. The frame and the words are drawn here rather than by the
              part, because they are for the screen: nothing of this goes on
              the paper -- an empty slot prints nothing at all. */}
          {partBoxes.map(b => {
            const waiting = layout.surface.placed[b.slot] === 'photo'
              && !layout.surface.photos?.[b.slot];
            return (
              <div
                key={b.key}
                className={`hitbox part absolute cursor-grab touch-none p-0 hover:bg-[color-mix(in_srgb,var(--color-mark)_6%,transparent)] active:cursor-grabbing active:bg-[color-mix(in_srgb,var(--color-mark)_10%,transparent)] ${
                  waiting ? 'flex items-center justify-center rounded-[3px] border border-dashed border-line-strong' : ''
                }`}
                style={{ left: b.left, top: b.top, width: b.width, height: b.height }}
                onPointerDown={e => startDrag(e, [layout.surface.placed[b.slot]], b.slot)}
                onPointerMove={moveDrag}
                onPointerUp={e => endPartDrag(e, b.slot)}
                title={PART_LABEL[layout.surface.placed[b.slot]]}
              >
                {waiting && (
                  <span className="photo-empty pointer-events-none rounded-full bg-white/85 px-2 py-1 text-[13px] text-muted">
                    ＋ 写真を選ぶ
                  </span>
                )}
              </div>
            );
          })}

          {clears.map(c => (
            <RoundButton
              key={c.key}
              left={c.left}
              top={c.top}
              label={`${c.label}を外す`}
              onClick={() => askRemove(c.label, c.run)}
            >×</RoundButton>
          ))}

          {miniCell && (
            <RoundButton
              left={pageOrigin(0).x + (miniCell.x + miniCell.w) * scale - CLEAR_INSET}
              top={pageOrigin(0).y + miniCell.y * scale + 2}
              label="翌月のカレンダーを外す"
              onClick={() => askRemove('翌月のカレンダー', () => setLayout(l => ({ ...l, showNextMonth: false })))}
            >×</RoundButton>
          )}

          {dividerBoxes.map(b => (
            <DividerHandle
              key={b.key}
              box={b}
              teach={!taught}
              onDown={e => startDivider(e, b.d)}
              onMove={moveDivider}
              onUp={endDivider}
            />
          ))}
        </div>
      </div>

      {/* What the app has to say while you work, in the air under the paper
          rather than in a row of its own. A row costs 26px of the column
          forever; this costs nothing, because the paper is as wide as the
          screen lets it be and the room underneath is already empty.

          The line about how to place things only stands while the book is
          empty. It is an explanation, and an explanation that never goes away
          is a design that never finished -- the drawing is supposed to say it
          (仕様4章). The other two are not explanations: they are what just
          happened. */}
      {/* On a phone the sheet under the paper has a line for this beside its
          tabs; down here it sat on top of the sheet. */}
      {wide && (teachDivider || traySelected.length > 0 || nothingPlaced) && (
        <p className={`saying pointer-events-none absolute inset-x-0 bottom-1 m-0 px-3.5 text-center text-[13px] ${
          teachDivider || traySelected.length > 0 ? 'text-accent-text' : 'text-muted'
        }`}>
          {teachDivider
            ? '仕切りをドラッグすると、パーツの広さを変えられます'
            : traySelected.length > 0
              ? `${traySelected.length}個選択中：紙をタップすると置けます`
              : 'タップで選ぶ → 紙をタップ。ドラッグでも置けます'}
        </p>
      )}

      {/* Turning the page, and where in the book this page is, in one row
          under the paper. The two arrows keep their room and go dim at the
          ends rather than disappearing: a row that changes width as you turn
          moves the button you are pressing out from under your thumb.

          The number is a button. Twenty-six pages is more than anyone turns
          through one at a time, and the number is where the eye already is
          when someone wants to be somewhere else. */}
      {!wide && pagerEl}

      {/* What the rest of the book is, from inside one section of it. */}
      {!wide && alsoEl}


      </div>

      {/* The tools. Under the paper on a phone, beside it on a desktop, and
          the same blocks in the same order either way. */}
      {/* On a phone the sheet is one height whichever tab is showing, so
          changing tabs never moves the paper above it. */}
      <aside className={`flex min-h-0 shrink-0 flex-col overflow-hidden ${!wide && !dockShut ? 'h-[222px]' : ''} lg:w-[340px] lg:overflow-y-auto lg:border-l lg:border-line lg:bg-paper`}>
      {wide && <div className="asidehead border-b border-line pb-2">{headerEl}{pagerEl}{alsoEl}</div>}
      {wide && <div className="border-b border-line pb-2 pt-2">{railEl}</div>}
      {!wide && (
        <div className="dock shrink-0 rounded-t-2xl border-t border-line bg-paper shadow-[0_-2px_10px_rgba(0,0,0,0.06)]">
          <DockGrip shut={dockShut} onClick={() => setDockShut(v => !v)} />
          <div className="flex items-end gap-1 px-3" role="tablist">
            {([['parts', 'パーツ'], ['paper', '設定']] as const).map(([k, name]) => (
              <DockTab key={k} on={dock === k && !dockShut} onClick={() => { setDock(k); setDockShut(false); }}>
                {name}
              </DockTab>
            ))}
            <span className={`saying ml-auto min-w-0 self-center truncate pb-1 text-[13px] ${
              teachDivider || traySelected.length > 0 ? 'text-accent-text' : 'text-muted'}`}>
              {teachDivider
                ? '仕切りをドラッグで広さが変わります'
                : traySelected.length > 0
                  ? `${traySelected.length}個選択中：紙をタップ`
                  : dock === 'parts' && !dockShut && !layout.imported ? '選ぶ → 紙をタップ' : ''}
            </span>
          </div>
        </div>
      )}

      {/* The row is wider than the screen, and until now nothing said so: it
          ran off the edge with no sign that there was more, and could not be
          swiped either. The arrow appears only on the side that has more to
          come, and goes when that side runs out. */}
      {layout.imported && partsShown && (
        <p className="importednote m-0 shrink-0 border-t border-line bg-paper px-4 py-3 text-[13px] leading-relaxed text-muted lg:border-t-0">
          取り込んだページにはパーツを置けません。メモなどは「並びを整える」から別のページとして足してください
        </p>
      )}
      <div className={`relative shrink-0 bg-paper lg:border-t lg:border-line lg:border-t-0 ${layout.imported || !partsShown ? 'hidden' : ''}`}>
        <div
          ref={el => { trayRef.current = el; readTrayEdges(); }}
          onScroll={readTrayEdges}
          // On a desktop the tray and the settings share one column, and the
          // tray is the one that can give way: it is a palette that is always
          // there, while the settings are what was just asked for. Without
          // this the thirteen stamps took the whole column and the settings
          // were a 200px slot at the bottom -- open the photo settings and
          // the button to choose a picture was below the fold.
          // Two rows on a phone, scrolled sideways: the same height as the
          // settings, so the sheet does not change size between its tabs.
          className={`grid auto-cols-[84px] grid-flow-col grid-rows-2 gap-2 overflow-x-auto px-3 pb-2.5 pt-2 lg:grid-flow-row lg:auto-cols-auto lg:grid-rows-none lg:gap-2.5 lg:grid-cols-3 lg:overflow-x-visible lg:px-4 lg:pt-4 ${
            sheetEl ? 'lg:max-h-[34vh] lg:overflow-y-auto' : ''
          }`}
        >
        {trayParts.map(t => {
          const idx = traySelected.indexOf(t.kind);
          return (
            <button
              key={t.kind}
              // `pan-x`, not `none`: sideways belongs to the tray, every other
              // direction belongs to the part being lifted out of it.
              // 84, not 68: 「ウィークリー」 measures 78px at 13px, and the
              // and a tray whose stamps are different heights reads as two
              // border takes 3 more. A tray whose stamps are different heights
              // reads as two rows of something, so the longest name decides
              // the width -- it went 60 → 68 → 84 as the type went 9 → 11 → 13.
              className={`stamp relative flex w-[84px] shrink-0 cursor-grab touch-pan-x flex-col items-center gap-[3px] rounded-lg border-[1.5px] py-[8px] text-[13px] font-semibold transition-[transform,box-shadow,background-color,border-color] duration-[120ms] ease-out active:cursor-grabbing active:scale-95 motion-reduce:transition-none lg:w-full lg:gap-1 lg:py-3 lg:text-[13px] ${
                idx >= 0
                  // Picked up: it stands off the tray until it is put down.
                  ? '-translate-y-0.5 border-ink bg-white shadow-[inset_0_-3px_0_var(--color-hi)]'
                  : 'border-line bg-white hover:border-line-strong'
              }`}
              onPointerDown={e => startDrag(e, idx >= 0 && traySelected.length > 1 ? [...traySelected] : [t.kind], null)}
              onPointerMove={moveDrag}
              onPointerCancel={cancelDrag}
              onPointerUp={e => endTrayDrag(e, t.kind)}
            >
              {idx >= 0 && (
                <i className="absolute -right-[5px] -top-[5px] size-[17px] rounded-full bg-accent text-[13px] not-italic leading-[17px] text-white">
                  {idx + 1}
                </i>
              )}
              <StampIcon kind={t.kind} />
              <span>{t.label}</span>
            </button>
          );
        })}
        </div>

        {!wide && ([['left', '‹'], ['right', '›']] as const).map(([side, glyph]) => (
          trayEdge[side] && (
            <span
              key={side}
              className={`tray-more pointer-events-none absolute top-0 flex h-full w-9 items-center ${
                side === 'left'
                  ? 'left-0 justify-start bg-gradient-to-r'
                  : 'right-0 justify-end bg-gradient-to-l'
              } from-paper via-paper to-transparent`}
            >
              <Button
                variant="icon"
                className="pointer-events-auto text-muted"
                aria-label={side === 'left' ? '前のパーツ' : '次のパーツ'}
                onClick={() => nudgeTray(side === 'left' ? -1 : 1)}
              >
                {glyph}
              </Button>
            </span>
          )
        ))}
      </div>

      {wide && sheetEl}

      {/* What the whole of this refill is printed as, rather than what one
          part of it is: its months, the ground under everything, its words
          and ink. Down here, together and named, rather than as chips over
          the paper -- above the paper there is only where you are. */}
      <div className={`papersettings shrink-0 bg-paper px-3 pt-1 ${paperShown ? '' : 'hidden'}`}>
        {/* On a phone the tab it sits behind already says this. */}
        <div className={`sect items-center gap-2 px-0.5 pb-1 text-[13px] text-muted ${wide ? 'flex' : 'hidden'}`}>
          この紙の設定<i className="h-px flex-1 bg-line" />
        </div>
        {layout.imported ? (
          <div className="grid grid-cols-2 gap-1.5">
            <PaperSetting
              className="importfit"
              label="入れ方"
              sample={<FileGlyph />}
              value={layout.imported.fit === 'contain' ? '全体を入れる' : 'いっぱいに広げる'}
              onClick={() => setSheet('import')}
            />
          </div>
        ) : (
        <div className={`grid gap-1.5 ${dated ? 'grid-cols-3' : 'grid-cols-2'}`}>
          {dated && (
            <PaperSetting
              className="range"
              label={byDay ? `期間 ${sheetCount(layout)}枚` : `期間 ${layout.monthCount}ヶ月`}
              sample={<CalendarGlyph />}
              value={byDay
                ? `${firstDay.getMonth() + 1}/${firstDay.getDate()}〜`
                : `${layout.month}月〜${lastMonth.month}月`}
              onClick={() => setSheet(monthlyTarget)}
            />
          )}
          <PaperSetting
            label="背景"
            sample={<BackgroundSample bg={layout.background} />}
            value={BACKGROUND_LABEL[layout.background?.kind ?? 'none'].replace(/^背景[：]?/, '')}
            onClick={() => setSheet('background')}
          />
          {/* The sample is the setting: the words it is set to, in the ink it
              is set to, which is why this is not a gear icon. */}
          <PaperSetting
            className="look"
            label="書体と色"
            sample={<span className="text-[13px] font-bold leading-none" style={{ color: cssColor(paletteOf(layout).ink) }}>Aa</span>}
            value={<span style={{ color: cssColor(paletteOf(layout).ink) }}>{WORD_SAMPLE[layout.words ?? 'mix']}</span>}
            onClick={() => setSheet('look')}
          />
        </div>
        )}
      </div>

      {!wide && paperShown && (
        <div className="flex shrink-0 items-center gap-2 bg-paper px-3 pt-2">
          <Button variant="chip" className="rotate" onClick={turn} aria-label="リフィルを回転">
            <span className="text-[14px] leading-none">↻</span>{turnLabel}
          </Button>
          <Button variant="chip" className="magnify" onClick={() => setZoomed(true)} aria-label="大きく見る">
            <span className="text-[14px] leading-none">⤢</span>大きく
          </Button>
          <Button variant="chip" className="paper ml-auto min-w-0 overflow-hidden whitespace-nowrap" style={{ flexShrink: 1 }} onClick={() => setSheet('paper')}>
            <span className="text-[14px] leading-none">▭</span>
            {print.impose ? `${PAPERS[print.paper].label} ${job.sheets}枚` : `${PAPERS[print.paper].label}に1枚ずつ`}
            {print.impose && job.spare > 0 && <span className="min-w-0 truncate text-muted">（あと{job.spare}{job.unit}ぶん）</span>}
          </Button>
        </div>
      )}
      <div className={`flex shrink-0 gap-2 bg-paper px-3 pb-3.5 pt-2 ${paperShown ? '' : 'hidden'} lg:sticky lg:bottom-0 lg:z-10 lg:mt-auto lg:border-t lg:border-line lg:px-4 lg:pt-3`}>
        {/* 「読み込み」 was this and is now also what taking a file in sounds
            like; this one opens what was saved here. */}
        <Button onClick={() => setSheet('load')} aria-label="保存したものを開く">開く</Button>
        {/* Named on the way in. Everything saved used to be called 新しい
            リフィル, which is no name at all once there are three of them --
            and putting several on one sheet of paper means reading that list
            and picking. */}
        <Button onClick={() => setSheet('save')}>保存</Button>
        {wide && <Button variant="actionWide" onClick={() => setSheet('print')}>PDF出力プレビュー</Button>}
      </div>
      </aside>

      {ghost && (
        <div
          className="pointer-events-none fixed z-40 -translate-x-1/2 -translate-y-[140%] whitespace-nowrap rounded-[20px] bg-ink px-3 py-[7px] text-[13px] text-white"
          style={{ left: ghost.x, top: ghost.y }}
        >
          {ghost.kinds.map(k => PART_LABEL[k]).join(' + ')}
        </div>
      )}

      {toast && <Toast>{toast}</Toast>}

      {confirm && (
        <Dialog
          message={`${confirm.what}を外していいですか？`}
          confirmLabel="外す"
          onConfirm={() => { confirm.run(); setConfirm(null); }}
          onCancel={() => setConfirm(null)}
        />
      )}

      {!wide && sheetEl}
    </div>
  );
}

// The picture for one photo stamp. The bytes are kept on the surface next to
// the part they belong to, so moving the part moves its picture and taking it
// off takes the picture with it.
// A picture on a run of sheets is two different wishes. One is a band or a
// mark that belongs on every month; the other is this month's photograph, and
// next month's is a different one. Both are real, so the slot says which it is
// -- and the one being looked at is the one being set, because the page on
// screen is the page whose picture this is.
function PhotoField({ layout, setLayout, size, slot, nth }: {
  layout: Layout; setLayout: (fn: (l: Layout) => Layout) => void; size: SizeSpec;
  slot: number; nth: number;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState('');
  // Which picture has actually finished painting, so the thumbnail can wait
  // for it rather than showing an empty frame.
  const [shown, setShown] = useState('');
  const [failed, setFailed] = useState('');
  const run = sheetCount(layout);
  const mine = layout.surface.photoEach?.[slot] ?? null;
  const src = (mine ? mine[nth] : layout.surface.photos?.[slot]) ?? null;
  const filled = mine ? mine.filter(Boolean).length : 0;
  // The area this stamp actually occupies on the paper, which is what the
  // picture has to be big enough for -- a stamp on a quarter of a Micro5 does
  // not need the pixels a full A5 does.
  const box = useMemo(() => {
    const region = buildGeometry(layout, size).surface.regions[slot];
    return region ? { w: region.w, h: region.h } : { w: size.widthMm, h: size.heightMm };
  }, [layout, size, slot]);

  const set = (next: string | null) => setLayout(l => {
    const runs = eachOf(l.surface);
    if (runs[slot]) {
      const own = [...runs[slot]!];
      own[nth] = next;
      runs[slot] = own;
      return { ...l, surface: { ...l.surface, photoEach: someEach(runs) } };
    }
    const photos = photosOf(l.surface);
    photos[slot] = next;
    return { ...l, surface: { ...l.surface, photos } };
  });

  // Switching does not lose the picture on screen: going per-page keeps it on
  // this page and leaves the rest of the run empty (copying it onto all twelve
  // would be twelve times the bytes to save, for pictures nobody asked for),
  // and coming back keeps the one being looked at.
  const setEach = (on: boolean) => setLayout(l => {
    const runs = eachOf(l.surface);
    const photos = photosOf(l.surface);
    if (on) {
      const own = Array.from({ length: run }, () => null as string | null);
      own[nth] = photos[slot] ?? null;
      runs[slot] = own;
      photos[slot] = null;
    } else {
      photos[slot] = runs[slot]?.[nth] ?? null;
      runs[slot] = null;
    }
    return { ...l, surface: { ...l.surface, photos, photoEach: someEach(runs) } };
  });

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setBusy('読み込み中…');
    setFailed('');
    try {
      set(await importPhoto(f, box));
      setBusy('');
    } catch (e) {
      setBusy('');
      // Said loudly, because the quiet version of this reads as "nothing
      // happened". The usual cause is an iPhone HEIC, which the browser
      // cannot decode at all -- and nothing about the file picker says so.
      setFailed(`${e instanceof Error ? e.message : '読み込めませんでした'}。`
        + 'iPhoneのHEICはブラウザが開けないことがあります。JPEGかPNGでお試しください');
    }
  };

  const bytes = src ? photoBytes(src) : 0;

  return (
    <Field label="写真">
      {run > 1 && (
        <>
          <Segmented
            options={[{ v: 'all', label: '全ページ同じ' }, { v: 'each', label: 'ページごと' }]}
            value={mine ? 'each' : 'all'}
            onPick={v => setEach(v === 'each')}
          />
          <p className="photo-where m-0 text-[13px] leading-snug text-muted">
            {mine
              ? `いま${nth + 1}枚目の写真です（${run}枚中${filled}枚に入っています）`
              : `${run}枚ぜんぶに同じ写真が刷られます`}
          </p>
        </>
      )}
      <input
        ref={file}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => { void pick(e.target.files?.[0]); e.target.value = ''; }}
      />
      <div className="flex items-center gap-2.5">
        <Button variant="quiet" onClick={() => file.current?.click()}>
          {src ? '選び直す' : '写真を選ぶ'}
        </Button>
        {/* A chosen picture is a data URL of a megabyte or so, and the browser
            does not paint it the moment React hands it over -- the first time
            there is nothing cached, so the box sat empty with nothing saying
            why. It says so now, and the picture fades in when it is actually
            there. */}
        {src && (
          <span className="relative block size-12 shrink-0 overflow-hidden rounded-[6px] border border-line-strong bg-bg">
            <img
              key={src}
              src={src}
              alt=""
              onLoad={() => setShown(src)}
              className={`size-full object-cover ${shown === src ? '' : 'opacity-0'}`}
            />
            {shown !== src && <i className="absolute inset-0 animate-pulse bg-line" />}
          </span>
        )}
        {src && <Button variant="quiet" onClick={() => set(null)}>外す</Button>}
      </div>
      {(busy || (src && shown !== src)) && (
        <p className="m-0 text-[13px] text-muted">{busy || '読み込み中…'}</p>
      )}
      {failed && <p className="photo-failed m-0 text-[13px] leading-snug text-danger">{failed}</p>}
      {src ? (
        <p className={`photo-size m-0 text-[13px] ${bytes > PHOTO_WARN_BYTES ? 'text-danger' : 'text-muted'}`}>
          {`${Math.round(bytes / 1024)}KB。刷る大きさ（${Math.round(box.w)}×${Math.round(box.h)}mm）に合わせて縮めてあります`}
          {bytes > PHOTO_WARN_BYTES && '。これより大きいと保存が通らないことがあります'}
        </p>
      ) : (
        <p className="m-0 text-[13px] leading-snug text-muted">
          枠いっぱいに入ります。縦横の比が違うぶんは切り取られるので、
          見せたいところが端にある写真は先に切っておいてください
        </p>
      )}
    </Field>
  );
}

// How the refill is set: the words it prints, and the ink it prints them in.
// One thing decided once for the whole refill, like the background -- if this
// lived in the part sheets, every one of the twelve parts would grow the same
// three rows, which is what makes a settings screen unreadable.
//
// It is deliberately NOT a gear: a gear says "the settings are somewhere in
// here", and everything added later ends up inside it. The chip that opens
// this says what it is set to.
// A taken-in page has one thing to choose: how its picture meets this paper.
function ImportedSheet({ layout, setLayout, size }: {
  layout: Layout; setLayout: (fn: (l: Layout) => Layout) => void; size: SizeSpec;
}) {
  const im = layout.imported!;
  const paper = { w: size.widthMm, h: size.heightMm };
  const dpi = printedDpi(im, paper, im.fit);
  const shrink = im.wMm && im.hMm ? Math.min(paper.w / im.wMm, paper.h / im.hMm) : null;
  return (
    <>
      <Field label="入れ方">
        <Segmented
          options={[{ v: 'contain', label: '全体を入れる' }, { v: 'cover', label: 'いっぱいに広げる' }]}
          value={im.fit}
          onPick={v => setLayout(l => ({ ...l, imported: { ...l.imported!, fit: v as 'contain' | 'cover' } }))}
        />
      </Field>
      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px] leading-relaxed text-muted">
        <li>{im.file}{im.of > 1 ? `の${im.page}ページ目` : ''}</li>
        {shrink !== null && shrink < 0.95 && <li>元の大きさから約{Math.round(shrink * 100)}%に縮んでいます</li>}
        <li className={dpi < 200 ? 'text-danger' : ''}>刷ったときの細かさ 約{dpi}dpi</li>
      </ul>
    </>
  );
}

function LookSheet({ layout, setLayout }: {
  layout: Layout; setLayout: (fn: (l: Layout) => Layout) => void;
}) {
  const words = layout.words ?? 'mix';
  const tone = layout.tone ?? 'sepia';
  const weight = layout.ruleWeight ?? 'normal';
  const pal = paletteOf(layout);
  const plain = words === 'mix' && tone === 'sepia' && weight === 'normal' && !layout.hideRokuyo;

  return (
    <>
      <Field label="月と曜日の書き方">
        <Segmented
          options={(['ja', 'mix', 'en'] as DateWords[]).map(v => ({ v, label: WORD_SAMPLE[v] }))}
          value={words}
          onPick={v => setLayout(l => ({ ...l, words: v as DateWords }))}
        />
      </Field>

      <Field label="六曜">
        <Segmented
          options={[{ v: 'show', label: '表示する' }, { v: 'hide', label: '表示しない' }]}
          value={layout.hideRokuyo ? 'hide' : 'show'}
          onPick={v => setLayout(l => ({ ...l, hideRokuyo: v === 'hide' || undefined }))}
        />
      </Field>

      {/* Swatches rather than names: the colour is the thing being chosen, and
          a word for a colour is a worse description of it than the colour. */}
      <Field label="線と文字">
        <div className="tones flex gap-2">
          {TONE_ORDER.map(t => {
            const on = tone === t;
            return (
              <button
                key={t}
                aria-label={TONES[t].label}
                aria-pressed={on}
                onClick={() => setLayout(l => ({ ...l, tone: t as InkTone }))}
                className={`flex flex-1 flex-col items-center gap-1 rounded-[9px] border-2 bg-white py-2 text-[13px] ${
                  on ? 'border-ink' : 'border-line-strong'
                }`}
              >
                <span className="flex items-end gap-[3px]">
                  <i className="block size-3.5 rounded-full" style={{ background: cssColor(TONES[t].ink) }} />
                  <i className="block h-3.5 w-1.5 rounded-sm" style={{ background: cssColor(TONES[t].rule) }} />
                </span>
                <span style={{ color: cssColor(TONES[t].ink) }}>{TONES[t].label}</span>
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="罫線の濃さ">
        <Segmented
          options={RULE_WEIGHT_ORDER.map(v => ({ v, label: RULE_WEIGHTS[v].label }))}
          value={weight}
          onPick={v => setLayout(l => ({ ...l, ruleWeight: v as RuleWeight }))}
        />
      </Field>

      {/* Drawn, not described: a frame rule and three writing rules at the
          weight that is actually set. The difference between うすい and ふつう
          is a fraction of a percent of ink, and no word carries that. */}
      <div className="rules flex flex-col gap-[7px] rounded-[9px] border border-line-strong bg-white px-3 py-3">
        <i className="block h-[2px] rounded-sm" style={{ background: cssColor(pal.rule) }} />
        {[0, 1, 2].map(i => (
          <i key={i} className="block h-px" style={{ background: cssColor(pal.ruleLight) }} />
        ))}
      </div>

      {/* Always there, only unpressable while nothing has been changed: a
          button that appeared with the first change made the sheet taller
          under the finger, and everything in it jumped. */}
      <Button
        variant="quiet"
        className="self-start disabled:opacity-40"
        disabled={plain}
        onClick={() => setLayout(l => ({ ...l, words: undefined, hideRokuyo: undefined, tone: undefined, ruleWeight: undefined }))}
      >
        はじめの書体と色に戻す
      </Button>
    </>
  );
}

// The ground the sheet prints on. Not a part -- it is under all of them, so it
// belongs to the refill rather than to a slot, and it is set from the chip
// above the paper rather than by dropping something.
function BackgroundSheet({ layout, setLayout, size }: {
  layout: Layout; setLayout: (fn: (l: Layout) => Layout) => void; size: SizeSpec;
}) {
  const bg = layout.background ?? { kind: 'none' as BackgroundKind };
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState('');
  const set = (next: Partial<Background>) =>
    setLayout(l => ({ ...l, background: { ...bg, ...next } as Background }));

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setBusy('読み込み中…');
    try {
      // Sized to the paper it will print on, at print resolution. A phone
      // photo is twenty times that and would fill the browser's whole store
      // on its own.
      const src = await importPhoto(f, { w: size.widthMm, h: size.heightMm });
      set({ kind: 'image', src });
      setBusy('');
    } catch (e) {
      setBusy(e instanceof Error ? e.message : '読み込めませんでした');
    }
  };

  const bytes = bg.src ? photoBytes(bg.src) : 0;

  return (
    <>
      {/* Six choices are one choice, not two: they are laid out on two rows
          because six will not fit across a phone, and exactly one of the six
          is ever lit. The rows do not each carry their own "none". */}
      <Field label="背景の種類">
        <div className="flex flex-col gap-2">
          <Segmented
            options={[{ v: 'none', label: 'なし' }, { v: 'tint', label: '色' }, { v: 'image', label: '画像' }]}
            value={bg.kind}
            onPick={v => set({ kind: v as BackgroundKind })}
          />
          <Segmented
            options={[{ v: 'grid', label: '方眼' }, { v: 'dot', label: 'ドット' }, { v: 'lines', label: '罫線' }]}
            value={bg.kind}
            onPick={v => set({ kind: v as BackgroundKind })}
          />
        </div>
      </Field>

      {bg.kind !== 'none' && bg.kind !== 'image' && (
        <Field label="色">
          <div className="flex gap-2">
            {BACKGROUND_COLORS.map(c => (
              <button
                key={c}
                aria-label={`色 ${c}`}
                aria-pressed={(bg.color ?? BACKGROUND_COLORS[0]) === c}
                onClick={() => set({ color: c })}
                className={`h-9 flex-1 rounded-[9px] border-2 ${
                  (bg.color ?? BACKGROUND_COLORS[0]) === c ? 'border-ink' : 'border-line-strong'
                }`}
                style={{ background: c }}
              />
            ))}
          </div>
        </Field>
      )}

      {bg.kind === 'image' && (
        <Field label="画像">
          <input
            ref={file}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={e => { void pick(e.target.files?.[0]); e.target.value = ''; }}
          />
          <div className="flex items-center gap-2.5">
            <Button variant="quiet" onClick={() => file.current?.click()}>
              {bg.src ? '選び直す' : '写真を選ぶ'}
            </Button>
            {bg.src && (
              <img src={bg.src} alt="" className="h-12 w-12 rounded-[6px] border border-line-strong object-cover" />
            )}
            {bg.src && <Button variant="quiet" onClick={() => set({ src: undefined })}>外す</Button>}
          </div>
          {busy && <p className="m-0 text-[13px] text-muted">{busy}</p>}
          {bg.src && (
            <p className={`photo-size m-0 text-[13px] ${bytes > PHOTO_WARN_BYTES ? 'text-danger' : 'text-muted'}`}>
              {`${Math.round(bytes / 1024)}KB。刷る大きさに合わせて縮めてあります`}
              {bytes > PHOTO_WARN_BYTES && '。これより大きいと保存が通らないことがあります'}
            </p>
          )}
        </Field>
      )}

      {bg.kind !== 'none' && (
        <Field label="濃さ">
          <Stepper
            value={`${Math.round((bg.opacity ?? 1) * 100)}%`}
            onStep={n => set({ opacity: Math.min(1, Math.max(0.1, +((bg.opacity ?? 1) + n * 0.1).toFixed(2))) })}
            canDown={(bg.opacity ?? 1) > 0.1}
            canUp={(bg.opacity ?? 1) < 1}
          />
        </Field>
      )}

      <p className="m-0 text-[13px] leading-snug text-muted">
        紙の端まで刷ります。プリンタが端まで出せないぶんは欠けます
      </p>
    </>
  );
}

// A small round control sitting over a block on the sheet. Positioned onto a
// drawing rather than laid out, so it is not an ordinary Button.
function RoundButton({ left, top, label, onClick, hook = 'clearmini', children }: {
  left: number; top: number; label: string; onClick: () => void;
  // Names the control for the checking scripts, which count them by kind.
  hook?: 'clearmini' | 'rotatemini';
  children: ReactNode;
}) {
  return (
    <button
      // White on a 34% grey over white paper came to 1.05:1 -- the ✕ was
      // there and could not be seen. It wears the same white-and-outline the
      // other controls on the drawing wear (`variant="edge"`), which is both
      // legible (15:1) and the app's own word for "this is a control, not a
      // mark on the page".
      className={`${hook} absolute z-[5] flex size-[18px] items-center justify-center rounded-full border border-line-strong bg-white p-0 text-[13px] leading-none text-label shadow-[0_1px_3px_rgba(38,36,31,0.18)] hover:border-danger hover:text-danger`}
      style={{ left, top }}
      onClick={onClick}
      aria-label={label}
    >{children}</button>
  );
}

// The border between two parts, and the grab handle that says so. Until
// someone has dragged one, the handle asks to be dragged.
function DividerHandle({ box, teach, onDown, onMove, onUp }: {
  box: { d: Divider; left: number; top: number; width: number; height: number };
  teach: boolean;
  onDown: (e: React.PointerEvent) => void;
  onMove: (e: React.PointerEvent) => void;
  onUp: () => void;
}) {
  const horizontal = box.d.axis === 'h';
  return (
    <div
      className={`divider ${box.d.axis} group absolute z-[4] flex touch-none items-center justify-center ${
        horizontal ? 'cursor-row-resize' : 'cursor-col-resize'
      }`}
      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      {/* The border itself, faintly in the screen's own mark colour at rest
          and fully while held. The mark colour is the one that never prints
          (drop targets, page numbers), so neither the line nor the handle can
          be mistaken for a rule on the refill. */}
      <i className={`block rounded-sm bg-[color-mix(in_srgb,var(--color-mark)_28%,transparent)] group-hover:bg-mark group-active:bg-mark ${
        horizontal ? 'h-[2px] w-full' : 'h-full w-[2px]'
      }`} />
      {/* A short bar with a chevron either side of it: which way it moves,
          said by where the chevrons are. */}
      <b className={`divgrip absolute flex items-center justify-center text-mark ${
        horizontal ? 'flex-col gap-[3px]' : 'flex-row gap-[3px]'
      }`}>
        <Chevron dir={horizontal ? 'up' : 'left'} />
        <span className={`block rounded-[2px] bg-mark shadow-[0_0_0_2px_#fff,0_1px_3px_rgba(90,79,214,0.35)] ${
          horizontal ? 'h-[4px] w-[30px]' : 'h-[30px] w-[4px]'
        } ${teach ? 'animate-knob' : ''}`} />
        <Chevron dir={horizontal ? 'down' : 'right'} />
      </b>
    </div>
  );
}

// One chevron of the divider's grip, haloed in white so it reads over the
// paper's own lines.
function Chevron({ dir }: { dir: 'up' | 'down' | 'left' | 'right' }) {
  const d = { up: 'M1 5 L4.5 1.2 L8 5', down: 'M1 1 L4.5 4.8 L8 1', left: 'M5 1 L1.2 4.5 L5 8', right: 'M1 1 L4.8 4.5 L1 8' }[dir];
  const across = dir === 'up' || dir === 'down';
  return (
    <svg width={across ? 9 : 6} height={across ? 6 : 9} viewBox={across ? '0 0 9 6' : '0 0 6 9'} aria-hidden="true"
      className="block overflow-visible [filter:drop-shadow(0_0_1.5px_#fff)_drop-shadow(0_0_1.5px_#fff)]">
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// The list of pages, drawn rather than named. Two columns of little sheets is
// what the panel it opens actually looks like, so the button and the place it
// goes are the same picture.
function ListGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true" className="block">
      <g fill="none" stroke="currentColor" strokeWidth={1}>
        {[0.5, 7.5].map(x => [0.5, 5, 9.5].map(y => (
          <rect key={`${x}-${y}`} x={x} y={y} width={5} height={3} rx={0.5} />
        )))}
      </g>
    </svg>
  );
}

// The page -- or the pair -- that the ＋ beside the paper would put there,
// drawn as an outline that is not a sheet yet. Dashes are already this app's
// word for 「nothing here yet」 (the empty pages of the list wear them), and
// the punches say which edge it binds on: down the outer edge for a single
// page, down the seam for a pair.
// The book in the order it is bound -- 表紙, what is inside, 裏表紙 -- over the
// paper, so where this page sits in the planner is read before the page is.
// Each place is drawn rather than thumbnailed: the page below is already the
// full-size picture of the one you are on, and a small copy of it beside it
// is the same drawing twice (4章). The drawing is the page-layout card's, in
// the size's colour, so the spread chosen three screens ago is recognisably
// the one here.
//
// A cover goes in from here and nowhere else. It used to be a ＋ on the left
// edge of the paper, which also put pages in the middle of the book; putting
// something between two months is a question about the order of the whole
// book, and that is what 並びを整える answers.
function BindingRail({ sections, at, size, print, job, onGo, onAddCover, onFillBack, onList, onPaper, compact = false }: {
  sections: Layout[];
  at: number;
  size: SizeSpec;
  print: PrintOptions;
  job: PaperJob;
  onGo: (i: number) => void;
  onAddCover: () => void;
  onFillBack: () => void;
  onList: () => void;
  onPaper: () => void;
  // On a phone every pixel of height the rail takes comes off the paper, so
  // the tiles lie on their side -- a small picture with the words beside it
  // -- and the paper count moves up into the heading's line.
  compact?: boolean;
}) {
  const color = SIZE_COLOR[size.id];
  const k = compact
    ? Math.min(26 / size.heightMm, 20 / size.widthMm)
    : Math.min(44 / size.heightMm, 40 / size.widthMm);
  const all = pagesOf(sections);
  const pagesFor = (i: number) => {
    const from = all.findIndex(l => l.at === i);
    if (from < 0) return '';
    let to = from;
    while (all[to + 1] && all[to + 1].at === i) to++;
    return from === to ? `p.${from + 1}` : `p.${from + 1}–${to + 1}`;
  };
  const body = sections.map((sec, i) => ({ sec, i })).filter(({ sec }) => !sec.cover && !sec.backCover);
  const backAt = sections.findIndex(s => s.backCover);
  const hasCover = !!sections[0]?.cover;
  // The empty cover and back are the pages a spread leaves: page 1 alone on
  // the right, and the back of the last sheet. A book of single pages leaves
  // neither -- its first page is already page 1 -- so it offers neither.
  const spreads = body.some(({ sec }) => sec.spread && sec.fold <= 1);
  const backBlank = spreads && all.length > 0 && all[all.length - 1].at === null;
  const empty = (
    <span
      className="grid place-items-center rounded-[2px] border-[1.4px] border-dashed border-act text-[15px] font-bold leading-none text-act"
      style={{ width: size.widthMm * k, height: size.heightMm * k }}
    >＋</span>
  );
  // The back cannot be filled until the book has something in it: a back
  // page on an empty book is a page after nothing, and the empty spread it
  // would follow is a placeholder that the first real section replaces.
  const filled = sections.some(s => !s.cover && !s.backCover && !isPlaceholder(s));
  const waiting = (
    <span
      className="grid place-items-center rounded-[2px] border border-dashed border-line-strong text-[15px] leading-none text-faint"
      style={{ width: size.widthMm * k, height: size.heightMm * k }}
    >＋</span>
  );
  // How much paper the book comes to, and how much of the last sheet is
  // still empty -- a fact about the whole book, so it sits under the book
  // rather than on a chip above one page of it.
  const paper = (
    <button className={`paper flex min-w-0 items-center gap-1.5 py-1 text-[13px] text-muted ${compact ? 'overflow-hidden px-0.5 whitespace-nowrap' : 'px-2'}`} onClick={onPaper}>
      <span className="text-[14px] leading-none">▭</span>
      {print.impose
        ? `${PAPERS[print.paper].label} ${job.sheets}枚`
        : `${PAPERS[print.paper].label}に1枚ずつ`}
      {print.impose && job.spare > 0 && (
        <em className="min-w-0 truncate not-italic">（あと{job.spare}{job.unit}ぶん）</em>
      )}
    </button>
  );
  const tile = (key: string, on: boolean, picture: ReactNode, name: ReactNode, pn: string,
    onClick: () => void, extra: string, label?: string, disabled = false) => compact ? (
    // On a phone a tab: the words and the pages, no picture. The picture is
    // what made the rail tall, and the paper right under it is the picture.
    <button
      key={key}
      disabled={disabled}
      className={`railtile relative flex shrink-0 items-baseline gap-1 whitespace-nowrap rounded-lg border px-2.5 py-[7px] text-[13px] font-semibold ${PRESS} ${
        on ? 'on border-line-strong bg-white shadow-[inset_0_-3px_0_var(--color-hi)]'
          : extra.includes('addbefore') || extra.includes('fillback') && !disabled
            ? 'border-dashed border-act text-act' : 'border-transparent bg-accent-soft'} ${
        disabled ? 'text-faint' : ''} ${extra}`}
      onClick={onClick}
      aria-label={label}
      aria-current={on ? 'page' : undefined}
    >
      {(extra.includes('addbefore') || extra.includes('fillback')) && <span aria-hidden="true">＋</span>}
      {name}
      {/* How many times a run repeats is the long version's to say. */}
      <span className="text-[12px] font-normal text-muted tabular-nums">{pn.replace(/・\d+回$/, '')}</span>
    </button>
  ) : (
    <button
      key={key}
      disabled={disabled}
      className={`railtile relative flex shrink-0 grow rounded-md ${compact
        ? 'items-center gap-1.5 px-2 py-1.5'
        : 'min-w-[76px] flex-col items-center gap-1 px-1.5 pb-1.5 pt-2'} ${
        on ? 'on bg-white shadow-[0_0_0_1px_var(--color-line-strong)]' : ''} ${extra}`}
      onClick={onClick}
      aria-label={label}
      aria-current={on ? 'page' : undefined}
    >
      {on && <i className="absolute -top-px left-0 right-0 h-1 rounded-t-md bg-hi" />}
      <span className={`flex ${compact ? 'h-[28px]' : 'h-[46px]'} items-center justify-center gap-[2px]`}>{picture}</span>
      <span className={`flex flex-col gap-1 ${compact ? 'items-start' : 'items-center'}`}>
        <span className={`whitespace-nowrap text-[13px] font-semibold leading-none ${disabled ? 'text-faint' : 'text-ink'}`}>{name}</span>
        <span className="text-[13px] leading-none text-muted tabular-nums">{pn}</span>
      </span>
    </button>
  );
  const tiles = (
    <>
        {hasCover
          ? tile('cover', at === 0, <SizeIcon size={size} color={color} scale={k} rings />,
              '表紙', 'p.1', () => onGo(0), '')
          : spreads && tile('cover', false, empty, '表紙', 'p.1', onAddCover, 'addbefore', '表紙を入れる')}
        {body.map(({ sec, i }) => {
          const one = body.length === 1;
          const dated = hasDatedPart(sec);
          const end = dated ? runEnd(sec) : null;
          const n = sheetCount(sec);
          const picture = sec.fold > 1 ? <span style={{ color }}><FormGlyph kind="fold" panels={sec.fold} /></span>
            : sec.spread
              ? <><SizeIcon size={size} color={color} scale={k} rings flip /><SizeIcon size={size} color={color} scale={k} rings /></>
              // A page on the back of a sheet has its holes on the right.
              : <SizeIcon size={size} color={color} scale={k} rings flip={backSideOf(sections, i, 0, print.duplex)} />;
          const name = (
            <>
              {one ? formLabel(sec) : sectionLabel(sec)}
              <small className="ml-1 text-[13px] font-normal text-muted">
                {dated && end ? `${sec.month}月〜${end.month}月` : `${n}枚`}
              </small>
            </>
          );
          return tile(`s${i}`, at === i, picture, name,
            `${pagesFor(i)}${dated && n > 1 ? `・${n}回` : ''}`, () => onGo(i), '');
        })}
        {backAt >= 0 && tile('back', at === backAt,
          <SizeIcon size={size} color={color} scale={k} rings flip={backSideOf(sections, backAt, 0, print.duplex)} />,
          '裏表紙', pagesFor(backAt), () => onGo(backAt), '')}
        {backAt < 0 && backBlank && (filled
          ? tile('back', false, empty, '裏表紙', `p.${all.length}`, onFillBack, 'fillback', '裏表紙に入れる')
          : tile('back', false, waiting, '裏表紙', `p.${all.length}`, () => {}, 'fillback cursor-default',
              '裏表紙（見開きに何か置くと入れられます）', true))}
    </>
  );
  if (compact) {
    return (
      <div className="rail flex shrink-0 items-center gap-1.5 overflow-x-auto px-3 pb-1 pt-0.5">
        {tiles}
        <Button variant="chip" className="torail-list ml-auto" onClick={onList} aria-label="並びを整える">
          <ListGlyph />
        </Button>
      </div>
    );
  }
  return (
    <div className="rail shrink-0 px-3 pt-1">
      <div className="sect flex items-center gap-2 px-1 pb-1 text-[13px] text-muted">
        <span className="shrink-0">綴じた順</span>
        {compact ? <span className="flex min-w-0 flex-1 justify-center">{paper}</span> : <i className="h-px flex-1 bg-line-strong" />}
        <Button variant="chip" className="torail-list" onClick={onList} aria-label="並びを整える">
          <ListGlyph />並びを整える
        </Button>
      </div>
      <div className="flex gap-1.5 overflow-x-auto">
        {tiles}
      </div>
      {!compact && <div className="flex justify-center pt-1">{paper}</div>}
    </div>
  );
}

// A setting of this paper that can be changed, laid out so that it reads as
// one: what it is, what it is now, a small sample of it, and a way in. A chip
// that only said 「背景なし」 read as a report of the state, not as the door
// to change it.
function PaperSetting({ className = '', label, value, sample, onClick }: {
  className?: string;
  label: ReactNode;
  value: ReactNode;
  sample: ReactNode;
  onClick: () => void;
}) {
  // Three of these share a phone's width, which leaves each about a hundred
  // pixels: the sample sits in the label's line rather than in a box of its
  // own, so the value keeps the whole width under it.
  return (
    <button
      className={`papersetting flex min-h-[50px] min-w-0 items-center gap-1 rounded-lg border border-line-strong bg-white py-1.5 pl-2.5 pr-1.5 text-left ${className}`}
      onClick={onClick}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex min-w-0 items-center gap-1 whitespace-nowrap text-[13px] leading-none text-muted">
          <span className="grid shrink-0 place-items-center text-ink">{sample}</span>{label}
        </span>
        <span className="truncate whitespace-nowrap text-[13px] font-semibold leading-tight text-ink">{value}</span>
      </span>
      <span className="shrink-0 text-[16px] leading-none text-muted" aria-hidden="true">›</span>
    </button>
  );
}

function InsertMark({ pages }: { pages: number }) {
  const w = pages > 1 ? 21 : 23;
  const dots = (x: number) => [7, 14.5, 22].map(y => (
    <circle key={`${x}-${y}`} cx={x} cy={y} r={1.1} fill="currentColor" opacity={0.75} />
  ));
  return (
    <span className="insertmark block text-muted" aria-hidden="true">
      <svg
        width={pages > 1 ? 44 : 23} height={29}
        viewBox={`0 0 ${pages > 1 ? 44 : 23} 29`}
        className="block"
      >
        {Array.from({ length: pages }, (_, i) => (
          <rect
            key={i}
            x={i * (w + 2) + 0.7} y={0.7} width={w - 1.4} height={27.6} rx={1.6}
            fill="none" stroke="currentColor" strokeWidth={1.2} strokeDasharray="3 2.2"
          />
        ))}
        {/* One column of punches down the seam for a pair: two columns, one
            per facing edge, run into each other at this size and read as a
            smudge rather than as the rings both pages hang on. */}
        {pages > 1 ? dots(w + 1) : dots(4.5)}
      </svg>
    </span>
  );
}

// The form a refill is folded into, drawn small enough to stand in a chip:
// one sheet, two facing pages, or a strip with creases in it. Solid, because
// unlike the ＋'s mark this is a thing that exists -- dashes are this app's
// word for 「not there yet」.
function FormGlyph({ kind, panels = 3 }: { kind: 'spread' | 'single' | 'fold'; panels?: number }) {
  const w = kind === 'spread' ? 22 : 15;
  const dots = (x: number) => [3.6, 7.5, 11.4].map(y => (
    <circle key={y} cx={x} cy={y} r={0.9} fill="currentColor" opacity={0.85} />
  ));
  return (
    <svg width={w} height={15} viewBox={`0 0 ${w} 15`} aria-hidden="true" className="block shrink-0">
      {kind === 'spread' ? (
        <>
          <rect x={0.6} y={0.9} width={9.4} height={13.2} rx={1.2} fill="none" stroke="currentColor" strokeWidth={1.1} />
          <rect x={12} y={0.9} width={9.4} height={13.2} rx={1.2} fill="none" stroke="currentColor" strokeWidth={1.1} />
          {dots(11)}
        </>
      ) : (
        <>
          <rect x={0.6} y={0.9} width={13.8} height={13.2} rx={1.2} fill="none" stroke="currentColor" strokeWidth={1.1} />
          {kind === 'single'
            ? dots(3.4)
            : Array.from({ length: Math.max(1, panels - 1) }, (_, i) => (
                <line
                  key={i}
                  x1={0.6 + (13.8 * (i + 1)) / panels} y1={1.6}
                  x2={0.6 + (13.8 * (i + 1)) / panels} y2={13.4}
                  stroke="currentColor" strokeWidth={1} strokeDasharray="1.6 1.4"
                />
              ))}
        </>
      )}
    </svg>
  );
}

// An open book, drawn rather than named -- two leaves lifting away from the
// rings in the middle. Same trick as the list: the button and the screen it
// opens are the same picture, so nothing has to be written to say where it
// goes, and the way back out wears it too.
function CalendarGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}

// The ground as a swatch: what is printed under everything, in miniature.
function BackgroundSample({ bg }: { bg?: Background }) {
  const kind = bg?.kind ?? 'none';
  const line = bg?.color ?? '#B9B2A2';
  const style: CSSProperties =
    kind === 'tint' ? { background: bg?.color }
    : kind === 'grid' ? { backgroundImage: `linear-gradient(${line} 1px,transparent 1px),linear-gradient(90deg,${line} 1px,transparent 1px)`, backgroundSize: '5px 5px' }
    : kind === 'dot' ? { backgroundImage: `radial-gradient(circle,${line} 0.8px,transparent 1.1px)`, backgroundSize: '5px 5px' }
    : kind === 'lines' ? { backgroundImage: `repeating-linear-gradient(to bottom,transparent 0 4px,${line} 4px 5px)` }
    : kind === 'image' && bg?.src ? { backgroundImage: `url(${bg.src})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : {};
  return <span className="block size-[14px] rounded-[2px] border border-line-strong bg-white" style={style} />;
}

function BookGlyph() {
  return (
    <svg width="16" height="13" viewBox="0 0 16 13" aria-hidden="true" className="block">
      <g fill="none" stroke="currentColor" strokeWidth={1} strokeLinejoin="round" strokeLinecap="round">
        <path d="M8 3.1C6.4 1.9 4 1.5 1 1.8v8.6c3-.3 5.4.1 7 1.3" />
        <path d="M8 3.1c1.6-1.2 4-1.6 7-1.3v8.6c-3-.3-5.4.1-7 1.3" />
        <path d="M8 3.1v8.6" />
      </g>
    </svg>
  );
}

// A name someone would recognise a week later, made of what the book is: its
// size, its form, and what is in it. Better than 新しい束 and better than
// making someone think of one before they can save.
function suggestName(book: Book, size: SizeSpec, grain?: FoldGrain): string {
  const what = book.sections.map(sectionLabel).slice(0, 3).join('＋');
  // The form is the book's, and a cover has none of its own: with one on the
  // front, a book of spreads was saving itself as 「ミニ6 片面」.
  const body = bodyOf(book);
  return `${size.label} ${formLabel(body, grain)}・${what}`;
}

// Naming what is being saved. A sheet rather than a dialog, because it is the
// same shape of question as everything else here and it has to work beside the
// paper on a desktop.
function SaveSheet({ book, size, grain, onSave }: {
  book: Book; size: SizeSpec; grain?: FoldGrain; onSave: (name: string) => void;
}) {
  const [name, setName] = useState(() => (
    book.name && book.name !== '新しい束' ? book.name : suggestName(book, size, grain)
  ));
  return (
    <>
      <Field label="名前">
        <input
          className="savename w-full rounded-[9px] border border-line-strong bg-white px-3 py-[11px] text-[14px]"
          value={name}
          autoFocus
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onSave(name.trim() || suggestName(book, size, grain)); }}
        />
      </Field>
      <p className="m-0 text-[13px] leading-snug text-muted">
        表紙から裏表紙まで、まとめて保存されます。ページの順番も、用紙も、
        <strong className="font-semibold text-label">そのまま開き直せます</strong>
      </p>
      <Button variant="cta" onClick={() => onSave(name.trim() || suggestName(book, size, grain))}>
        保存する
      </Button>
    </>
  );
}

// What the job comes to on paper. The editor needs these numbers as much as
// the export screen does now that the paper can be filled from either.
function usePaperJob(sections: Layout[], size: SizeSpec, print: PrintOptions) {
  const [first, ...rest] = sections;
  // The book as one chain, which is what is actually printed: a section that
  // slots into the face another one was leaving costs no paper at all.
  const used = chainCount(sections, size, print);
  const plan = paperPlan(size, used, sheetSizeOf(first, size), print.paper);
  const perPaper = plan.perPage;
  // What the last sheet has left over. Zero when it comes out even, which is
  // worth saying too: it stops the reader looking for room that is not there.
  const spare = perPaper > 0 ? (perPaper - (used % perPaper)) % perPaper : 0;
  const sheets = perPaper > 0 ? Math.ceil(used / perPaper) : 0;
  // Which section owns each place on the paper, in the order the imposition
  // lays them down: the book's sections, in order, each one whole. This is
  // what lets a page on the printed sheet say what it is.
  const owners = useMemo(() => chainOwners(sections, size, print), [sections, size, print]);
  // A folded refill is a strip, and a strip is counted in 本 -- the same place
  // on the paper, a different word for what sits in it.
  const unit = first.fold > 1 ? '本' : '枚';
  return { also: rest, used, plan, perPaper, spare, sheets, owners, unit };
}

type PaperJob = ReturnType<typeof usePaperJob>;

// What an empty place on the paper offers. Two kinds of thing go in one:
// a note sheet, which is one sheet and needs nothing decided about it, and
// a section of your own, which you then design.
//
// It is a modal because a panel under the press sat off the bottom of a 900px
// window, and "pressed ＋ and nothing happened" is how that reads.
// What a refill set is made of, in the words the tray already uses. A section
// starts as one of these rather than as a blank sheet someone has to know how
// to fill: 表紙 is a picture on a sheet, and nobody arrives at that by
// guessing. The dated ones come with the book's period, so a weekly is a
// year of weeks straight away and the contents says how long that is.
// `run` marks the ones that are as long as their dates rather than one page,
// which is what decides whether they can be put on a single empty page.
// A sheet of paper with its corner turned: a file.
function FileGlyph() {
  return (
    <svg width="15" height="20" viewBox="0 0 15 20" aria-hidden="true" className="block shrink-0">
      <path d="M1 1h9l4 4v14H1z M10 1v4h4" fill="#fff" stroke="currentColor" strokeWidth={1} strokeLinejoin="round" className="text-faint" />
    </svg>
  );
}

// What was read from a file, before anything goes into the book: what it is,
// what will happen to it on this size, and the one choice that changes how it
// looks. Saying it here, once, is cheaper than someone finding on the paper
// that an A5 page went into a Mini6 at half its size.
function ImportSheet({ read, size, pad, onConfirm, onClose }: {
  read: ImportRead;
  // A blank page goes in first, so the pages land on the side they were drawn for.
  pad: boolean;
  size: SizeSpec;
  onConfirm: (fit: 'contain' | 'cover') => void;
  onClose: () => void;
}) {
  const [fit, setFit] = useState<'contain' | 'cover'>('contain');
  const paper = { w: size.widthMm, h: size.heightMm };
  const first = read.pages.find(p => p.wMm && p.hMm);
  const shrink = first ? Math.min(paper.w / first.wMm!, paper.h / first.hMm!) : null;
  const dpi = read.pages.length ? Math.min(...read.pages.map(p => printedDpi(p, paper, fit))) : 0;
  const mm = (v: number) => Math.round(v);
  const fileSize = first ? (Object.values(SIZES).find(z => Math.abs(z.widthMm - first.wMm!) < 1 && Math.abs(z.heightMm - first.hMm!) < 1)?.label ?? null) : null;
  return (
    <Modal title="ファイルから取り込む" onClose={onClose}>
      <div className="importsheet flex flex-col gap-3">
        <p className="m-0 text-[13px] leading-relaxed">
          <span className="font-semibold">{read.name}</span>
          <span className="text-muted">
            {read.kind === 'pdf' ? `・PDF ${read.pages.length}ページ` : '・画像'}
          </span>
        </p>
        {read.pages.length > 0 && (
          <span className="flex gap-1.5 overflow-x-auto">
            {read.pages.slice(0, 6).map((p, i) => (
              <img key={i} src={p.src} alt={`${i + 1}ページ目`} className="h-[86px] w-auto shrink-0 rounded-[2px] border border-line bg-white" />
            ))}
          </span>
        )}
        {read.skipped > 0 && (
          <p className="importskip m-0 text-[13px] leading-relaxed text-danger">
            {read.pages.length === 0
              ? 'このPDFは線と文字でできているので、まだ取り込めません。画像だけのPDFか、画像を選んでください'
              : `線と文字でできたページ（${read.skipped}ページ）は、まだ取り込めないので入れません`}
          </p>
        )}
        {read.pages.length > 0 && (
          <>
            <ul className="importfacts m-0 flex list-none flex-col gap-1 p-0 text-[13px] leading-relaxed text-muted">
              {first && <li>元の大きさ {mm(first.wMm!)}×{mm(first.hMm!)}mm{fileSize ? `（${fileSize}）` : ''}</li>}
              <li>
                入れる先 <span className="font-semibold text-label">{size.label} {size.widthMm}×{size.heightMm}mm</span>
              </li>
              {shrink !== null && shrink < 0.95 && (
                <li className="importshrink text-danger">
                  {fileSize ?? '元'}用を{size.label}に入れると、約{Math.round(shrink * 100)}%に縮みます。書き込む欄があるリフィルは、欄が狭くなります
                </li>
              )}
              <li className={dpi < 200 ? 'importdpi text-danger' : 'importdpi'}>
                刷ったときの細かさ 約{dpi}dpi{dpi < 200 ? '。線がぼやけて見えることがあります' : ''}
              </li>
              {read.pages[0]?.side && (
                <li className="importside">
                  1ページ目は見開きの{read.pages[0].side === 'L' ? '左（穴を右に空けてある）' : '右（穴を左に空けてある）'}のページです。
                  {pad ? '穴の側が合うように、前に白紙を1ページ入れます' : 'そのままで穴の側が合います'}
                </li>
              )}
              <li>ページの順に、最後（裏表紙の前）に入ります。取り込んだページにはパーツを置けません</li>
            </ul>
            <Field label="入れ方">
              <Segmented
                options={[{ v: 'contain', label: '全体を入れる' }, { v: 'cover', label: 'いっぱいに広げる' }]}
                value={fit}
                onPick={v => setFit(v as 'contain' | 'cover')}
              />
            </Field>
            <p className="m-0 -mt-1.5 text-[13px] leading-snug text-muted">
              {fit === 'contain' ? '縦横の比を保って全体を入れます。余白が出ることがあります' : '紙いっぱいに広げます。はみ出たところは切れます'}
            </p>
          </>
        )}
        <span className="flex gap-2">
          <Button variant="quiet" className="flex-1" onClick={onClose}>やめる</Button>
          {read.pages.length > 0 && (
            <Button variant="cta" className="importgo flex-[1.4] !p-3 !text-[15px]" onClick={() => onConfirm(fit)}>取り込む</Button>
          )}
        </span>
      </div>
    </Modal>
  );
}

const SECTION_MENU: { title: string; kinds: SectionKind[]; run?: boolean }[] = [
  { title: 'カレンダー', kinds: ['monthly', 'weekhoriz', 'weekvert', 'daylist'], run: true },
  { title: '書くところ', kinds: ['memo', 'lines', 'grid', 'todo'] },
];

const SECTION_LABEL = (kind: SectionKind): string => (
  kind === 'cover' ? '表紙' : kind === 'backcover' ? '裏表紙' : kind === 'blank' ? '白紙' : PART_LABEL[kind]
);

function AddSection({ job, print, positioned = false, cover = true, onPick, onClose, onImport }: {
  // Taking a page in from a file. Not offered on a single empty page: a file
  // is as many pages as it has.
  onImport?: () => void;
  // How much room is left on the last sheet -- or nothing at all, when the
  // screen asking is one that does not talk about paper (📖).
  job: PaperJob | null;
  print: PrintOptions;
  // Pressed on a particular empty page. What is chosen lands there and is one
  // page, because that is what an empty page is -- so the runs of dates are
  // not offered here: a monthly is as long as its months, and choosing one
  // from a single empty page would put twelve pages where one was asked for,
  // and leave the empty page where it was. Saying 「末尾に入ります」 in this
  // case is the sheet contradicting the press that opened it.
  positioned?: boolean;
  // Whether a cover is worth offering: there is nowhere for a second one to
  // go, and from an empty page in the middle of the book the answer to
  // 「先頭に入ります」 is that this is not the front.
  cover?: boolean;
  onPick: (kind: SectionKind) => void;
  onClose: () => void;
}) {
  return (
    <Modal title={positioned ? 'このページに入れる' : 'ページを足す'} onClose={onClose}>
      {job && (
        <p className="picker m-0 text-[13px] text-muted">
          {job.spare > 0
            ? `${PAPERS[print.paper].label}の${job.sheets}枚目に、あとリフィル${job.spare}${job.unit}ぶん入ります`
            : `いまちょうど${PAPERS[print.paper].label}${job.sheets}枚です。足すと紙が増えます`}
        </p>
      )}

      {/* A cover goes on the front, which is the only place a cover goes, so
          it is said here rather than left as five presses of ↑. */}
      {cover && (
        <Button variant="quiet" className="addcover justify-start" onClick={() => onPick('cover')}>
          <span className="inline-block h-5 w-[15px] rounded-[2px] border border-line-strong bg-white" />
          表紙
          <em className="not-italic text-muted">白紙1ページ・先頭に入ります</em>
        </Button>
      )}

      {SECTION_MENU.filter(g => !positioned || !g.run).map(group => (
        <span key={group.title} className="flex flex-col gap-1">
          <strong className="text-[13px] font-normal text-muted">{group.title}</strong>
          <span className="fillers grid grid-cols-2 gap-1.5">
            {group.kinds.map(kind => (
              <Button key={kind} variant="quiet" className="justify-start" onClick={() => onPick(kind)}>
                <StampIcon kind={kind as PartKind} />
                {SECTION_LABEL(kind)}
              </Button>
            ))}
          </span>
        </span>
      ))}

      <Button variant="quiet" className="makenew justify-start" onClick={() => onPick('blank')}>
        白紙（自分で作る）
      </Button>
      {onImport && (
        <Button variant="quiet" className="fromfile justify-start" onClick={onImport}>
          <FileGlyph />
          ファイルから取り込む
          <em className="not-italic text-muted">画像・PDF</em>
        </Button>
      )}
      <span className="text-[13px] leading-snug text-muted">
        {positioned
          ? '押した1ページに入ります。カレンダーは何ページにもなるので、「並びを整える」の「＋ 足す」から入れてください'
          : '足したものは最後（裏表紙の前）に入ります。表紙だけは先頭です。順番は ↑↓ で変えられます'}
      </span>
    </Modal>
  );
}

// The places on a printed sheet that nothing is going on, drawn over the
// sheet itself. The imposition centres the block and fills it in order, so
// the empty ones are the last places of the last sheet -- mirrored on a back,
// because that is what the paper does when it is turned over.
// Where one place on the printed sheet sits, as a fraction of the paper. The
// artwork is scaled about the paper's centre, so the places are too, or a mark
// would sit beside the square it names.
function placeStyle(
  plan: TilePlan, tile: { widthMm: number; heightMm: number },
  i: number, mirror: boolean, scalePercent: number,
) {
  const { paper, cols, sideMm, endMm } = plan;
  const k = scalePercent / 100;
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  const col = mirror ? cols - 1 - (i % cols) : i % cols;
  const row = Math.floor(i / cols);
  const at = (v: number, centre: number) => centre + (v - centre) * k;
  return {
    left: pct(at(sideMm + col * tile.widthMm, paper.widthMm / 2), paper.widthMm),
    top: pct(at(endMm + row * tile.heightMm, paper.heightMm / 2), paper.heightMm),
    width: pct(tile.widthMm * k, paper.widthMm),
    height: pct(tile.heightMm * k, paper.heightMm),
  };
}

// Which page of the book each place on the paper carries. A printed sheet
// comes out in an order nobody can hold in their head -- the back runs the
// other way across the paper, so the place that is page 3 on one side is
// page 4 on the other -- and the only way to check the two sides agree is to
// see the numbers on both. Screen only: the margin these would print in is
// what gets cut away, and on A5 there is none of it.
function PlaceNumbers({ plan, tile, count, mirror, scalePercent, numberOf, small }: {
  plan: TilePlan;
  tile: { widthMm: number; heightMm: number };
  count: number;
  mirror: boolean;
  scalePercent: number;
  numberOf: (place: number) => number;
  // A thumbnail's places are a finger wide, so the mark has to be smaller than
  // anything else on the screen to stay inside one.
  small?: boolean;
}) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className="faceno pointer-events-none absolute flex items-start justify-start"
          style={placeStyle(plan, tile, i, mirror, scalePercent)}
        >
          <em className={`rounded-[2px] bg-white/85 not-italic text-mark-text ${
            small ? 'm-px px-px text-[7px] leading-[9px]' : 'm-[3px] px-1 text-[13px] leading-4'
          }`}>{numberOf(i)}</em>
        </span>
      ))}
    </>
  );
}

function SpareSlots({ plan, tile, first, count, mirror, scalePercent, empty, onPress }: {
  plan: TilePlan;
  tile: { widthMm: number; heightMm: number };
  // The first place on this page to draw, and how many.
  first: number;
  count: number;
  mirror: boolean;
  scalePercent: number;
  // Whether these places are empty (a ＋) or carry something (what is on them).
  empty: boolean;
  onPress: (place: number) => void;
}) {
  return (
    <>
      {Array.from({ length: count }, (_, n) => {
        const i = first + n;
        return (
          <button
            key={i}
            className={`absolute flex items-center justify-center rounded-[2px] ${
              empty
                ? 'empty border border-dashed border-accent bg-accent-soft/70 text-[14px] text-accent-text'
                : 'onpaper border border-transparent hover:border-accent hover:bg-accent-soft/40'
            }`}
            style={placeStyle(plan, tile, i, mirror, scalePercent)}
            aria-label={empty ? 'ここにリフィルを足す' : 'このページについて'}
            onClick={e => { e.stopPropagation(); onPress(i); }}
          >{empty ? '＋' : ''}</button>
        );
      })}
    </>
  );
}

// What one place on the printed sheet is, and what can be done about it.
// "Too many weeklies" is noticed while looking at the paper, and the page
// being looked at is the one it should stop at -- so that is the button.
function PageSheet({ book, at, nth, onShorten, onDrop, onClose }: {
  book: Book;
  at: number;
  nth: number;
  onShorten: (i: number, to: Layout) => void;
  onDrop: (i: number) => void;
  onClose: () => void;
}) {
  const sec = book.sections[at];
  const cut = shortenTo(sec, nth + 1);
  return (
    <Modal title={sectionLabel(sec)} onClose={onClose}>
      <p className="pagewhat m-0 text-[13px] text-muted">
        このページは「{sectionLabel(sec)}」の{nth + 1}枚目・{sheetLabel(sec, nth)}
        （ぜんぶで{runText(sec)}）
      </p>
      {cut ? (
        <Button variant="quiet" className="cuthere" onClick={() => onShorten(at, cut)}>
          ここまでにする（{runText(sec)} → {runText(cut)}）
        </Button>
      ) : (
        <p className="m-0 text-[13px] leading-snug text-muted">
          これが最後の1枚です。短くするなら期間を変えてください
        </p>
      )}
      {book.sections.length > 1 && (
        <Button variant="quiet" className="dropsec" onClick={() => onDrop(at)}>
          このリフィルを外す
        </Button>
      )}
      <span className="text-[13px] leading-snug text-muted">
        日付のあるものは月の単位で短くなります（週の途中では終われないため）
      </span>
    </Modal>
  );
}

// One saved refill, small enough to sit in a list and big enough to tell a
// calendar from a memo.
function Thumb({ layout, size, side = 0, box = { w: 34, h: 46 }, ring = false, lazy = false }: {
  layout: Layout;
  size: SizeSpec;
  // Which page of the design: a spread has two, and in a list of pages they
  // are two different pictures.
  side?: number;
  box?: { w: number; h: number };
  // Marks the page the editor is on. The border rather than a tint, so the
  // drawing underneath stays the colour it will print.
  ring?: boolean;
  // Draw only once the picture is near the window. A book is a list of every
  // page it has, and building them all at once means building every day of
  // every month -- a year of monthlies is 26 sheets and half a second, and
  // most of that is counting six-day cycles nobody is looking at yet.
  lazy?: boolean;
}) {
  const mark = useRef<HTMLSpanElement | null>(null);
  const [near, setNear] = useState(!lazy);
  useLayoutEffect(() => {
    const el = mark.current;
    if (near || !el) return;
    const io = new IntersectionObserver(
      seen => { if (seen.some(e => e.isIntersecting)) setNear(true); },
      // A window ahead, so the picture is there before the scroll stops.
      { rootMargin: '400px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near]);

  // The room it takes is geometry alone -- no dates, no almanac -- so the
  // space can be held without drawing anything into it, and nothing jumps
  // when the drawing arrives.
  const geo = useMemo(() => buildGeometry(layout, size), [layout, size]);
  const shape = geo.pages[Math.min(side, geo.pages.length - 1)];
  const drawn = useMemo(
    () => (near ? buildPages(layout, size) : null),
    [near, layout, size],
  );
  if (!shape) return null;
  const scale = Math.min(box.w / shape.widthMm, box.h / shape.heightMm);
  const page = drawn?.[Math.min(side, drawn.length - 1)];
  return (
    <span
      ref={mark}
      className={`thumb block shrink-0 overflow-hidden rounded-[3px] border bg-white ${
        ring ? 'border-accent shadow-[0_0_0_1px_var(--color-accent)]' : 'border-line-strong'
      }`}
      style={{ width: shape.widthMm * scale, height: shape.heightMm * scale }}
    >
      {page && <PageSvg page={page} scale={scale} />}
    </span>
  );
}

function PartSheet({
  target, book, layout, setLayout, inline, onClose, onRemove, onRemoveSpanning, onLoad, onSave,
  size, onExport, print, setPrint, onAddSection, setBook, say, nth, onImport,
}: {
  onImport: () => void;
  target: Exclude<SheetTarget, null>;
  // Which sheet of the run is on screen: a per-page photo belongs to it.
  nth: number;
  // The whole book, because the paper carries all of it.
  book: Book;
  setBook: (fn: (b: Book) => Book) => void;
  layout: Layout;
  setLayout: (fn: (l: Layout) => Layout) => void;
  // Beside the paper rather than over it, on a screen with room for both.
  inline: boolean;
  onClose: () => void;
  onRemove: (slot: number) => void;
  onRemoveSpanning: () => void;
  onLoad: (b: Book) => void;
  onSave: (name: string) => void;
  size: SizeSpec;
  onExport: (opts: PrintOptions) => void;
  print: PrintOptions;
  setPrint: (fn: (p: PrintOptions) => PrintOptions) => void;
  // One more section, on the end of the book.
  onAddSection: (kind: SectionKind) => void;
  say: (message: string) => void;
}) {
  const lastMonth = addMonths(layout.year, layout.month, Math.max(1, layout.monthCount) - 1);
  const saved = useMemo(() => target === 'load' ? listBooks() : [], [target]);
  const job = usePaperJob(book.sections, size, print);
  const { also, perPaper } = job;
  // What this one section costs, for the period being set right here. The
  // chip above the paper says what the whole book comes to, but the sheet
  // covers that chip on a phone -- and the number that moves when the period
  // is stepped is this one.
  const mine = usePaperJob([layout], size, print);
  const runPaper = (
    <p className="run-paper m-0 text-[13px] text-muted">
      このリフィルだけで{PAPERS[print.paper].label}
      <strong className="mx-0.5 font-semibold text-muted">{mine.sheets}枚</strong>
      （リフィル{mine.used}{mine.unit}）
    </p>
  );
  // An empty place pressed on the printed sheet itself, and a filled one.
  const [pickHere, setPickHere] = useState(false);
  const [pageAt, setPageAt] = useState<number | null>(null);
  const kind = typeof target === 'string' ? null : layout.surface.placed[target.slot];
  // What the months actually come to, for the run this sheet is setting.
  const [firstDay, lastDay] = runDates(layout);
  // Worked out up front rather than on the tap: a spread already carrying
  // other parts may have no room for two calendars, and a choice that does
  // nothing when picked is worse than one that is not offered.
  const split = layout.spread && layout.spanning
    ? planPlacement(layout, size, ['monthly'], { sx: 0, sy: 0, band: 0 })
    : null;

  const title = target === 'load' ? '保存したリフィル'
    : target === 'save' ? '保存'
    : target === 'print' ? 'PDF出力プレビュー'
    : target === 'sheet' ? 'リフィル'
    : target === 'paper' ? '用紙'
    : target === 'background' ? '紙の背景'
    : target === 'look' ? '書体と色'
    : target === 'import' ? '取り込んだリフィル'
    : target === 'spanning' ? '見開きマンスリー'
    : kind ? PART_LABEL[kind] : 'パーツ';

  return (
    <Sheet title={title} onClose={onClose} inline={inline}>

        {target === 'background' && (
          <BackgroundSheet layout={layout} setLayout={setLayout} size={size} />
        )}

        {target === 'look' && <LookSheet layout={layout} setLayout={setLayout} />}
        {target === 'import' && layout.imported && <ImportedSheet layout={layout} setLayout={setLayout} size={size} />}

        {target === 'save' && (
          <SaveSheet book={book} size={size} grain={foldOf(layout, size)?.grain} onSave={onSave} />
        )}

        {/* A saved book, opened whole: its sections, its order, its paper.
            Half a book is not a thing anyone asked for. */}
        {target === 'load' && (
          saved.length === 0
            ? <p className="text-[14px] text-muted">まだ保存されていません</p>
            : <ul className="m-0 flex max-h-[22rem] list-none flex-col gap-1.5 overflow-y-auto p-0">
                {saved.map(b => (
                  <li key={b.id} className="flex items-center gap-2.5 rounded-[9px] border border-line-strong bg-white p-2">
                    <Thumb layout={b.sections[0]} size={SIZES[b.sections[0].size]} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px]">{b.name}</span>
                      <span className="block truncate text-[13px] text-muted">
                        {b.id === book.id ? '編集中・' : ''}{b.sections.map(sectionLabel).join(' → ')}
                      </span>
                    </span>
                    <Button variant="quiet" onClick={() => onLoad(b)}>開く</Button>
                    <Button variant="quiet" onClick={() => { deleteBook(b.id); onClose(); }}>削除</Button>
                  </li>
                ))}
              </ul>
        )}

        {/* The refill: which size of paper, and what form it takes. Both in
            one sheet because they depend on each other -- A5 has no three-panel
            fold, the L is 横長ミニ3穴 only -- and two chips would mean changing
            the size here and finding the form changed over there. Here the
            form cards redraw under the finger that changed the size. */}
        {target === 'sheet' && (
          <>
            <Field label="サイズ">
              <SizeCards
                selected={layout.size} wide={!!inline}
                onPick={s => setBook(b => ({
                  ...b, sections: b.sections.map(l => ({ ...l, size: s })),
                }))}
              />
            </Field>
            {/* The form is this section's, not the book's. A planner is
                mixed -- the monthly is a spread and the notes at the back are
                single sheets -- and the paper is the same either way, so a
                book binds both. The size above cannot be mixed: a sheet with
                different holes does not go in the same binder, which is why
                one of these cards changes the whole book and the other
                changes what the chip above says. The chip is what makes that
                readable: it names the section it belongs to
                （マンスリー ・ ミニ6 ・ 見開き）, so what is being changed is
                whatever the chip you pressed was describing.

                A cover has no form to choose -- it is one page whatever the
                book is -- so it gets no cards rather than cards that would
                lie about what they change. */}
            {!layout.cover && !layout.backCover && !layout.imported && (
              <FormCards
                size={layout.size}
                spread={layout.spread}
                fold={layout.fold}
                foldGrain={layout.foldGrain}
                wide={!!inline}
                onPick={v => setLayout(l => ({
                  ...l,
                  ...v,
                  // Born as one page to fill an empty page; asked for a form,
                  // it is an ordinary section of the book from now on.
                  single: undefined,
                  spanning: v.fold > 1 ? null : l.spanning,
                  surface: v.fold > 1
                    ? {
                        ...l.surface,
                        placed: l.surface.placed.slice(0, v.fold),
                        page: undefined, ratios: {}, fold: undefined,
                      }
                    : l.surface,
                }))}
              />
            )}
          </>
        )}

        {/* The paper itself: which one, and what else is going on it. Reached
            from a chip beside the design, because "I want to fill the sheet"
            is a thought someone has while looking at the design -- not one
            they have three screens into the export sheet. */}
        {target === 'paper' && (
          <>
            <Choice
              label="刷り方"
              options={[{ v: 'tile', label: '用紙にまとめる' }, { v: 'exact', label: '1枚ずつ' }]}
              value={print.impose ? 'tile' : 'exact'}
              onPick={v => setPrint(p => ({ ...p, impose: v === 'tile' }))}
            />
            {print.impose ? (
              <>
                <Choice
                  label="用紙"
                  options={PAPER_ORDER.map(v => ({ v, label: PAPERS[v].label }))}
                  value={print.paper}
                  onPick={v => setPrint(p => ({ ...p, paper: v as PaperId }))}
                />
                <p className="fill-note m-0 text-[13px] text-muted">
                  {PAPERS[print.paper].label} 1枚にリフィル{perPaper}{job.unit}・
                  ぜんぶで{job.used}{job.unit}（紙{job.sheets}枚）
                  {job.spare > 0
                    ? `・最後の紙にあと${job.spare}${job.unit}ぶん`
                    : '・あきはありません'}
                </p>
              </>
            ) : (
              <p className="m-0 text-[13px] leading-snug text-muted">
                1枚の紙に1枚ずつ刷る設定です。用紙にまとめると、1枚の紙に何枚ぶんも
                並べて刷れます
              </p>
            )}
          </>
        )}

        {target === 'print' && (
          <>
            <PrintPreview
              layout={layout} size={size} print={print} also={also} job={job}
              onPlus={() => setPickHere(true)}
              onPage={setPageAt}
            />
            {pageAt !== null && job.owners[pageAt] && (
              <PageSheet
                book={book} at={job.owners[pageAt].at} nth={job.owners[pageAt].nth}
                onShorten={(i, to) => {
                  setBook(b => ({ ...b, sections: b.sections.map((sec, k) => (k === i ? to : sec)) }));
                  setPageAt(null);
                  say(`${sectionLabel(to)}を${runText(to)}にしました`);
                }}
                onDrop={i => {
                  setBook(b => ({ ...b, sections: b.sections.filter((_, k) => k !== i) }));
                  setPageAt(null);
                  say('外しました');
                }}
                onClose={() => setPageAt(null)}
              />
            )}
            {pickHere && (
              <AddSection
                job={job} print={print}
                onPick={kind => { setPickHere(false); onAddSection(kind); }}
                onImport={() => { setPickHere(false); onImport(); }}
                onClose={() => setPickHere(false)}
              />
            )}

            {/* One picture to a screen. The squares to press are on the 用紙
                sheet; drawn here as well they read as a second preview of the
                same paper, below the real one, and the way to add got lost
                under it. What belongs here is the number that makes someone
                want to add -- and one press to where that is done. */}
            {print.impose && (
              <div className="spare flex flex-col gap-0.5">
                <p className="fill-note m-0 text-[13px] text-muted">
                  {PAPERS[print.paper].label} 1枚にリフィル{perPaper}{job.unit}・いま{job.used}{job.unit}（紙{job.sheets}枚）
                  {job.spare > 0
                    ? `・最後の紙にあと${job.spare}${job.unit}ぶん`
                    : '・あきはありません'}
                </p>
                {/* The number alone does not say what to do with it, and the
                    ＋ on the sheet is small. One sentence, beside the picture
                    it is about. */}
                {job.spare > 0 && (
                  <p className="fill-how m-0 text-[13px] text-accent-text">
                    あと{job.spare}{job.unit}入れられます。空きの ＋ をタップして入れてください
                  </p>
                )}
              </div>
            )}

            <Choice
              label="刷り方"
              options={[{ v: 'tile', label: '用紙にまとめる' }, { v: 'exact', label: '1枚ずつ' }]}
              value={print.impose ? 'tile' : 'exact'}
              onPick={v => setPrint(p => ({ ...p, impose: v === 'tile' }))}
            />
            {/* The paper decides the tiling and nothing else: a fold's panels
                are capped by A4 whatever is picked here, so a refill made in
                this app always prints on ordinary paper too. A3 and B4 are
                what a convenience store takes. */}
            {print.impose && (
              <Choice
                label="用紙"
                options={PAPER_ORDER.map(v => ({ v, label: PAPERS[v].label }))}
                value={print.paper}
                onPick={v => setPrint(p => ({ ...p, paper: v as PaperId }))}
              />
            )}

            {/* The browser's own paragraph margin, kept deliberately: it is the
                breathing room between the paper choice and the print options. */}
            <p className="print-summary my-[13px] text-[14px] text-muted">
              {hasDatedPart(layout) && `${layout.year}年${layout.month}月から${layout.monthCount}ヶ月分・`}
              {isDayPaced(layout) && `${sheetCount(layout)}枚・`}
              {print.impose && (layout.fold > 1
                ? `${PAPERS[print.paper].label} 1枚に ${perPaper} 本`
                : `${PAPERS[print.paper].label} 1枚に リフィル${perPaper}枚`)}
            </p>
            {print.impose && (
              <EdgeNote
                size={size}
                count={imposeCount(layout, size, print, also)}
                sheet={sheetSizeOf(layout, size)}
                paper={print.paper}
              />
            )}

            {/* 「片面」 means two things in this app -- a refill that is one
                page rather than a spread, and paper printed on one side -- so
                this one carries a name of its own for anything looking for
                it. What tells them apart on screen is the label above each. */}
            <span className="duplexpick block">
              <Choice
                label="印刷"
                options={[{ v: 'both', label: '両面印刷' }, { v: 'one', label: '片面印刷' }]}
                value={print.duplex ? 'both' : 'one'}
                onPick={v => setPrint(p => ({ ...p, duplex: v === 'both' }))}
              />
            </span>
            {/* Which way to turn the paper over is not a preference: get it
                wrong and every back lands on the wrong refill, or upside down,
                and there is no way to tell until the paper is out. It depends
                on how the refills ended up on the sheet, so it is worked out
                here and printed in the corner of the sheet as well. */}
            {print.duplex && print.impose && (
              <p className="duplex-note m-0 mb-[13px] text-[13px] text-muted">
                プリンタの両面設定は
                <strong className="font-semibold text-label">
                  {duplexFlipOf(layout, size, imposeCount(layout, size, print, also), print.paper)}
                </strong>
                。紙の隅にも刷ってあります
              </p>
            )}
            {print.duplex && (
              <Choice
                label="余った裏面に刷るもの"
                options={[
                  { v: 'blank', label: '白紙' },
                  { v: 'grid', label: '方眼' },
                  { v: 'lines', label: '罫線' },
                ]}
                value={print.backFill}
                onPick={v => setPrint(p => ({ ...p, backFill: v as BackFill }))}
              />
            )}

            <Choice
              label="穴の位置の目印"
              options={[{ v: 'on', label: '印刷する' }, { v: 'off', label: '印刷しない' }]}
              value={print.punchGuides ? 'on' : 'off'}
              onPick={v => setPrint(p => ({ ...p, punchGuides: v === 'on' }))}
            />

            <Field label="部数">
              <Stepper
                value={print.copies}
                onStep={n => setPrint(p => ({ ...p, copies: Math.min(24, Math.max(1, p.copies + n)) }))}
              />
            </Field>

            {print.impose && (
              <Choice
                label="切り取り線"
                options={[{ v: 'on', label: '入れる' }, { v: 'off', label: '入れない' }]}
                value={print.cutLines ? 'on' : 'off'}
                onPick={v => setPrint(p => ({ ...p, cutLines: v === 'on' }))}
              />
            )}

            {print.impose && (
              <Field label="大きさの微調整（刷ると穴の位置がずれるとき）">
                <Stepper
                  value={`${print.scalePercent.toFixed(1)}%`}
                  onStep={n => setPrint(p => ({
                    ...p,
                    scalePercent: Math.min(105, Math.max(95, +(p.scalePercent + n * 0.5).toFixed(1))),
                  }))}
                />
              </Field>
            )}

            <Button variant="cta" onClick={() => onExport(print)}>書き出す</Button>
          </>
        )}

        {/* A spread can carry the month two ways, and until now only one of
            them could be asked for: the first calendar dropped always became
            the band, and the two-months-facing form could be reached only by
            dropping a second calendar on top of the first. It is a property
            of the refill, so it is said here, where the calendar's other
            properties are. */}
        {layout.spread && (target === 'spanning' || kind === 'monthly')
          && (!layout.spanning || split) && (
          <Choice
            label="マンスリーの載せ方"
            options={[
              { v: 'span', label: '見開きで1ヶ月' },
              { v: 'page', label: '1ページに1ヶ月' },
            ]}
            value={layout.spanning ? 'span' : 'page'}
            onPick={v => {
              if ((v === 'span') === !!layout.spanning) return;
              if (v === 'page') { if (split) setLayout(() => split.layout); return; }
              setLayout(l => {
                const rest = l.surface.placed.filter(k => k !== 'monthly');
                return {
                  ...l,
                  // The band takes the whole spread when nothing else is on
                  // it, and the share a part would have left it otherwise --
                  // the same two numbers turning the refill uses.
                  spanning: { ratio: rest.length === 0 ? 1 : (isLandscape(l) ? 0.48 : 0.72) },
                  surface: { ...l.surface, placed: rest, ratios: {} },
                };
              });
            }}
          />
        )}

        {(target === 'spanning' || kind === 'monthly') && (
          <Choice
            label="週の始まり"
            options={[{ v: 1, label: '月曜始まり' }, { v: 0, label: '日曜始まり' }]}
            value={layout.weekStart}
            onPick={v => setLayout(l => ({ ...l, weekStart: v as 0 | 1 }))}
          />
        )}

        {/* The period belongs to every part the month decides the shape of,
            not to the calendar alone: a refill of day lists has a start month
            and a length just as much, and without these it printed one sheet
            with no way to say otherwise. */}
        {(target === 'spanning' || (kind && MONTH_PACED.includes(kind))) && (
          <>
            <Field label="開始月">
              <Stepper
                value={`${layout.year}年${layout.month}月`}
                onStep={n => setLayout(l => ({ ...l, ...addMonths(l.year, l.month, n) }))}
              />
            </Field>
            <Field label={`終了月（${layout.monthCount}ヶ月分・${sheetCount(layout)}枚）`}>
              <Stepper
                value={`${lastMonth.year}年${lastMonth.month}月`}
                onStep={n => setLayout(l => ({ ...l, monthCount: Math.min(36, Math.max(1, l.monthCount + n)) }))}
              />
            </Field>
            {runPaper}
          </>
        )}

        {/* One value, said where it is being looked at. The spread's band has
            one free cell and puts next month in it; a monthly on its own page
            has the cells after the last day, which fit last month as well. */}
        {((target === 'spanning' && !ringsOnTop(layout)) || kind === 'monthly') && (
          <Choice
            label={kind === 'monthly' ? '前後の月の小さなカレンダー' : '翌月のミニカレンダー'}
            options={[{ v: 'on', label: '入れる' }, { v: 'off', label: '入れない' }]}
            value={layout.showNextMonth ? 'on' : 'off'}
            onPick={v => setLayout(l => ({ ...l, showNextMonth: v === 'on' }))}
          />
        )}

        {kind === 'photo' && typeof target !== 'string' && (
          <PhotoField layout={layout} setLayout={setLayout} size={size} slot={target.slot} nth={nth} />
        )}

        {kind && layout.surface.placed.length >= 2 && (
          <Choice
            label="並べ方"
            options={[{ v: 'v', label: '左右に並べる' }, { v: 'h', label: '上下に並べる' }]}
            value={layout.surface.split}
            onPick={v => setLayout(l => ({ ...l, surface: { ...l.surface, split: v as 'h' | 'v' } }))}
          />
        )}

        {/* Only the vertical has hours on its other axis; the horizontal has
            free lanes, so there is nothing to bound. */}
        {kind === 'weekvert' && (
          <>
            <Choice
              label="日の並べ方"
              options={[{ v: 1, label: '1段' }, { v: 2, label: '2段' }]}
              value={layout.weekTiers >= 2 ? 2 : 1}
              onPick={v => setLayout(l => ({ ...l, weekTiers: v }))}
            />
            <Field label="始まりの時刻">
              <Stepper
                value={`${layout.dayStartHour}:00`}
                onStep={n => setLayout(l => ({
                  // One hour has to be left to draw, whichever end is moved.
                  ...l, dayStartHour: Math.min(l.dayEndHour - 1, Math.max(0, l.dayStartHour + n)),
                }))}
              />
            </Field>
            <Field label={`終わりの時刻（${layout.dayEndHour - layout.dayStartHour}時間）`}>
              <Stepper
                value={`${layout.dayEndHour}:00`}
                onStep={n => setLayout(l => ({
                  ...l, dayEndHour: Math.max(l.dayStartHour + 1, Math.min(24, l.dayEndHour + n)),
                }))}
              />
            </Field>
          </>
        )}

        {(kind === 'weekvert' || kind === 'weekhoriz') && (
          <>
            <Field label={layout.spread ? '見開き1枚に入れる日数' : '1ページに入れる日数'}>
              <Stepper
                value={`${layout.daysPerSheet}日`}
                onStep={n => setLayout(l => ({
                  ...l, daysPerSheet: Math.min(14, Math.max(1, l.daysPerSheet + n)),
                }))}
              />
            </Field>
            {/* Paced by days, so the run begins on a day. A month was too
                coarse to say it with: making a weekly on the 22nd and being
                handed the sheets back to the 31st of the month before is
                three weeks of paper nobody asked for. The step is one sheet,
                because that is the only amount a run can actually move by.

                The period is the monthly's control too, but a weekly refill
                may be the only thing on the sheet, and it still has to say
                which months it covers.

                The months are the control; they are not the answer. A sheet
                of whole weeks starts on the week holding the first of the
                month, so September's run begins in August, and it ends when
                the last sheet runs out rather than at the month's end. The
                dates underneath are what actually gets printed, and one of
                them contradicts the label above it -- which is exactly why
                it has to be on screen. */}
            <Field label={`開始日（${layout.daysPerSheet}日ずつ動きます）`}>
              <Stepper
                value={ymd(firstDay)}
                onStep={n => setLayout(l => startOn(l, addDays(firstDay, n * Math.max(1, l.daysPerSheet))))}
              />
            </Field>
            <Button
              variant="quiet"
              className="self-start"
              onClick={() => setLayout(l => startOn(l, new Date()))}
            >
              今日から
            </Button>
            <Field label={`終了月（${layout.monthCount}ヶ月分・${sheetCount(layout)}枚）`}>
              <Stepper
                value={`${lastMonth.year}年${lastMonth.month}月`}
                onStep={n => setLayout(l => ({ ...l, monthCount: Math.min(36, Math.max(1, l.monthCount + n)) }))}
              />
            </Field>
            <p className="run-dates m-0 text-[13px] text-muted">
              刷られるのは {ymd(firstDay)} 〜 {ymd(lastDay)}
            </p>
            {runPaper}
            <Choice
              label="週の始まり"
              options={[{ v: 1, label: '月曜始まり' }, { v: 0, label: '日曜始まり' }]}
              value={layout.weekStart}
              onPick={v => setLayout(l => ({ ...l, weekStart: v as 0 | 1 }))}
            />
          </>
        )}

        {kind === 'habit' && (
          <Field label="習慣の数">
            <Stepper
              value={layout.habitCount}
              onStep={n => setLayout(l => ({ ...l, habitCount: Math.min(8, Math.max(1, l.habitCount + n)) }))}
            />
          </Field>
        )}

        {kind === 'swatch' && (
          <>
            <Field label="枚数">
              <Stepper
                value={layout.swatchPer ?? 1}
                onStep={n => setLayout(l => ({ ...l, swatchPer: Math.min(8, Math.max(1, (l.swatchPer ?? 1) + n)) }))}
              />
            </Field>
            <Field label="書く行">
              <Stepper
                value={layout.swatchLines ?? 5}
                onStep={n => setLayout(l => ({ ...l, swatchLines: Math.min(12, Math.max(1, (l.swatchLines ?? 5) + n)) }))}
              />
            </Field>
            <Field label="ボトル">
              <Segmented
                options={[{ v: 'on', label: '描く' }, { v: 'off', label: '描かない' }]}
                value={layout.swatchBottle === false ? 'off' : 'on'}
                onPick={v => setLayout(l => ({ ...l, swatchBottle: v === 'on' }))}
              />
            </Field>
            {/* Off unless asked for: a collection that is already fifteen
                bottles deep does not start again at one. */}
            <Field label="番号">
              <Segmented
                options={[{ v: 'off', label: 'つけない' }, { v: 'on', label: 'つける' }]}
                value={layout.swatchNo ? 'on' : 'off'}
                onPick={v => setLayout(l => ({ ...l, swatchNo: v === 'on' }))}
              />
            </Field>
            {layout.swatchNo && (
              <Field label="始まりの番号">
                <Stepper
                  value={layout.swatchFrom ?? 1}
                  onStep={n => setLayout(l => ({ ...l, swatchFrom: Math.max(1, (l.swatchFrom ?? 1) + n) }))}
                />
              </Field>
            )}
            <p className="m-0 text-[13px] leading-snug text-muted">
              カード1枚で1本ぶん、名刺の大きさのまま並びます。名前も説明も手で書く
              ところなので、刷るのは枠だけです。余った紙は仕切りを動かして、メモや
              方眼に分けられます
            </p>
          </>
        )}

        {typeof target !== 'string' && (
          <Button variant="danger" onClick={() => onRemove(target.slot)}>このパーツを外す</Button>
        )}
        {target === 'spanning' && (
          <Button variant="danger" onClick={onRemoveSpanning}>このパーツを外す</Button>
        )}
    </Sheet>
  );
}

// Only the first few, because a year of refills is a lot of paper and the
// pattern is clear by the second sheet.
const PREVIEW_PAGES = 4;
// Big enough that a place on the sheet can be pressed. At 110 an A3 of twelve
// was 18px a place, which is a picture, not a control.
const PREVIEW_PX = 168;

// Imposed, duplexed sheets look like nonsense until you see them laid out and
// numbered. Showing them here means the options can be judged before anyone
// spends ink on them.
function PrintPreview({ layout, size, print, also, job, onPlus, onPage }: {
  layout: Layout; size: SizeSpec; print: PrintOptions; also: Layout[];
  job: PaperJob;
  onPlus: () => void;
  // A place on the paper that has something on it: which refill of which
  // section it is, and what can be done about it.
  onPage: (place: number) => void;
}) {
  const sheets = useMemo(
    () => buildPrintSheets(layout, size, print, also),
    [layout, size, print, also],
  );
  // A thumbnail is enough to see how the paper is laid out, not enough to read
  // a date, so any of them opens full size.
  const [open, setOpen] = useState<number | null>(null);
  // Four refills fit on one A4, so the whole sheet at phone width is too small
  // to read a date on. Tapping swaps between the whole sheet and a size you
  // can actually check.
  const [zoom, setZoom] = useState(false);
  const shown = sheets.slice(0, PREVIEW_PAGES);
  const label = (i: number) => print.duplex
    ? `${Math.floor(i / 2) + 1}枚目 ${i % 2 === 0 ? '表' : '裏'}`
    : `${i + 1}枚目`;
  const step = (n: number) => {
    setZoom(false);
    setOpen(o => (o === null ? null : Math.min(sheets.length - 1, Math.max(0, o + n))));
  };
  // The places nothing is going on, drawn on the sheet they are actually on:
  // the last one. A schematic of the same paper below this drawing was one
  // picture too many, and the printed sheet is the truer of the two.
  const tile = sheetSizeOf(layout, size);
  const lastSheet = Math.max(0, job.sheets - 1);
  // Printed at its own size the page IS the refill: one place, covering the
  // whole page, and none of the tiling's scaling about a paper's centre.
  const plan: TilePlan = print.impose ? job.plan : {
    paper: { widthMm: tile.widthMm, heightMm: tile.heightMm },
    cols: 1, rows: 1, perPage: 1, sideMm: 0, endMm: 0,
  };
  const scale = print.impose ? print.scalePercent : 100;
  const perPaper = print.impose ? job.perPaper : 1;
  // Which refill of the run each place on a page holds: the pages run in the
  // order the imposition laid them, so the sheet of paper a page belongs to
  // says where its places start.
  const pageStart = (i: number) => (print.duplex ? Math.floor(i / 2) : i) * perPaper;
  const placesOn = (i: number) => Math.max(0, Math.min(perPaper, job.used - pageStart(i)));
  // The page each place carries, counted the way the book is: page 1 is the
  // front of the first refill, page 2 its back. A second copy starts again --
  // it is the same book twice, not a book twice as long.
  const perCopy = Math.max(1, Math.round(job.used / Math.max(1, print.copies)));
  const pageNo = (i: number, place: number) => {
    const nth = (pageStart(i) + place) % perCopy;
    return print.duplex ? nth * 2 + (i % 2) + 1 : nth + 1;
  };
  const spareOn = (i: number) => (
    print.impose && job.spare > 0 && (print.duplex ? Math.floor(i / 2) : i) === lastSheet
      ? { mirror: print.duplex && i % 2 === 1 }
      : null
  );

  return (
    <Field label={`刷り上がり（全${sheets.length}ページ・タップで拡大）`}>
      <div className="preview flex gap-2.5 overflow-x-auto pb-1 pt-0.5">
        {shown.map((sheet, i) => (
          <figure key={i} className="m-0 flex shrink-0 flex-col items-center gap-1">
            {/* The ＋ sit over the sheet rather than inside the button that
                enlarges it: a button inside a button is not a thing, and the
                one on top is the one that should win anyway. */}
            <span className="relative block">
              <button className="block p-0" onClick={() => { setZoom(false); setOpen(i); }} aria-label={`${label(i)}を拡大`}>
                <SheetSvg sheet={sheet} boxPx={PREVIEW_PX} className="block rounded-sm border border-line-strong bg-white" />
              </button>
              <PlaceNumbers
                plan={plan} tile={tile} count={placesOn(i)}
                mirror={print.duplex && i % 2 === 1} scalePercent={scale}
                numberOf={place => pageNo(i, place)}
                small
              />
              {spareOn(i) && (
                <SpareSlots
                  plan={job.plan} tile={tile}
                  first={job.perPaper - job.spare} count={job.spare}
                  mirror={spareOn(i)!.mirror} scalePercent={print.scalePercent}
                  empty
                  onPress={onPlus}
                />
              )}
            </span>
            <figcaption className="whitespace-nowrap text-[13px] text-muted">{label(i)}</figcaption>
          </figure>
        ))}
        {sheets.length > shown.length && (
          <button
            className="flex min-h-[142px] w-[110px] shrink-0 items-center justify-center self-start rounded-sm border border-dashed border-line-strong text-center text-[13px] leading-[1.6] text-muted"
            onClick={() => { setZoom(false); setOpen(PREVIEW_PAGES); }}
          >
            ほか<br />{sheets.length - shown.length}ページ
          </button>
        )}
      </div>
      {/* The numbers are unexplained otherwise, and a coloured number on a
          drawing of paper reads as something that will be on the paper. The
          colour is not named, so changing --color-mark cannot make this lie. */}
      <p className="faceno-note m-0 text-[13px] leading-[1.7] text-muted">
        色の付いた番号はページの順番です（画面だけ・紙には刷りません）
      </p>
      {print.duplex && layout.spread && hasDatedPart(layout) && (
        <p className="m-0 text-[13px] leading-[1.7] text-muted">
          両面印刷で刷って、切り取ってから番号の順に重ねてください。
        </p>
      )}

      {open !== null && sheets[open] && (
        <div
          className="lightbox fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-[rgba(28,26,22,0.9)] px-4 pb-[18px] pt-[54px]"
          onClick={() => setOpen(null)}
        >
          <button
            className="absolute right-3.5 top-3 size-[34px] rounded-full bg-white/20 p-0 text-[18px] leading-[34px] text-white"
            onClick={() => setOpen(null)}
            aria-label="閉じる"
          >×</button>
          <div
            className={`overflow-auto rounded-sm bg-white ${
              zoom ? 'h-[calc(100dvh-128px)] w-[calc(100dvw-32px)]' : ''
            }`}
            onClick={e => { e.stopPropagation(); setZoom(z => !z); }}
          >
            {/* Both maxima with auto sizing, so the page shrinks to fit whichever
                runs out first and keeps its proportions. */}
            <span className="relative block">
              <SheetSvg
                sheet={sheets[open]}
                boxPx={1400}
                className={zoom
                  ? 'block w-[calc((100dvw-32px)*2.4)] max-w-none'
                  : 'block h-auto w-auto max-h-[calc(100dvh-128px)] max-w-[calc(100dvw-32px)]'}
              />
              {/* Every place on the enlarged sheet, not only the empty ones:
                  this is where someone looks to decide how much of a run they
                  actually want, so it is where a page says what it is and can
                  be cut back to. */}
              <SpareSlots
                plan={plan} tile={tile}
                first={0} count={placesOn(open)}
                mirror={print.duplex && open % 2 === 1} scalePercent={scale}
                empty={false}
                onPress={place => { setOpen(null); onPage(pageStart(open) + place); }}
              />
              {/* Over the buttons rather than inside them: the number is not
                  what is pressed, and a label that cannot be pressed cannot
                  swallow the press meant for the page under it. */}
              <PlaceNumbers
                plan={plan} tile={tile} count={placesOn(open)}
                mirror={print.duplex && open % 2 === 1} scalePercent={scale}
                numberOf={place => pageNo(open, place)}
              />
              {spareOn(open) && (
                <SpareSlots
                  plan={job.plan} tile={tile}
                  first={job.perPaper - job.spare} count={job.spare}
                  mirror={spareOn(open)!.mirror} scalePercent={print.scalePercent}
                  empty
                  onPress={() => { setOpen(null); onPlus(); }}
                />
              )}
            </span>
          </div>
          <div className="lightbox-bar flex items-center gap-3.5 text-[13px] text-white" onClick={e => e.stopPropagation()}>
            <Button variant="quiet" className="min-w-[52px] disabled:opacity-35" disabled={open === 0} onClick={() => step(-1)} aria-label="前へ">←</Button>
            <span className="flex flex-col items-center gap-0.5 text-center">
              {label(open)}　{open + 1}/{sheets.length}
              <em className="not-italic text-[13px] text-white/55">{zoom ? 'タップで全体' : 'タップで拡大'}</em>
            </span>
            <Button variant="quiet" className="min-w-[52px] disabled:opacity-35" disabled={open === sheets.length - 1} onClick={() => step(1)} aria-label="次へ">→</Button>
          </div>
        </div>
      )}
    </Field>
  );
}

// The design filling the glass. Fitting it is not enough on a phone, where the
// drawing is as wide as the screen already and taking the tray away buys
// nothing: the point of looking at it big is to look closer than the paper
// really is, so a tap goes past fit and the view scrolls. Nothing here is
// editable, which is what lets it scroll under a finger at all -- the editor's
// pages take the touch themselves.
const ZOOM_STEP = 2.5;

function ZoomView({ pages, flow, onClose }: {
  pages: Page[]; flow: 'row' | 'column'; onClose: () => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 320, h: 480 });
  const [big, setBig] = useState(false);
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const gapPx = (pages.length - 1) * GAP;
  const acrossMm = flow === 'row'
    ? pages.reduce((t, p) => t + p.widthMm, 0)
    : Math.max(...pages.map(p => p.widthMm));
  const downMm = flow === 'column'
    ? pages.reduce((t, p) => t + p.heightMm, 0)
    : Math.max(...pages.map(p => p.heightMm));
  const fit = Math.max(0.1, Math.min(
    (box.w - 24 - (flow === 'row' ? gapPx : 0)) / acrossMm,
    (box.h - 24 - (flow === 'column' ? gapPx : 0)) / downMm,
  ));
  const scale = big ? fit * ZOOM_STEP : fit;

  return (
    <div className="lightbox fixed inset-0 z-50 flex flex-col bg-[rgba(28,26,22,0.9)]">
      <button
        className="absolute right-3.5 top-3 z-10 size-[34px] rounded-full bg-white/20 p-0 text-[18px] leading-[34px] text-white"
        onClick={onClose}
        aria-label="閉じる"
      >×</button>
      <div className="flex min-h-0 grow overflow-auto p-3" ref={boxRef} onClick={onClose}>
        <div
          className="m-auto flex items-center justify-center"
          style={{ flexDirection: flow, gap: GAP }}
          onClick={e => { e.stopPropagation(); setBig(z => !z); }}
        >
          {pages.map((page, i) => (
            <div
              key={i}
              className="shrink-0 overflow-hidden rounded-sm bg-white shadow-[0_10px_30px_rgba(0,0,0,0.4)]"
            >
              <PageSvg page={page} scale={scale} showGuides />
            </div>
          ))}
        </div>
      </div>
      <p className="zoom-hint m-0 pb-[18px] text-center text-[13px] text-white/55">
        {big ? '紙をタップで全体・外をタップで閉じる' : '紙をタップでさらに拡大・外をタップで閉じる'}
      </p>
    </div>
  );
}

// Kept as a name because every setting reads as one, but it is only the
// shared Field and Segmented underneath.
function Choice<T extends string | number>({ label, options, value, onPick }: {
  label: string;
  options: { v: T; label: string }[];
  value: T;
  onPick: (v: T) => void;
}) {
  return (
    <Field label={label}>
      <Segmented options={options} value={value} onPick={onPick} />
    </Field>
  );
}
