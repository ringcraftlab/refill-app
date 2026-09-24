import { Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  Background, BackgroundKind, Book, DateWords, FoldCount, FoldGrain, InkTone, Layout, PartKind,
  RefillSize, RuleWeight, SizeSpec,
} from './types';
import { MAX_PARTS, SCHEMA_VERSION } from './types';
import { holeCentres, SIZES } from './lib/sizes';
import {
  buildGeometry, foldMaxParts, foldOf, isLandscape, MAX_RATIO, MIN_RATIO,
  photosOf, placeParts as planPlacement, regionAt, removeFromFold, ringsOnTop,
} from './lib/layout';
import type { Divider, DropPoint, Geometry, PageGeometry } from './lib/layout';
import type { Page } from './lib/draw';
import { BACKGROUND_COLORS } from './lib/background';
import { paletteOf, RULE_WEIGHT_ORDER, RULE_WEIGHTS, TONE_ORDER, TONES } from './lib/palette';
import { importPhoto, PHOTO_WARN_BYTES, photoBytes } from './lib/photo';
import { FOLD_PANELS, foldGrainsOf, foldPanels, foldPlan } from './lib/fold';
import type { FoldPlan } from './lib/fold';
import { nextMonthCell } from './lib/parts';
import { addDays, addMonths, isoDate, runDates } from './lib/dates';
import {
  buildPages, buildPrintSheets, datedSlotOf, DEFAULT_PRINT, hasDatedPart, INK_INSET_MM, isDayPaced,
  duplexFlipOf, imposeCount, MONTH_PACED, paperPlan, punchInset, runEnd, sameSheet, sheetCount,
  sheetSizeOf,
} from './lib/render/pages';
import type { BackFill, PrintOptions } from './lib/render/pages';
import type { TilePlan } from './lib/render/impose';
import { PAPER_ORDER, PAPERS } from './lib/render/impose';
import type { PaperId } from './lib/render/impose';
import { PageSvg, SheetSvg } from './lib/render/svg';
import { downloadPdf, sheetsToPdf } from './lib/render/pdf';
import { deleteBook, listBooks, newId, saveBook, storeRevision } from './lib/storage';
import { Button } from './ui/Button';
import { Field, Segmented, Stepper } from './ui/Field';
import { Dialog, Modal, Sheet, Toast } from './ui/Overlay';

type Stage = 'size' | 'sides' | 'contents' | 'canvas';
// A rectangle on screen, in the page area's own pixels.
type Box = { key: string; left: number; top: number; width: number; height: number };
type SheetTarget = { slot: number } | 'spanning' | 'load' | 'save' | 'print' | 'paper' | 'background' | 'look' | null;

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
const CANVAS_SCREEN = `${SCREEN} lg:max-w-[1440px] lg:flex-row`;
const WIDE = '(min-width: 1024px)';

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
const PICK_SCREEN = `${SCREEN_PAD} lg:max-w-[1000px]`;

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
  photo: '写真',
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
type SectionKind = PartKind | 'blank';

function sectionOf(kind: SectionKind, base: Layout): Layout {
  const sheet: Layout = {
    ...createLayout(),
    size: base.size,
    spread: base.spread,
    fold: base.fold,
    foldGrain: base.foldGrain,
    orientation: base.orientation,
    year: base.year,
    month: base.month,
    monthCount: base.monthCount,
    weekStart: base.weekStart,
    words: base.words,
    tone: base.tone,
    ruleWeight: base.ruleWeight,
    pages: 1,
  };
  if (kind === 'blank') return sheet;
  return {
    ...sheet,
    name: PART_LABEL[kind],
    surface: { ...sheet.surface, placed: [kind] },
  };
}

// What a section is called in the contents: what is on it, which is what
// anyone scanning a list of them is looking for.
function sectionLabel(l: Layout): string {
  const parts = [
    ...(l.spanning ? ['マンスリー'] : []),
    ...l.surface.placed.map(k => PART_LABEL[k]),
  ];
  return parts.length ? parts.slice(0, 3).join('＋') : '白紙';
}

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

