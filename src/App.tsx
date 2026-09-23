import { Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { FoldCount, Layout, PartKind, RefillSize, SizeSpec } from './types';
import { MAX_PARTS, SCHEMA_VERSION } from './types';
import { holeCentres, SIZES } from './lib/sizes';
import {
  buildGeometry, foldMaxParts, foldOf, isLandscape, MAX_RATIO, MIN_RATIO,
  placeParts as planPlacement, regionAt, removeFromFold, ringsOnTop,
} from './lib/layout';
import type { Divider, DropPoint, Geometry, PageGeometry } from './lib/layout';
import type { Page } from './lib/draw';
import { FOLD_PANELS, foldPanels, foldPlan } from './lib/fold';
import type { FoldPanels, FoldPlan } from './lib/fold';
import { nextMonthCell } from './lib/parts';
import { addDays, addMonths, isoDate, runDates } from './lib/dates';
import {
  buildPages, buildPrintSheets, datedSlotOf, DEFAULT_PRINT, hasDatedPart, INK_INSET_MM, isDayPaced,
  duplexFlipOf, imposeCount, MONTH_PACED, paperPlan, punchInset, runEnd, sheetCount, sheetSizeOf,
} from './lib/render/pages';
import type { BackFill, PrintOptions } from './lib/render/pages';
import { PageSvg, SheetSvg } from './lib/render/svg';
import { downloadPdf, sheetsToPdf } from './lib/render/pdf';
import { deleteLayout, listLayouts, newId, saveLayout } from './lib/storage';
import { Button } from './ui/Button';
import { Field, Segmented, Stepper } from './ui/Field';
import { Dialog, Sheet, Toast } from './ui/Overlay';

type Stage = 'size' | 'sides' | 'canvas';
// A rectangle on screen, in the page area's own pixels.
type Box = { key: string; left: number; top: number; width: number; height: number };
type SheetTarget = { slot: number } | 'spanning' | 'load' | 'print' | null;

const GAP = 6;

// The app is one phone-width column whatever it is shown on. Layout only —
// anything pressable comes from ui/.
// Phone-first, but a tablet is not a tall phone: on a wide screen the column
// was 430px of app in the middle of 834, and the drawing -- which is what the
// whole app is -- came out at a third of the glass. The cap lifts once there
// is room for it, and everything in the column simply gets wider with it.
const SCREEN = 'relative mx-auto flex h-full max-w-[430px] flex-col overflow-hidden bg-bg md:max-w-[680px]';
const SCREEN_PAD = `${SCREEN} gap-[18px] px-[22px] py-7`;

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

  return (
    <svg
      width={ICON_W} height={ICON_H} viewBox={`0 0 ${ICON_W} ${ICON_H}`}
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
];

const TAUGHT_KEY = 'ringcraft.dividerTaught';
// How far the clear button sits in from the block's right edge. It has to
// overlap a little to read as attached, without sitting on top of a date.
const CLEAR_INSET = 17;

// What the design is, in the header. A fold says how many panels because that
// is the thing you chose, and the thing the paper has to carry.
const formLabel = (l: Layout): string =>
  l.fold > 1 ? `蛇腹${l.fold}面` : l.spread ? '見開き' : '片面';

const PART_LABEL: Record<PartKind, string> = {
  monthly: 'マンスリー', daylist: '日付リスト',
  weekvert: '週間バーチカル', weekhoriz: '週間ホリゾンタル', gantt: 'ガントチャート',
  habit: 'ハビットトラッカー', todo: 'TODOリスト',
  goal: '今月の目標', budget: '家計', grid: '方眼', lines: '罫線', memo: 'メモ',
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

export function App() {
  const [stage, setStage] = useState<Stage>('size');
  const [layout, setLayout] = useState<Layout>(createLayout);

  if (stage === 'size') {
    return (
      <SizeScreen
        selected={layout.size}
        onPick={(size) => { setLayout(l => ({ ...l, size })); setStage('sides'); }}
      />
    );
  }
  if (stage === 'sides') {
    return (
      <SidesScreen
        size={layout.size}
        spread={layout.spread}
        fold={layout.fold}
        onPick={(v) => setLayout(l => ({
          ...l,
          ...v,
          // A fold holds one part per panel and has no band, so anything the
          // previous shape carried beyond that goes rather than staying in the
          // layout as a part with nowhere to be drawn.
          spanning: v.fold > 1 ? null : l.spanning,
          surface: v.fold > 1
            ? { ...l.surface, placed: l.surface.placed.slice(0, v.fold), page: undefined, ratios: {} }
            : l.surface,
        }))}
        onBack={() => setStage('size')}
        onConfirm={() => setStage('canvas')}
      />
    );
  }
  return <CanvasScreen layout={layout} setLayout={setLayout} onBack={() => setStage('sides')} />;
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
  return (
    <div className={SCREEN_PAD}>
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
              <div className="grid grid-cols-2 gap-1.5">
                {group.rows.flatMap(row => (row.length === 1 ? [...row, null] : row)).map((id, i) => (
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
function SidesScreen({ size, spread, fold, onPick, onBack, onConfirm }: {
  size: RefillSize;
  spread: boolean;
  fold: FoldCount;
  onPick: (v: { spread: boolean; fold: FoldCount }) => void;
  onBack: () => void; onConfirm: () => void;
}) {
  const spec = SIZES[size];
  const tint = SIZE_TINT[size];
  const flat = fold <= 1;

  // Every choice is its own card with its own drawing, because the drawing is
  // the choice: a control that redraws one card makes the fold a setting of
  // something else, and you cannot compare two shapes you cannot see at once.
  // A size whose panels would come out unusably narrow simply has no card --
  // A5 at three panels is the one, where the paper runs out before the rings
  // do and each inner panel comes to half a page.
  const choices: {
    key: string; on: boolean; pick: { spread: boolean; fold: FoldCount };
    title: string; note: string; sheets?: boolean[]; plan?: FoldPlan;
  }[] = [
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
    ...FOLD_PANELS.flatMap(n => {
      const plan = foldPlan(spec, n);
      if (!plan) return [];
      return [{
        key: `fold${n}`, on: fold === n, pick: { spread: false, fold: n as FoldCount },
        title: `蛇腹${n}面`,
        note: `広げて${plan.alongMm}×${plan.acrossMm}mm`,
        plan,
      }];
    }),
  ];
  const picked = choices.find(c => c.on);

  return (
    <div className={SCREEN_PAD}>
      <button className="self-start p-0 text-xs text-muted" onClick={onBack}>← サイズを選び直す</button>
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
      <div className="grid grid-cols-2 gap-1.5">
        {choices.map(choice => (
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
        ))}
      </div>
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
  const inset = pen(OUTLINE_PX) / 2;
  const panels = foldPanels(plan);
  return (
    <svg
      width={plan.alongMm * k} height={plan.acrossMm * k}
      viewBox={`0 0 ${plan.alongMm} ${plan.acrossMm}`}
      className="block shrink-0"
      aria-hidden="true"
    >
      <rect
        x={inset} y={inset}
        width={plan.alongMm - inset * 2} height={plan.acrossMm - inset * 2}
        rx={pen(2)} fill={tint.fill} stroke={tint.line} strokeWidth={pen(OUTLINE_PX)}
      />
      {panels.slice(1).map(p => (
        <line
          key={p.atMm}
          x1={p.atMm} y1={0} x2={p.atMm} y2={plan.acrossMm}
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
function EdgeNote({ size, count, sheet }: {
  size: SizeSpec; count: number; sheet?: { widthMm: number; heightMm: number };
}) {
  const plan = paperPlan(size, count, sheet);
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

function CanvasScreen({ layout, setLayout, onBack }: {
  layout: Layout; setLayout: (fn: (l: Layout) => Layout) => void; onBack: () => void;
}) {
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
  const folded = !!foldOf(layout, size);
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
      return planned.layout;
    });
  };

  const swapParts = (a: number, b: number) => {
    if (a === b) return;
    setLayout(prev => {
      const placed = [...prev.surface.placed];
      [placed[a], placed[b]] = [placed[b], placed[a]];
      return { ...prev, surface: { ...prev.surface, placed } };
    });
  };

  const removePart = (slot: number) => {
    setLayout(prev => {
      const folded = foldOf(prev, size);
      if (folded) {
        return { ...prev, surface: removeFromFold(prev.surface, folded.panels, slot) };
      }
      const placed = prev.surface.placed.filter((_, i) => i !== slot);
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
          ...prev.surface, placed, ratios: {},
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
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
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
    const sheets = buildPrintSheets(layout, size, opts);
    downloadPdf(await sheetsToPdf(sheets, layout.name), `${layout.name || 'refill'}.pdf`);
    setSheet(null);
    say(opts.impose ? `A4 ${sheets.length}枚を書き出しました` : `原寸 ${sheets.length}枚を書き出しました`);
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

  return (
    <div className={SCREEN}>
      {/* Turning belongs up here rather than over the paper. A folded strip
          turned a quarter turn fills the drawing area top to bottom, and a
          button floating in its corner sat on the refill itself. */}
      <header className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-3 text-xs font-semibold text-label">
        <Button variant="icon" onClick={onBack} aria-label="戻る">←</Button>
        {/* The two buttons keep their room; the name gives way. A long size
            name pushing them off the edge is worse than a name cut short. */}
        <span className="min-w-0 truncate">
          {size.label} {size.widthMm}×{size.heightMm}mm ・ {formLabel(layout)}
        </span>
        <button
          className="rotate ml-auto flex shrink-0 items-center gap-1 rounded-full border border-line-strong bg-white px-2.5 py-1 text-[11px] font-normal text-label"
          onClick={turn}
          aria-label="リフィルを回転"
        >
          <span className="text-[13px] leading-none">↻</span>
          {turnLabel}
        </button>
        <button
          className="magnify flex shrink-0 items-center gap-1 rounded-full border border-line-strong bg-white px-2.5 py-1 text-[11px] font-normal text-label"
          onClick={() => setZoomed(true)}
          aria-label="大きく見る"
        >
          <span className="text-[13px] leading-none">⤢</span>
          大きく
        </button>
      </header>

      {/* The design filling the glass, to check rather than to edit. Editing
          needs the tray and the borders, which are what make the drawing small
          in the first place; taking them away is the whole point of this. */}
      {zoomed && (
        <ZoomView pages={pages} flow={geo.flow} onClose={() => setZoomed(false)} />
      )}

      {dated && (
        // Which months this makes is a design decision, not a printing one,
        // so it belongs in sight rather than inside the export sheet.
        <button
          className="range mb-0.5 ml-3.5 flex shrink-0 items-center gap-2 self-start rounded-full border border-line-strong bg-white px-3 py-1.5 text-[11px] text-ink"
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
              className={`page relative shrink-0 touch-none overflow-hidden bg-white ${
                folded
                  ? 'shadow-[0_10px_30px_rgba(58,54,46,0.10)]'
                  : 'rounded-sm shadow-[0_10px_30px_rgba(58,54,46,0.16)]'
              }`}
              style={{ width: pageW(i), height: pageH(i) }}
            >
              <PageSvg page={pages[i]} scale={scale} showGuides />
              {pg.spanRect && (
                <button
                  className="hitbox absolute p-0"
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

          {partBoxes.map(b => (
            <div
              key={b.key}
              className="hitbox part absolute touch-none p-0 active:bg-[rgba(193,115,74,0.08)]"
              style={{ left: b.left, top: b.top, width: b.width, height: b.height }}
              onPointerDown={e => startDrag(e, [layout.surface.placed[b.slot]], b.slot)}
              onPointerMove={moveDrag}
              onPointerUp={e => endPartDrag(e, b.slot)}
              title={PART_LABEL[layout.surface.placed[b.slot]]}
            />
          ))}

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

      <p className={`m-0 shrink-0 px-3.5 py-1 text-[10px] ${
        traySelected.length > 0 || teachDivider ? 'text-accent' : 'text-faint'
      }`}>
        {teachDivider
          ? 'つまみをドラッグすると、パーツの広さを変えられます'
          : traySelected.length > 0
            ? `${traySelected.length}個選択中：紙をタップすると置けます`
            : 'タップで選ぶ → 紙をタップ。ドラッグでも置けます'}
      </p>

      {/* The row is wider than the screen, and until now nothing said so: it
          ran off the edge with no sign that there was more, and could not be
          swiped either. The arrow appears only on the side that has more to
          come, and goes when that side runs out. */}
      <div className="relative shrink-0 border-t border-line bg-paper">
        <div
          ref={el => { trayRef.current = el; readTrayEdges(); }}
          onScroll={readTrayEdges}
          className="flex gap-2.5 overflow-x-auto px-3 pb-2.5 pt-2"
        >
        {TRAY.map(t => {
          const idx = traySelected.indexOf(t.kind);
          return (
            <button
              key={t.kind}
              // `pan-x`, not `none`: sideways belongs to the tray, every other
              // direction belongs to the part being lifted out of it.
              className={`stamp relative flex w-[60px] shrink-0 touch-pan-x flex-col items-center gap-[3px] rounded-xl border-[1.5px] py-[8px] text-[9px] font-semibold ${
                idx >= 0 ? 'border-accent bg-accent-soft' : 'border-line bg-white'
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

        {([['left', '‹'], ['right', '›']] as const).map(([side, glyph]) => (
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

      <div className="flex shrink-0 gap-2 bg-paper px-3 pb-3.5 pt-2">
        <Button onClick={() => setSheet('load')}>読み込み</Button>
        <Button onClick={() => { saveLayout(layout); say('レイアウトを保存しました'); }}>保存</Button>
        <Button variant="actionWide" onClick={() => setSheet('print')}>PDF出力プレビュー</Button>
      </div>

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

      {sheet && (
        <PartSheet
          target={sheet}
          layout={layout}
          setLayout={setLayout}
          onClose={() => setSheet(null)}
          onRemove={slot => askRemove(PART_LABEL[layout.surface.placed[slot]], () => removePart(slot))}
          onRemoveSpanning={() => askRemove('マンスリー', () => setLayout(l => ({ ...l, spanning: null })))}
          onLoad={l => { setLayout(() => l); setSheet(null); say('読み込みました'); }}
          size={size}
          onExport={onExport}
        />
      )}
    </div>
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
      className={`${hook} absolute z-[5] size-4 rounded-full bg-[rgba(58,54,46,0.34)] p-0 text-[10px] leading-4 text-white active:bg-[rgba(58,54,46,0.7)]`}
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
      <i className={`block rounded-sm bg-line-strong group-active:bg-accent ${
        horizontal ? 'h-[3px] w-full' : 'h-full w-[3px]'
      }`} />
      <b className={`absolute flex items-center justify-center gap-0.5 rounded-[7px] border bg-white shadow-[0_1px_3px_rgba(58,54,46,0.18)] group-active:border-accent ${
        horizontal ? 'h-[13px] w-[34px] flex-col' : 'h-[34px] w-[13px]'
      } ${teach ? 'animate-knob border-accent' : 'border-line-strong'}`}>
        {[0, 1].map(i => (
          <span key={i} className={`block rounded-[1px] group-active:bg-accent ${
            horizontal ? 'h-[1.5px] w-[14px]' : 'h-[14px] w-[1.5px]'
          } ${teach ? 'bg-accent' : 'bg-faint'}`} />
        ))}
      </b>
    </div>
  );
}

function PartSheet({ target, layout, setLayout, onClose, onRemove, onRemoveSpanning, onLoad, size, onExport }: {
  target: Exclude<SheetTarget, null>;
  layout: Layout;
  setLayout: (fn: (l: Layout) => Layout) => void;
  onClose: () => void;
  onRemove: (slot: number) => void;
  onRemoveSpanning: () => void;
  onLoad: (l: Layout) => void;
  size: SizeSpec;
  onExport: (opts: PrintOptions) => void;
}) {
  const [print, setPrint] = useState<PrintOptions>(DEFAULT_PRINT);
  const lastMonth = addMonths(layout.year, layout.month, Math.max(1, layout.monthCount) - 1);
  const saved = useMemo(() => target === 'load' ? listLayouts() : [], [target]);
  const kind = typeof target === 'string' ? null : layout.surface.placed[target.slot];
  // What the months actually come to, for the run this sheet is setting.
  const [firstDay, lastDay] = runDates(layout);
  // Worked out up front rather than on the tap: a spread already carrying
  // other parts may have no room for two calendars, and a choice that does
  // nothing when picked is worse than one that is not offered.
  const split = layout.spread && layout.spanning
    ? planPlacement(layout, size, ['monthly'], { sx: 0, sy: 0, band: 0 })
    : null;

  const title = target === 'load' ? '保存済みレイアウト'
    : target === 'print' ? 'PDF出力プレビュー'
    : target === 'spanning' ? '見開きマンスリー'
    : kind ? PART_LABEL[kind] : 'パーツ';

  return (
    <Sheet title={title} onClose={onClose}>

        {target === 'load' && (
          saved.length === 0
            ? <p className="text-[13px] text-faint">まだ保存されていません</p>
            : <ul className="m-0 flex max-h-60 list-none flex-col gap-1.5 overflow-y-auto p-0">
                {saved.map(l => (
                  <li key={l.id} className="flex gap-2">
                    <button
                      className="flex-1 rounded-[9px] border border-line-strong bg-white px-3 py-[11px] text-left text-[13px]"
                      onClick={() => onLoad(l)}
                    >{l.name}</button>
                    <Button variant="quiet" onClick={() => { deleteLayout(l.id); onClose(); }}>削除</Button>
                  </li>
                ))}
              </ul>
        )}

        {target === 'print' && (
          <>
            <PrintPreview layout={layout} size={size} print={print} />
            <Choice
              label="用紙"
              options={[{ v: 'a4', label: 'A4にまとめる' }, { v: 'exact', label: '原寸のまま' }]}
              value={print.impose ? 'a4' : 'exact'}
              onPick={v => setPrint(p => ({ ...p, impose: v === 'a4' }))}
            />
            {/* The browser's own paragraph margin, kept deliberately: it is the
                breathing room between the paper choice and the print options. */}
            <p className="print-summary my-[13px] text-[13px] text-faint">
              {hasDatedPart(layout) && `${layout.year}年${layout.month}月から${layout.monthCount}ヶ月分・`}
              {isDayPaced(layout) && `${sheetCount(layout)}枚・`}
              {print.impose && `A4 1枚に ${paperPlan(size, imposeCount(layout, size, print), sheetSizeOf(layout, size)).perPage} ${layout.fold > 1 ? '本' : '面'}`}
            </p>
            {print.impose && (
              <EdgeNote
                size={size}
                count={imposeCount(layout, size, print)}
                sheet={sheetSizeOf(layout, size)}
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
                  {duplexFlipOf(layout, size, imposeCount(layout, size, print))}
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

        {target === 'spanning' && !ringsOnTop(layout) && (
          <Choice
            label="翌月のミニカレンダー"
            options={[{ v: 'on', label: '入れる' }, { v: 'off', label: '入れない' }]}
            value={layout.showNextMonth ? 'on' : 'off'}
            onPick={v => setLayout(l => ({ ...l, showNextMonth: v === 'on' }))}
          />
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

// Imposed, duplexed sheets look like nonsense until you see them laid out and
// numbered. Showing them here means the options can be judged before anyone
// spends ink on them.
function PrintPreview({ layout, size, print }: { layout: Layout; size: SizeSpec; print: PrintOptions }) {
  const sheets = useMemo(() => buildPrintSheets(layout, size, print), [layout, size, print]);
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

  return (
    <Field label={`刷り上がり（全${sheets.length}ページ・タップで拡大）`}>
      <div className="preview flex gap-2.5 overflow-x-auto pb-1 pt-0.5">
        {shown.map((sheet, i) => (
          <figure key={i} className="m-0 flex shrink-0 flex-col items-center gap-1">
            <button className="block p-0" onClick={() => { setZoom(false); setOpen(i); }} aria-label={`${label(i)}を拡大`}>
              <SheetSvg sheet={sheet} boxPx={110} className="block rounded-sm border border-line-strong bg-white" />
            </button>
            <figcaption className="whitespace-nowrap text-[10px] text-muted">{label(i)}</figcaption>
          </figure>
        ))}
        {sheets.length > shown.length && (
          <button
            className="flex min-h-[142px] w-[110px] shrink-0 items-center justify-center rounded-sm border border-dashed border-line-strong text-center text-[10px] leading-[1.6] text-faint"
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
            <SheetSvg
              sheet={sheets[open]}
              boxPx={1400}
              className={zoom
                ? 'block w-[calc((100dvw-32px)*2.4)] max-w-none'
                : 'block h-auto w-auto max-h-[calc(100dvh-128px)] max-w-[calc(100dvw-32px)]'}
            />
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