export function App() {
  const [stage, setStage] = useState<Stage>('size');
  const [book, setBook] = useState<Book>(createBook);
  // Which section the editor is on. The contents screen is what moves it.
  const [at, setAt] = useState(0);
  // The paper is the book's, not a section's: everything in it is printed in
  // one run, on one kind of paper.
  const [print, setPrint] = useState<PrintOptions>(DEFAULT_PRINT);
  // Size and form belong to the book: a section on a different punched sheet
  // could not be bound into it. They are kept on every section because that
  // is all `src/lib` knows how to read.
  const every = (fn: (l: Layout) => Layout) =>
    setBook(b => ({ ...b, sections: b.sections.map(fn) }));

  if (stage === 'size') {
    return (
      <SizeScreen
        selected={book.sections[0].size}
        onPick={(size) => { every(l => ({ ...l, size })); setStage('sides'); }}
      />
    );
  }
  if (stage === 'sides') {
    return (
      <SidesScreen
        size={book.sections[0].size}
        spread={book.sections[0].spread}
        fold={book.sections[0].fold}
        foldGrain={book.sections[0].foldGrain}
        onPick={(v) => every(l => ({
          ...l,
          ...v,
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
        onBack={() => setStage('size')}
        onConfirm={() => { setAt(0); setStage('canvas'); }}
      />
    );
  }
  if (stage === 'contents') {
    return (
      <ContentsScreen
        book={book}
        setBook={setBook}
        print={print}
        at={Math.min(at, book.sections.length - 1)}
        onOpen={(i: number) => { setAt(i); setStage('canvas'); }}
        onBack={() => setStage('sides')}
      />
    );
  }
  return (
    <CanvasScreen
      book={book}
      at={Math.min(at, book.sections.length - 1)}
      setBook={setBook}
      onBack={() => setStage('contents')}
      goTo={setAt}
      print={print}
      setPrint={setPrint}
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
const SHEET_SLOT = {
  width: Math.max(...Object.values(SIZES).map(s => s.widthMm)) * SHEET_SCALE,
  height: Math.max(...Object.values(SIZES).map(s => s.heightMm)) * SHEET_SCALE,
};

// A colour per size, spread around the wheel rather than clustered: the four
// common sizes take four plain hues, and the rest fill the gaps. Muted enough
// to still look like paper on the warm background.
const SIZE_TINT: Record<RefillSize, { fill: string; line: string }> = {
  M5: { fill: '#F2D2C4', line: '#C2765A' },
  M6: { fill: '#F8E4BC', line: '#C09442' },
  BIBLE: { fill: '#D2E1F2', line: '#6B8FB8' },
  A5: { fill: '#E0D9F2', line: '#7C6FB0' },
  MINI3: { fill: '#CCE4E1', line: '#4F948D' },
  CARD3: { fill: '#D9E8CB', line: '#74965A' },
  M5SQ: { fill: '#E6DAC8', line: '#9C8058' },
  NARROW: { fill: '#F0D4E2', line: '#AD6A8F' },
  A5SLIM: { fill: '#E3DBDB', line: '#8E7B7B' },
};
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
  (emWidth(name) > 4.5 ? 'text-[10px] min-[360px]:text-[11px]' : 'text-[13px]');

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
// is one wide soft shadow in the colour and then the card's own, which stays
// so a selected card still sits on the page rather than floating off it.
const CARD_SHADOW = '0 1px 3px rgba(58,54,46,0.07)';
const cardSkin = (on: boolean, line: string) =>
  ({
    borderColor: on ? line : 'var(--color-line)',
    background: '#fff',
    boxShadow: on ? `0 0 22px 6px ${line}5C, ${CARD_SHADOW}` : CARD_SHADOW,
  }) as const;

// The paper is in millimetres and scaled as a whole to fit the box -- that is
// what makes this read as a sheet rather than as a box with dots on it -- but
// the pen that draws it is not. A 0.8mm line is 0.46px wide on M5 and 0.21px
// on A5, so the bigger the sheet the fainter its own outline, and A5 came out
// as a wash with no edge and no visible punch at all. `pen` turns a thickness
// on screen back into millimetres, which gives all nine sheets one line.
const OUTLINE_PX = 1.2;
const HOLE_RING_PX = 0.9;
// The punch shrinks the same way: 5.5mm on A5 is a 0.7px dot. A hole keeps
// its true size wherever that still reads, and stops shrinking below a dot
// that does -- never past three quarters of the margin it sits in, or it
// would break out through the edge of the paper it is punched in.
const HOLE_MIN_PX = 1;

function SizeIcon({ size, tint, flip = false }: {
  size: SizeSpec; tint: { fill: string; line: string }; flip?: boolean;
}) {
  const k = SHEET_SCALE;
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
  return (
    <svg
      width={size.widthMm * k} height={size.heightMm * k}
      viewBox={`0 0 ${size.widthMm} ${size.heightMm}`}
      className="block shrink-0"
      aria-hidden="true"
    >
      <rect
        x={inset} y={inset}
        width={size.widthMm - inset * 2} height={size.heightMm - inset * 2}
        rx={pen(2)} fill={tint.fill} stroke={tint.line} strokeWidth={pen(OUTLINE_PX)}
      />
      {holeCentres(size.holes).map((at, i) => (
        <circle
          key={i}
          cx={onTop ? at : band} cy={onTop ? band : at}
          r={hole}
          fill="#fff" stroke={tint.line} strokeWidth={pen(HOLE_RING_PX)}
        />
      ))}
    </svg>
  );
}

function SizeScreen({ selected, onPick }: { selected: RefillSize; onPick: (s: RefillSize) => void }) {
  const wide = useWide();
  return (
    <div className={PICK_SCREEN}>
      <div className="text-[13px] font-bold tracking-[0.04em] text-muted">RingCraftLab</div>
      <div>
        <h1 className="text-[19px] font-bold">手帳のサイズを選ぶ</h1>
        <p className="m-0 mt-1 text-[12px] text-muted">お使いの手帳のサイズを選んでください</p>
      </div>
      {/* The list starts under the heading rather than floating in the middle
          of the screen, and `mb-auto` keeps it there whether or not it
          overflows -- `justify-center` on a scrolling column would push the
          first row above the scroll origin, where nothing can reach it. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mb-auto flex w-full flex-col gap-3 py-0.5">
          {SIZE_GROUPS.map(group => (
            <section key={group.title} className="flex flex-col gap-1.5">
              <h2 className="m-0 text-[11px] font-bold tracking-[0.04em] text-muted">{group.title}</h2>
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
                        className="sizerow flex min-w-0 items-center gap-1 rounded-[18px] border-[1.5px] py-2 pl-1.5 pr-1 text-left"
                        style={cardSkin(selected === id, SIZE_TINT[id].line)}
                        aria-pressed={selected === id}
                      >
                        {/* A colour a glance can learn the size by, before
                            the name is read, and as tall as the row: the one
                            fixed-height thing on a card whose every other
                            part is to scale looked like a mistake. */}
                        <span
                          className="w-[5px] shrink-0 self-stretch rounded-full"
                          style={{ background: SIZE_TINT[id].line }}
                        />
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <strong className={`truncate font-semibold leading-tight ${nameSize(SIZE_NAME[id])}`}>
                            {SIZE_NAME[id]}
                          </strong>
                          <span className="truncate text-[10px] leading-tight text-faint">
                            {sizeMm(SIZES[id])}
                          </span>
                          {/* In the size's own colour, which is the one place
                              that colour carries a fact rather than a label:
                              the sizes sharing a hole count are the sizes
                              whose sheets swap between binders. */}
                          <span
                            className="truncate text-[10px] font-semibold leading-tight"
                            style={{ color: SIZE_TINT[id].line }}
                          >
                            {sizeHoles(SIZES[id])}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center justify-center" style={SHEET_SLOT}>
                          <SizeIcon size={SIZES[id]} tint={SIZE_TINT[id]} />
                        </span>
                        {/* Decoration: it says "this opens something", which
                            the button already says, so it stays out of the
                            name a screen reader reads -- and off a 320px
                            screen entirely. It and its gap cost 9px of the
                            135px card, which at that width is the difference
                            between "148×210mm" and "148×210m…", and the
                            millimetres are the only clue left to someone who
                            does not know the names. */}
                        <span aria-hidden="true" className="hidden shrink-0 text-[13px] leading-none text-faint min-[360px]:block">›</span>
                      </button>
                    )
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
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
function SidesScreen({ size, spread, fold, foldGrain, onPick, onBack, onConfirm }: {
  size: RefillSize;
  spread: boolean;
  fold: FoldCount;
  foldGrain?: FoldGrain;
  onPick: (v: { spread: boolean; fold: FoldCount; foldGrain?: FoldGrain }) => void;
  onBack: () => void; onConfirm: () => void;
}) {
  const spec = SIZES[size];
  const tint = SIZE_TINT[size];
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
      note: `広げて${plan.sheetWmm}×${plan.sheetHmm}mm`,
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
  const picked = [...choices, ...special].find(c => c.on);

  const card = (choice: Choice) => (
    <button
      key={choice.key}
      className="card flex flex-col items-center gap-2 rounded-[18px] border-[1.5px] px-2 py-3 text-center"
      style={cardSkin(choice.on, tint.line)}
      aria-pressed={choice.on}
      onClick={() => onPick(choice.pick)}
    >
      <span className="flex items-center justify-center gap-[3px]" style={{ height: SHEET_SLOT.height }}>
        {choice.plan
          ? <FoldIcon size={spec} tint={tint} plan={choice.plan} />
          : choice.sheets!.map((flip, i) => (
            <SizeIcon key={i} size={spec} tint={tint} flip={flip} />
          ))}
      </span>
      <span className="flex flex-col gap-0.5">
        <strong className="text-[13px] font-semibold leading-tight">{choice.title}</strong>
        <span className="text-[10px] leading-tight text-faint">{choice.note}</span>
      </span>
    </button>
  );

  return (
    <div className={PICK_SCREEN}>
      <Button variant="chip" className="self-start" onClick={onBack}>
        <span className="text-[13px] leading-none">←</span>
        サイズを選び直す
      </Button>
      <div>
        <h1 className="text-[19px] font-bold">ページ構成を選ぶ</h1>
        <p className="m-0 mt-1 text-[12px] text-muted">
          {SIZE_NAME[size]}（{sizeMm(spec)}・{sizeHoles(spec)}）のリフィルを作ります
        </p>
      </div>
      {/* Side by side, on the same two-column grid as the picker. A comparison
          reads across, not down: stacked, these were the same drawing seen
          twice in a row instead of one beside the other. Which also settles
          the shape of the card -- half the screen is too narrow to set a title
          beside the paper, so the paper goes on top and the words underneath.
          Every card keeps one box the height of the largest sheet, so a folded
          strip and a pair of pages are drawn to the same scale. */}
      <div className="grid grid-cols-2 gap-1.5 lg:grid-cols-4">
        {choices.map(choice => card(choice))}
      </div>
      {special.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div>
            <h2 className="m-0 text-[13px] font-semibold">特殊蛇腹（L字）</h2>
            <p className="m-0 mt-0.5 text-[10px] leading-snug text-faint">
              {`${SIZE_NAME[size]}だけの形。折り目がリングと直角なので、`
                + `内側の面は綴じ側を${special[0].plan!.insetMm}mm切り落とします`}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-1.5 lg:grid-cols-4">
            {special.map(choice => card(choice))}
          </div>
        </div>
      )}
      {/* What the fold costs, under the cards rather than inside one: it is the
          number you check before printing, and it changes with the panel count
          the card above just set. */}
      {picked?.plan && (
        <p className="fold-note m-0 text-[11px] leading-snug text-muted">
          穴は先頭の面だけ。内側の面は
          {picked.plan.paperCapped
            ? `${picked.plan.innerMm}mm（紙で決まり。リングの逃げなら${picked.plan.innerCapMm.toFixed(1)}mmまで）`
            : `${picked.plan.innerMm}mm（リングの逃げで決まり）`}
          。畳むと先頭の面に隠れます
        </p>
      )}
      <Button variant="cta" className="mt-auto" onClick={onConfirm}>この構成で作る</Button>
    </div>
  );
}

// The strip a fold unfolds into, drawn at the picker's scale so it can be
// compared with the pages above it. Only the first panel is punched, and the
// creases are where the paper actually bends.
function FoldIcon({ size, tint, plan }: {
  size: SizeSpec; tint: { fill: string; line: string }; plan: FoldPlan;
}) {
  const k = SHEET_SCALE;
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
  return (
    <svg
      width={W * k} height={H * k}
      viewBox={`0 0 ${W} ${H}`}
      className="block shrink-0"
      aria-hidden="true"
    >
      {down ? (
        <path d={outline} fill={tint.fill} stroke={tint.line} strokeWidth={pen(OUTLINE_PX)} strokeLinejoin="round" />
      ) : (
        <rect
          x={line} y={line}
          width={W - line * 2} height={H - line * 2}
          rx={pen(2)} fill={tint.fill} stroke={tint.line} strokeWidth={pen(OUTLINE_PX)}
        />
      )}
      {panels.slice(1).map(p => (
        <line
          key={p.atMm}
          x1={down ? cut : p.atMm} y1={down ? p.atMm : 0}
          x2={down ? W : p.atMm} y2={down ? p.atMm : H}
          stroke={tint.line} strokeWidth={pen(OUTLINE_PX * 0.8)} strokeDasharray={`${pen(3)} ${pen(2.4)}`}
        />
      ))}
      {holeCentres(size.holes).map((at, i) => (
        <circle
          key={i}
          cx={margin} cy={at} r={hole}
          fill="#fff" stroke={tint.line} strokeWidth={pen(HOLE_RING_PX)}
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
      <p className="edge-note m-0 mb-[13px] text-[12px] text-faint">
        外周に{Math.floor(Math.min(plan.sideMm, plan.endMm))}mm余ります。端まで刷る必要はありません
      </p>
    );
  }
  // The binding edge runs down the side of every size the app carries, so a
  // size whose left and right reach the paper is the only one whose punch
  // guide is in the firing line.
  const onEdge = tight.includes('左右') ? punchInset(size) : INK_INSET_MM;
  return (
    <p className="edge-note m-0 mb-[13px] text-[12px] text-faint">
      <span className="font-semibold text-label">{tight.join('と')}は紙の端まで使います。</span>
      お使いのプリンタの余白が{onEdge.toFixed(onEdge < 4 ? 2 : 1)}mmより広いと、
      {tight.includes('左右') ? '穴ガイドの外側' : '中身の外周'}がそのぶん欠けます
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
function ContentsScreen({ book, setBook, print, at, onOpen, onBack }: {
  book: Book;
  setBook: (fn: (b: Book) => Book) => void;
  print: PrintOptions;
  // Which section the editor was on, so that going back goes back.
  at: number;
  onOpen: (i: number) => void;
  onBack: () => void;
}) {
  const size = SIZES[book.sections[0].size];
  const job = usePaperJob(book.sections, size, print);
  const [adding, setAdding] = useState(false);
  const [ask, setAsk] = useState<number | null>(null);

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
      <header className="flex shrink-0 items-center gap-2 pb-1 pt-1 text-xs font-semibold text-label">
        <Button variant="icon" onClick={onBack} aria-label="戻る">←</Button>
        <span className="min-w-0 truncate">
          {size.label} {size.widthMm}×{size.heightMm}mm
          <span className="mx-1.5 text-faint">・</span>
          {formLabel(book.sections[0], foldOf(book.sections[0], size)?.grain)}
        </span>
      </header>
      <h1 className="m-0 mb-1 text-[19px]">中身</h1>

      <ul className="contents-list m-0 flex min-h-0 list-none flex-col gap-1.5 overflow-y-auto p-0">
        {book.sections.map((sec, i) => (
          <li
            key={i}
            className="section flex items-center gap-2.5 rounded-[11px] border border-line-strong bg-white p-2"
          >
            <button className="flex min-w-0 flex-1 items-center gap-2.5 p-0 text-left" onClick={() => onOpen(i)}>
              <Thumb layout={sec} size={size} />
              <span className="min-w-0 flex-1">
                <span className="secname block truncate text-[14px]">{sectionLabel(sec)}</span>
                <span className="secspan block text-[11px] text-faint">{sectionSpan(sec)}</span>
              </span>
            </button>
            {/* A note section is "how many sheets of it", and that is the
                number someone changes when it turns out to be too many. A
                dated one is as long as its dates, which the range in the
                editor sets. */}
            {!hasDatedPart(sec) && (
              <span className="pages flex shrink-0 items-center gap-1">
                <Button
                  variant="icon"
                  onClick={() => setPages(i, -1)}
                  aria-label="減らす"
                >−</Button>
                <strong className="min-w-[2.2rem] text-center text-[12px]">
                  {Math.max(1, sec.pages ?? 1)}枚
                </strong>
                <Button variant="icon" onClick={() => setPages(i, 1)} aria-label="増やす">＋</Button>
              </span>
            )}
            <span className="flex shrink-0 flex-col gap-0.5">
              {i > 0 && <Button variant="icon" onClick={() => move(i, -1)} aria-label="上へ">↑</Button>}
              {i < book.sections.length - 1 && (
                <Button variant="icon" onClick={() => move(i, 1)} aria-label="下へ">↓</Button>
              )}
            </span>
            {book.sections.length > 1 && (
              <Button variant="icon" onClick={() => setAsk(i)} aria-label="外す">×</Button>
            )}
          </li>
        ))}
      </ul>

      <Button variant="quiet" className="addsection mt-1.5" onClick={() => setAdding(true)}>
        ＋ 中身を足す
      </Button>

      {/* What the whole book comes to on paper. The number that makes someone
          want to shorten something is this one, so it is here rather than
          three screens away. */}
      <p className="fill-note m-0 mt-auto pt-2 text-[12px] text-muted">
        {print.impose
          ? `${PAPERS[print.paper].label} ${job.sheets}枚・この束で${job.used}${job.unit}` +
            (job.spare > 0 ? `・最後の紙にあと${job.spare}${job.unit}ぶん` : '・あきはありません')
          : `原寸 ${job.used}${job.unit}`}
      </p>

      <div className="flex shrink-0 gap-2 pb-1 pt-1.5">
        <Button variant="cta" className="flex-1" onClick={() => onOpen(at)}>編集にもどる</Button>
      </div>

      {adding && (
        <AddSection
          job={job} print={print}
          onPick={kind => {
            setAdding(false);
            setBook(b => ({ ...b, sections: [...b.sections, sectionOf(kind, b.sections[0])] }));
            if (kind === 'blank') onOpen(book.sections.length);
          }}
          onClose={() => setAdding(false)}
        />
      )}
      {ask !== null && (
        <Dialog
          message={`「${sectionLabel(book.sections[ask])}」を中身から外しますか`}
          confirmLabel="外す"
          onConfirm={() => { drop(ask); setAsk(null); }}
          onCancel={() => setAsk(null)}
        />
      )}
    </div>
  );
}

// How long a section runs, in its own terms: months for a monthly, weeks for
// a weekly, sheets for a note. This is the number someone shortens when it
// turns out to be too much.
function sectionSpan(l: Layout): string {
  const n = sheetCount(l);
  if (!hasDatedPart(l)) return `${n}枚`;
  const end = runEnd(l);
  return `${l.year}年${l.month}月 → ${end.year}年${end.month}月・${n}枚`;
}

function CanvasScreen({ book, at, setBook, onBack, goTo, print, setPrint }: {
  book: Book; at: number; setBook: (fn: (b: Book) => Book) => void;
  onBack: () => void;
  // Editing a different section of the same book -- adding one lands here too.
  goTo: (i: number) => void;
  // The paper belongs to the book, so it is held above this screen.
  print: PrintOptions;
  setPrint: (fn: (p: PrintOptions) => PrintOptions) => void;
}) {
  // The section being edited. Everything below this line is written against
  // one refill, exactly as it was before books existed.
  const layout = book.sections[at];
  const setLayout = (fn: (l: Layout) => Layout) => setBook(b => ({
    ...b,
    sections: b.sections.map((sec, i) => (i === at ? fn(sec) : sec)),
  }));
  const size = SIZES[layout.size];
  const geo = useMemo(() => buildGeometry(layout, size), [layout, size]);
  const pages = useMemo(() => buildPages(layout, size), [layout, size]);

  const [traySelected, setTraySelected] = useState<PartKind[]>([]);
  const [sheet, setSheet] = useState<SheetTarget>(null);
  const [toast, setToast] = useState('');
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

  const say = (text: string) => {
    setToast(text);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 1800);
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

  const placeParts = (kinds: PartKind[], at: DropPoint | null) => {
    setLayout(prev => {
      const planned = planPlacement(prev, size, kinds, at);
      if (!planned) {
        const what = kinds.length === 1 ? PART_LABEL[kinds[0]] : 'パーツ';
        // A fold has no draggable borders to make room with: the creases are
        // where the paper bends. Either a panel is free or it is not.
        const folded = foldOf(prev, size);
        say(folded && prev.surface.placed.length >= foldMaxParts(folded.panels)
          ? `1面に2つまでです。外してから置いてください`
          : `${what}を置く広さがありません。つまみで空けてください`);
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
      return planned.layout;
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
      return { ...prev, surface: { ...prev.surface, placed, photos } };
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
          ...prev.surface, placed, photos, ratios: {},
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
      : `原寸 ${sheets.length}枚を書き出しました`);
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

  const empty = layout.surface.placed.length === 0 && !layout.spanning;

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
      book={book}
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
      onAddSection={kind => {
        setBook(b => ({ ...b, sections: [...b.sections, sectionOf(kind, layout)] }));
        setSheet(null);
        if (kind === 'blank') {
          goTo(book.sections.length);
          say('中身を作ってください');
        } else {
          say(`${PART_LABEL[kind]}を1枚足しました`);
        }
      }}
      say={say}
    />
  );

  return (
    <div className={CANVAS_SCREEN}>
      {/* The paper's side of a wide screen; the whole screen on a narrow one,
          where the tools below are simply the next rows of the same column. */}
      <div className="flex min-h-0 min-w-0 grow flex-col">
      {/* Turning belongs up here rather than over the paper. A folded strip
          turned a quarter turn fills the drawing area top to bottom, and a
          button floating in its corner sat on the refill itself. */}
      <header className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-3 text-xs font-semibold text-label">
        <Button variant="icon" onClick={onBack} aria-label="戻る">←</Button>
        {/* The two buttons keep their room; the name gives way. A long size
            name pushing them off the edge is worse than a name cut short. */}
        <span className="min-w-0 truncate">
          {size.label}
          {/* What gives way, in order, as the screen narrows: the millimetres
              first, then the words on the two chips. The form the refill is
              folded into never does -- on a phone it is what the title is
              for, and the picker cannot be consulted afterwards. The chips
              hold on to their words the longest they can, because a button
              nobody recognises is a feature nobody finds. */}
          <span className="hidden min-[400px]:inline"> {size.widthMm}×{size.heightMm}mm</span>
          {' ・ '}{formLabel(layout, foldNow?.grain)}
        </span>
        {/* Below 360px even these give up their words: what they were pushing
            out of the title is worth more. The icons stay, and so do the
            labels a screen reader reads. */}
        <Button variant="chip" className="rotate ml-auto" onClick={turn} aria-label="リフィルを回転">
          <span className="text-[13px] leading-none">↻</span>
          <span className="hidden min-[360px]:inline">{turnLabel}</span>
        </Button>
        <Button variant="chip" className="magnify" onClick={() => setZoomed(true)} aria-label="大きく見る">
          <span className="text-[13px] leading-none">⤢</span>
          <span className="hidden min-[360px]:inline">大きく</span>
        </Button>
      </header>

      {/* The design filling the glass, to check rather than to edit. Editing
          needs the tray and the borders, which are what make the drawing small
          in the first place; taking them away is the whole point of this. */}
      {zoomed && (
        <ZoomView pages={pages} flow={geo.flow} onClose={() => setZoomed(false)} />
      )}

      {/* What the whole refill is, rather than what one part is: the months it
          covers and the ground it prints on. Above the paper, because both are
          design decisions and neither belongs inside the export sheet. */}
      <div className="mb-0.5 ml-3.5 mr-3 flex shrink-0 flex-wrap items-center gap-1.5 self-start">
      {dated && (
        <button
          className="range flex shrink-0 items-center gap-2 rounded-full border border-line-strong bg-white px-3 py-1.5 text-[11px] text-ink"
          onClick={() => setSheet(monthlyTarget)}
        >
          {byDay
            ? `${ymd(firstDay)} → ${ymd(lastDay)}`
            : `${layout.year}年${layout.month}月 → ${lastMonth.year}年${lastMonth.month}月`}
          {/* Months and sheets stop being the same number as soon as a sheet
              carries two calendars, and which one matters depends on what is
              being decided, so both are said when they differ. */}
          <em className="not-italic text-faint">
            {byDay ? `${sheetCount(layout)}枚`
              : sheetCount(layout) === layout.monthCount ? `${layout.monthCount}ヶ月分`
              : `${layout.monthCount}ヶ月分・${sheetCount(layout)}枚`}
          </em>
        </button>
      )}
        {/* The sheet of paper: which one, how many of them, and how much of
            the last one stays empty. The emptiness is what makes anyone want
            to put something else on it, so it is said before it is asked
            for -- and the chip opens the picture where that is done. */}
        <Button variant="chip" className="paper" onClick={() => setSheet('paper')}>
          <span className="text-[13px] leading-none">▭</span>
          {print.impose
            ? `${PAPERS[print.paper].label} ${job.sheets}枚`
            : `${PAPERS[print.paper].label} 原寸`}
          {print.impose && job.spare > 0 && (
            <em className="not-italic text-accent">あと{job.spare}{job.unit}ぶん</em>
          )}
        </Button>
        <Button variant="chip" onClick={() => setSheet('background')}>
          <span className="text-[13px] leading-none">▦</span>
          {BACKGROUND_LABEL[layout.background?.kind ?? 'none']}
        </Button>
        {/* The chip is the sample. It says the words it is set to, in the ink
            it is set to, so what the体裁 is can be read without opening it --
            which is the whole reason this is not a gear icon. */}
        <Button
          variant="chip"
          className="look"
          onClick={() => setSheet('look')}
          style={{ color: cssColor(paletteOf(layout).ink) }}
        >
          <span className="text-[13px] font-semibold leading-none">Aa</span>
          {WORD_SAMPLE[layout.words ?? 'mix']}
        </Button>
      </div>

      <div className="relative flex min-h-0 grow items-center justify-center px-3 py-2" ref={boxRef}>
        <div
          className="flex items-center justify-center"
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
                  ? 'shadow-[0_10px_30px_rgba(58,54,46,0.10)]'
                  : 'rounded-sm shadow-[0_10px_30px_rgba(58,54,46,0.16)]'
              }`}
              style={{
                width: pageW(i), height: pageH(i),
                clipPath: notchClip(pg),
                filter: pg.notch ? 'drop-shadow(0 6px 14px rgba(58,54,46,0.14))' : undefined,
              }}
            >
              <PageSvg page={pages[i]} scale={scale} showGuides />
              {pg.spanRect && (
                <button
                  className="hitbox absolute cursor-pointer p-0 hover:bg-[rgba(193,115,74,0.05)]"
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
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-center text-[11px] leading-[1.7] text-faint">
              スタンプをドラッグして<br />ここに配置
            </div>
          )}

          {preview?.map(b => (
            <div
              key={`preview-${b.key}`}
              className="pointer-events-none absolute z-[3] rounded-[3px] border-[1.5px] border-accent/55 bg-accent-soft/55"
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
                className={`hitbox part absolute cursor-grab touch-none p-0 hover:bg-[rgba(193,115,74,0.05)] active:cursor-grabbing active:bg-[rgba(193,115,74,0.08)] ${
                  waiting ? 'flex items-center justify-center rounded-[3px] border border-dashed border-line-strong' : ''
                }`}
                style={{ left: b.left, top: b.top, width: b.width, height: b.height }}
                onPointerDown={e => startDrag(e, [layout.surface.placed[b.slot]], b.slot)}
                onPointerMove={moveDrag}
                onPointerUp={e => endPartDrag(e, b.slot)}
                title={PART_LABEL[layout.surface.placed[b.slot]]}
              >
                {waiting && (
                  <span className="photo-empty pointer-events-none rounded-full bg-white/85 px-2 py-1 text-[10px] text-muted">
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

      {/* Which of the book this is. One section is the ordinary case and says
          nothing; from two on, "which one am I editing" is a real question. */}
      {book.sections.length > 1 && (
        <button
          className="alsonote m-0 shrink-0 px-3.5 pt-1 text-left text-[10px] text-accent"
          onClick={onBack}
        >
          中身 {at + 1}／{book.sections.length}・{book.sections.map(sectionLabel).join(' → ')}
        </button>
      )}

      <p className={`m-0 shrink-0 px-3.5 py-1 text-[10px] ${
        traySelected.length > 0 || teachDivider ? 'text-accent' : 'text-faint'
      }`}>
        {teachDivider
          ? 'つまみをドラッグすると、パーツの広さを変えられます'
          : traySelected.length > 0
            ? `${traySelected.length}個選択中：紙をタップすると置けます`
            : 'タップで選ぶ → 紙をタップ。ドラッグでも置けます'}
      </p>
      </div>

      {/* The tools. Under the paper on a phone, beside it on a desktop, and
          the same blocks in the same order either way. */}
      <aside className="flex min-h-0 shrink-0 flex-col lg:w-[340px] lg:border-l lg:border-line lg:bg-paper">

      {/* The row is wider than the screen, and until now nothing said so: it
          ran off the edge with no sign that there was more, and could not be
          swiped either. The arrow appears only on the side that has more to
          come, and goes when that side runs out. */}
      <div className="relative shrink-0 border-t border-line bg-paper lg:border-t-0">
        <div
          ref={el => { trayRef.current = el; readTrayEdges(); }}
          onScroll={readTrayEdges}
          // On a desktop the tray and the settings share one column, and the
          // tray is the one that can give way: it is a palette that is always
          // there, while the settings are what was just asked for. Without
          // this the thirteen stamps took the whole column and the settings
          // were a 200px slot at the bottom -- open the photo settings and
          // the button to choose a picture was below the fold.
          className={`flex gap-2.5 overflow-x-auto px-3 pb-2.5 pt-2 lg:grid lg:grid-cols-3 lg:overflow-x-visible lg:px-4 lg:pt-4 ${
            sheetEl ? 'lg:max-h-[34vh] lg:overflow-y-auto' : ''
          }`}
        >
        {TRAY.map(t => {
          const idx = traySelected.indexOf(t.kind);
          return (
            <button
              key={t.kind}
              // `pan-x`, not `none`: sideways belongs to the tray, every other
              // direction belongs to the part being lifted out of it.
              className={`stamp relative flex w-[60px] shrink-0 cursor-grab touch-pan-x flex-col items-center gap-[3px] rounded-xl border-[1.5px] py-[8px] text-[9px] font-semibold active:cursor-grabbing lg:w-full lg:gap-1 lg:py-3 lg:text-[11px] ${
                idx >= 0
                  ? 'border-accent bg-accent-soft'
                  : 'border-line bg-white hover:border-line-strong hover:shadow-[0_2px_8px_rgba(58,54,46,0.12)]'
              }`}
              onPointerDown={e => startDrag(e, idx >= 0 && traySelected.length > 1 ? [...traySelected] : [t.kind], null)}
              onPointerMove={moveDrag}
              onPointerCancel={cancelDrag}
              onPointerUp={e => endTrayDrag(e, t.kind)}
            >
              {idx >= 0 && (
                <i className="absolute -right-[5px] -top-[5px] size-[17px] rounded-full bg-accent text-[9px] not-italic leading-[17px] text-white">
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

      <div className="flex shrink-0 gap-2 bg-paper px-3 pb-3.5 pt-2 lg:mt-auto lg:border-t lg:border-line lg:px-4 lg:pt-3">
        <Button onClick={() => setSheet('load')}>読み込み</Button>
        {/* Named on the way in. Everything saved used to be called 新しい
            リフィル, which is no name at all once there are three of them --
            and putting several on one sheet of paper means reading that list
            and picking. */}
        <Button onClick={() => setSheet('save')}>保存</Button>
        <Button variant="actionWide" onClick={() => setSheet('print')}>PDF出力プレビュー</Button>
      </div>
      </aside>

      {ghost && (
        <div
          className="pointer-events-none fixed z-40 -translate-x-1/2 -translate-y-[140%] whitespace-nowrap rounded-[20px] bg-ink px-3 py-[7px] text-[11px] text-white"
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
function PhotoField({ layout, setLayout, size, slot }: {
  layout: Layout; setLayout: (fn: (l: Layout) => Layout) => void; size: SizeSpec; slot: number;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState('');
  // Which picture has actually finished painting, so the thumbnail can wait
  // for it rather than showing an empty frame.
  const [shown, setShown] = useState('');
  const [failed, setFailed] = useState('');
  const src = layout.surface.photos?.[slot] ?? null;
  // The area this stamp actually occupies on the paper, which is what the
  // picture has to be big enough for -- a stamp on a quarter of a Micro5 does
  // not need the pixels a full A5 does.
  const box = useMemo(() => {
    const region = buildGeometry(layout, size).surface.regions[slot];
    return region ? { w: region.w, h: region.h } : { w: size.widthMm, h: size.heightMm };
  }, [layout, size, slot]);

  const set = (next: string | null) => setLayout(l => {
    const photos = photosOf(l.surface);
    photos[slot] = next;
    return { ...l, surface: { ...l.surface, photos } };
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
        <p className="m-0 text-[11px] text-muted">{busy || '読み込み中…'}</p>
      )}
      {failed && <p className="photo-failed m-0 text-[11px] leading-snug text-danger">{failed}</p>}
      {src ? (
        <p className={`photo-size m-0 text-[11px] ${bytes > PHOTO_WARN_BYTES ? 'text-danger' : 'text-faint'}`}>
          {`${Math.round(bytes / 1024)}KB。刷る大きさ（${Math.round(box.w)}×${Math.round(box.h)}mm）に合わせて縮めてあります`}
          {bytes > PHOTO_WARN_BYTES && '。これより大きいと保存が通らないことがあります'}
        </p>
      ) : (
        <p className="m-0 text-[11px] leading-snug text-faint">
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
function LookSheet({ layout, setLayout }: {
  layout: Layout; setLayout: (fn: (l: Layout) => Layout) => void;
}) {
  const words = layout.words ?? 'mix';
  const tone = layout.tone ?? 'sepia';
  const weight = layout.ruleWeight ?? 'normal';
  const pal = paletteOf(layout);
  const plain = words === 'mix' && tone === 'sepia' && weight === 'normal';

  return (
    <>
      <Field label="日付の言葉">
        <Segmented
          options={(['ja', 'mix', 'en'] as DateWords[]).map(v => ({ v, label: WORD_SAMPLE[v] }))}
          value={words}
          onPick={v => setLayout(l => ({ ...l, words: v as DateWords }))}
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
                className={`flex flex-1 flex-col items-center gap-1 rounded-[9px] border-2 bg-white py-2 text-[10px] ${
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

      <p className="m-0 text-[11px] leading-snug text-faint">
        日曜と土曜の色は体裁では変わりません。日曜が赤いのは好みではなく決まりごとなので、
        色みに合わせて変えると意味がなくなります
      </p>

      {!plain && (
        <Button
          variant="quiet"
          className="self-start"
          onClick={() => setLayout(l => ({ ...l, words: undefined, tone: undefined, ruleWeight: undefined }))}
        >
          体裁を元に戻す
        </Button>
      )}
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
      <Field label="敷くもの">
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
          {busy && <p className="m-0 text-[11px] text-muted">{busy}</p>}
          {bg.src && (
            <p className={`photo-size m-0 text-[11px] ${bytes > PHOTO_WARN_BYTES ? 'text-danger' : 'text-faint'}`}>
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

      <p className="m-0 text-[11px] leading-snug text-faint">
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
      className={`${hook} absolute z-[5] size-4 rounded-full bg-[rgba(58,54,46,0.34)] p-0 text-[10px] leading-4 text-white hover:bg-[rgba(58,54,46,0.55)] active:bg-[rgba(58,54,46,0.7)]`}
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
      <i className={`block rounded-sm bg-line-strong group-hover:bg-accent group-active:bg-accent ${
        horizontal ? 'h-[3px] w-full' : 'h-full w-[3px]'
      }`} />
      <b className={`absolute flex items-center justify-center gap-0.5 rounded-[7px] border bg-white shadow-[0_1px_3px_rgba(58,54,46,0.18)] group-hover:border-accent group-active:border-accent ${
        horizontal ? 'h-[13px] w-[34px] flex-col' : 'h-[34px] w-[13px]'
      } ${teach ? 'animate-knob border-accent' : 'border-line-strong'}`}>
        {[0, 1].map(i => (
          <span key={i} className={`block rounded-[1px] group-hover:bg-accent group-active:bg-accent ${
            horizontal ? 'h-[1.5px] w-[14px]' : 'h-[14px] w-[1.5px]'
          } ${teach ? 'bg-accent' : 'bg-faint'}`} />
        ))}
      </b>
    </div>
  );
}

// A name someone would recognise a week later, made of what the book is: its
// size, its form, and what is in it. Better than 新しい束 and better than
// making someone think of one before they can save.
function suggestName(book: Book, size: SizeSpec, grain?: FoldGrain): string {
  const what = book.sections.map(sectionLabel).slice(0, 3).join('＋');
  return `${size.label} ${formLabel(book.sections[0], grain)}・${what}`;
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
          className="savename w-full rounded-[9px] border border-line-strong bg-white px-3 py-[11px] text-[13px]"
          value={name}
          autoFocus
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onSave(name.trim() || suggestName(book, size, grain)); }}
        />
      </Field>
      <p className="m-0 text-[11px] leading-snug text-faint">
        束はまとめて保存されます。中身の順番も、用紙も、
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
  const used = imposeCount(first, size, print, rest);
  const plan = paperPlan(size, used, sheetSizeOf(first, size), print.paper);
  const perPaper = plan.perPage;
  // What the last sheet has left over. Zero when it comes out even, which is
  // worth saying too: it stops the reader looking for room that is not there.
  const spare = perPaper > 0 ? (perPaper - (used % perPaper)) % perPaper : 0;
  const sheets = perPaper > 0 ? Math.ceil(used / perPaper) : 0;
  // Which section owns each place on the paper, in the order the imposition
  // lays them down: the book's sections, in order, each one whole. This is
  // what lets a page on the printed sheet say what it is.
  const owners = useMemo(() => {
    const out: { at: number; nth: number }[] = [];
    sections.forEach((l, at) => {
      const n = imposeCount(l, size, print);
      for (let nth = 0; nth < n; nth++) out.push({ at, nth });
    });
    return out;
  }, [sections, size, print]);
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
const FILLERS: PartKind[] = ['lines', 'grid', 'memo'];

function AddSection({ job, print, onPick, onClose }: {
  job: PaperJob;
  print: PrintOptions;
  onPick: (kind: SectionKind) => void;
  onClose: () => void;
}) {
  return (
    <Modal title="中身を足す" onClose={onClose}>
      <p className="picker m-0 text-[12px] text-muted">
        {job.spare > 0
          ? `${PAPERS[print.paper].label}の${job.sheets}枚目に、あとリフィル${job.spare}${job.unit}ぶん入ります`
          : `いまちょうど${PAPERS[print.paper].label}${job.sheets}枚です。足すと紙が増えます`}
      </p>
      <span className="fillers grid grid-cols-2 gap-1.5">
        {[...FILLERS, 'blank' as const].map(kind => (
          <Button
            key={kind}
            variant="quiet"
            className="justify-start"
            onClick={() => onPick(kind)}
          >
            {kind === 'blank' ? '白紙' : PART_LABEL[kind]} 1{job.unit}
          </Button>
        ))}
      </span>
      <Button variant="cta" className="makenew" onClick={() => onPick('blank')}>
        自分で作る
      </Button>
      <span className="text-[10px] leading-snug text-faint">
        白紙のセクションを足して、そのまま中身を作ります
      </span>
    </Modal>
  );
}

// The places on a printed sheet that nothing is going on, drawn over the
// sheet itself. The imposition centres the block and fills it in order, so
// the empty ones are the last places of the last sheet -- mirrored on a back,
// because that is what the paper does when it is turned over.
function SpareSlots({ plan, tile, spare, mirror, scalePercent, onPress }: {
  plan: TilePlan;
  tile: { widthMm: number; heightMm: number };
  spare: number;
  mirror: boolean;
  scalePercent: number;
  onPress: () => void;
}) {
  const { paper, cols, perPage, sideMm, endMm } = plan;
  const k = scalePercent / 100;
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  return (
    <>
      {Array.from({ length: spare }, (_, n) => {
        const i = perPage - spare + n;
        const col = mirror ? cols - 1 - (i % cols) : i % cols;
        const row = Math.floor(i / cols);
        // The artwork is scaled about the paper's centre, so the places are
        // too, or the ＋ would sit beside the squares it names.
        const at = (v: number, centre: number) => centre + (v - centre) * k;
        const x = at(sideMm + col * tile.widthMm, paper.widthMm / 2);
        const y = at(endMm + row * tile.heightMm, paper.heightMm / 2);
        return (
          <button
            key={i}
            className="empty absolute flex items-center justify-center rounded-[2px] border border-dashed border-accent bg-accent-soft/70 text-[13px] text-accent"
            style={{
              left: pct(x, paper.widthMm),
              top: pct(y, paper.heightMm),
              width: pct(tile.widthMm * k, paper.widthMm),
              height: pct(tile.heightMm * k, paper.heightMm),
            }}
            aria-label="ここにリフィルを追加する"
            onClick={onPress}
          >＋</button>
        );
      })}
    </>
  );
}

// One saved refill, small enough to sit in a list and big enough to tell a
// calendar from a memo.
function Thumb({ layout, size }: { layout: Layout; size: SizeSpec }) {
  const page = useMemo(() => buildPages(layout, size)[0], [layout, size]);
  if (!page) return null;
  const scale = Math.min(34 / page.widthMm, 46 / page.heightMm);
  return (
    <span className="thumb block shrink-0 overflow-hidden rounded-[3px] border border-line-strong bg-white">
      <PageSvg page={page} scale={scale} />
    </span>
  );
}

function PartSheet({
  target, book, layout, setLayout, inline, onClose, onRemove, onRemoveSpanning, onLoad, onSave,
  size, onExport, print, setPrint, onAddSection, say,
}: {
  target: Exclude<SheetTarget, null>;
  // The whole book, because the paper carries all of it.
  book: Book;
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
  // An empty place pressed on the printed sheet itself.
  const [pickHere, setPickHere] = useState(false);
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
    : target === 'paper' ? '用紙'
    : target === 'background' ? '紙の背景'
    : target === 'look' ? '体裁'
    : target === 'spanning' ? '見開きマンスリー'
    : kind ? PART_LABEL[kind] : 'パーツ';

  return (
    <Sheet title={title} onClose={onClose} inline={inline}>

        {target === 'background' && (
          <BackgroundSheet layout={layout} setLayout={setLayout} size={size} />
        )}

        {target === 'look' && <LookSheet layout={layout} setLayout={setLayout} />}

        {target === 'save' && (
          <SaveSheet book={book} size={size} grain={foldOf(layout, size)?.grain} onSave={onSave} />
        )}

        {/* A saved book, opened whole: its sections, its order, its paper.
            Half a book is not a thing anyone asked for. */}
        {target === 'load' && (
          saved.length === 0
            ? <p className="text-[13px] text-faint">まだ保存されていません</p>
            : <ul className="m-0 flex max-h-[22rem] list-none flex-col gap-1.5 overflow-y-auto p-0">
                {saved.map(b => (
                  <li key={b.id} className="flex items-center gap-2.5 rounded-[9px] border border-line-strong bg-white p-2">
                    <Thumb layout={b.sections[0]} size={SIZES[b.sections[0].size]} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px]">{b.name}</span>
                      <span className="block truncate text-[10px] text-faint">
                        {b.id === book.id ? '編集中・' : ''}{b.sections.map(sectionLabel).join(' → ')}
                      </span>
                    </span>
                    <Button variant="quiet" onClick={() => onLoad(b)}>開く</Button>
                    <Button variant="quiet" onClick={() => { deleteBook(b.id); onClose(); }}>削除</Button>
                  </li>
                ))}
              </ul>
        )}

        {/* The paper itself: which one, and what else is going on it. Reached
            from a chip beside the design, because "I want to fill the sheet"
            is a thought someone has while looking at the design -- not one
            they have three screens into the export sheet. */}
        {target === 'paper' && (
          <>
            <Choice
              label="刷り方"
              options={[{ v: 'tile', label: '用紙にまとめる' }, { v: 'exact', label: '原寸のまま' }]}
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
                <p className="fill-note m-0 text-[12px] text-muted">
                  {PAPERS[print.paper].label} 1枚にリフィル{perPaper}{job.unit}・
                  この束で{job.used}{job.unit}（紙{job.sheets}枚）
                  {job.spare > 0
                    ? `・最後の紙にあと${job.spare}${job.unit}ぶん`
                    : '・あきはありません'}
                </p>
              </>
            ) : (
              <p className="m-0 text-[12px] leading-snug text-faint">
                原寸のまま刷る設定です。用紙にまとめると、1枚の紙に何枚ぶんも
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
            />
            {pickHere && (
              <AddSection
                job={job} print={print}
                onPick={kind => { setPickHere(false); onAddSection(kind); }}
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
                <p className="fill-note m-0 text-[12px] text-muted">
                  {PAPERS[print.paper].label} 1枚にリフィル{perPaper}{job.unit}・いま{job.used}{job.unit}（紙{job.sheets}枚）
                  {job.spare > 0
                    ? `・最後の紙にあと${job.spare}${job.unit}ぶん`
                    : '・あきはありません'}
                </p>
                {/* The number alone does not say what to do with it, and the
                    ＋ on the sheet is small. One sentence, beside the picture
                    it is about. */}
                {job.spare > 0 && (
                  <p className="fill-how m-0 text-[12px] text-accent">
                    あと{job.spare}{job.unit}入れられます。空きの ＋ をタップして入れてください
                  </p>
                )}
              </div>
            )}

            <Choice
              label="刷り方"
              options={[{ v: 'tile', label: '用紙にまとめる' }, { v: 'exact', label: '原寸のまま' }]}
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
            <p className="print-summary my-[13px] text-[13px] text-faint">
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

            <Choice
              label="印刷"
              options={[{ v: 'both', label: '両面' }, { v: 'one', label: '片面' }]}
              value={print.duplex ? 'both' : 'one'}
              onPick={v => setPrint(p => ({ ...p, duplex: v === 'both' }))}
            />
            {/* Which way to turn the paper over is not a preference: get it
                wrong and every back lands on the wrong refill, or upside down,
                and there is no way to tell until the paper is out. It depends
                on how the refills ended up on the sheet, so it is worked out
                here and printed in the corner of the sheet as well. */}
            {print.duplex && print.impose && (
              <p className="duplex-note m-0 mb-[13px] text-[12px] text-faint">
                プリンタの両面設定は
                <strong className="font-semibold text-label">
                  {duplexFlipOf(layout, size, imposeCount(layout, size, print, also), print.paper)}
                </strong>
                。紙の隅にも刷ってあります
              </p>
            )}
            {print.duplex && (
              <Choice
                label="裏面（使わない面）"
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
              label="穴ガイド"
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
              <Field label="倍率補正（刷って穴位置がずれるとき）">
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
            label="マンスリーの持たせ方"
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
            <Field label={`終了月（${layout.monthCount}ヶ月分）`}>
              <Stepper
                value={`${lastMonth.year}年${lastMonth.month}月`}
                onStep={n => setLayout(l => ({ ...l, monthCount: Math.min(36, Math.max(1, l.monthCount + n)) }))}
              />
            </Field>
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
          <PhotoField layout={layout} setLayout={setLayout} size={size} slot={target.slot} />
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
            <p className="run-dates m-0 text-[11px] text-faint">
              刷られるのは {ymd(firstDay)} 〜 {ymd(lastDay)}
            </p>
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
function PrintPreview({ layout, size, print, also, job, onPlus }: {
  layout: Layout; size: SizeSpec; print: PrintOptions; also: Layout[];
  job: PaperJob;
  onPlus: () => void;
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
              {spareOn(i) && (
                <SpareSlots
                  plan={job.plan} tile={tile} spare={job.spare}
                  mirror={spareOn(i)!.mirror} scalePercent={print.scalePercent}
                  onPress={onPlus}
                />
              )}
            </span>
            <figcaption className="whitespace-nowrap text-[10px] text-muted">{label(i)}</figcaption>
          </figure>
        ))}
        {sheets.length > shown.length && (
          <button
            className="flex min-h-[142px] w-[110px] shrink-0 items-center justify-center self-start rounded-sm border border-dashed border-line-strong text-center text-[10px] leading-[1.6] text-faint"
            onClick={() => { setZoom(false); setOpen(PREVIEW_PAGES); }}
          >
            ほか<br />{sheets.length - shown.length}ページ
          </button>
        )}
      </div>
      {print.duplex && layout.spread && hasDatedPart(layout) && (
        <p className="m-0 text-[10px] leading-[1.7] text-faint">
          見開きは左ページが必ず裏面に来るので、最初の表と最後の裏だけが余ります。
          そのまま両面で刷って、切り取って順に重ねてください。
        </p>
      )}

      {open !== null && sheets[open] && (
        <div
          className="lightbox fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-[rgba(28,26,22,0.9)] px-4 pb-[18px] pt-[54px]"
          onClick={() => setOpen(null)}
        >
          <button
            className="absolute right-3.5 top-3 size-[34px] rounded-full bg-white/20 p-0 text-[17px] leading-[34px] text-white"
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
              {spareOn(open) && (
                <SpareSlots
                  plan={job.plan} tile={tile} spare={job.spare}
                  mirror={spareOn(open)!.mirror} scalePercent={print.scalePercent}
                  onPress={() => { setOpen(null); onPlus(); }}
                />
              )}
            </span>
          </div>
          <div className="lightbox-bar flex items-center gap-3.5 text-xs text-white" onClick={e => e.stopPropagation()}>
            <Button variant="quiet" className="min-w-[52px] disabled:opacity-35" disabled={open === 0} onClick={() => step(-1)} aria-label="前のページ">←</Button>
            <span className="flex flex-col items-center gap-0.5 text-center">
              {label(open)}　{open + 1}/{sheets.length}
              <em className="not-italic text-[10px] text-white/55">{zoom ? 'タップで全体' : 'タップで拡大'}</em>
            </span>
            <Button variant="quiet" className="min-w-[52px] disabled:opacity-35" disabled={open === sheets.length - 1} onClick={() => step(1)} aria-label="次のページ">→</Button>
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
        className="absolute right-3.5 top-3 z-10 size-[34px] rounded-full bg-white/20 p-0 text-[17px] leading-[34px] text-white"
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
      <p className="zoom-hint m-0 pb-[18px] text-center text-[11px] text-white/55">
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
