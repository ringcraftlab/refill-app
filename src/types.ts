export const SCHEMA_VERSION = 14;

export type RefillSize =
  | 'MINI3' | 'CARD3' | 'M5' | 'M5SQ' | 'M6' | 'BIBLE' | 'NARROW' | 'A5SLIM' | 'A5';

// Punch pattern along the binding edge. The 19mm pitch is the worldwide
// standard; what differs per size is the hole count, whether they run evenly
// or in two groups of three, and how far in the outermost hole sits.
export interface HoleSpec {
  count: number;
  diameterMm: number;
  pitchMm: number;
  // Paper edge to the outermost hole's centre.
  marginMm: number;
  // Centre-to-centre across the middle. Omitted means one even run.
  centreGapMm?: number;
}

export interface SizeSpec {
  id: RefillSize;
  label: string;
  widthMm: number;
  heightMm: number;
  // Which edge the rings run along when the sheet is held the way widthMm and
  // heightMm describe it. Every size here binds on a side, so the punch runs
  // down heightMm; a top-bound size would run it across widthMm instead, and
  // that changes where the holes go, which way a spread opens and which edge
  // the content keeps clear.
  ringsOn?: 'side' | 'top';
  // Strip along the binding edge that the rings occupy. Content never enters
  // it, so nothing can print on top of a punch hole.
  ringMarginMm: number;
  holes: HoleSpec;
}

// 紙の地。パーツの下に敷かれ、刷られる。
export type BackgroundKind = 'none' | 'tint' | 'grid' | 'dot' | 'lines' | 'image';

export interface Background {
  kind: BackgroundKind;
  // 'tint' と地紋の色。16進。
  color?: string;
  // 'image' のときのデータURL。レイアウトと一緒に保存されるので、元の
  // ファイルが無くなっても刷り続けられる。
  src?: string;
  // 0-1。下にあるものは上のものに道を譲る。
  opacity?: number;
}

export type WeekStart = 0 | 1;

export type PartKind =
  | 'monthly' | 'daylist' | 'weekvert' | 'weekhoriz' | 'gantt'
  | 'habit' | 'todo' | 'goal' | 'budget' | 'grid' | 'lines' | 'memo' | 'photo'
  | 'swatch';

// What a part needs to stay usable, and which way it wants to be shaped. The
// habit tracker carries 31 day columns, so it needs width or its ticks become
// unwritable; a to-do list stacks items, so it wants height. Placement picks a
// split from these numbers rather than from anyone's taste.
export interface PartFit {
  minWMm: number;
  minHMm: number;
  prefer: 'wide' | 'tall' | 'any';
  // Some parts can be folded, trading width for height. The day list is the
  // case: 31 rows need a 90mm column, but the same month folds into two or
  // three columns, which is what fits a refill turned on its side.
  alt?: { minWMm: number; minHMm: number }[];
}

export const PART_FIT: Record<PartKind, PartFit> = {
  // Seven columns at about 6mm each. Micro 5 leaves 51mm on a single page,
  // which is the tightest real refill there is; below this the dates collide.
  monthly: { minWMm: 44, minHMm: 40, prefer: 'any' },
  // Thirty-one rows down one column need the height, but a wider area folds
  // them into two or three columns instead -- the shapes a printed one-month
  // list comes in. Kept in step with dayListColumns().
  daylist: {
    minWMm: 20, minHMm: 90, prefer: 'tall',
    alt: [{ minWMm: 38, minHMm: 48 }, { minWMm: 56, minHMm: 35 }],
  },
  // Seven day columns and a run of hours down the side.
  weekvert: { minWMm: 52, minHMm: 58, prefer: 'any' },
  // Seven day rows, each wide enough to write a line in.
  weekhoriz: { minWMm: 40, minHMm: 44, prefer: 'any' },
  // A column per day of the month, so it needs the width a habit grid does.
  gantt: { minWMm: 76, minHMm: 26, prefer: 'wide' },
  habit:   { minWMm: 76, minHMm: 18, prefer: 'wide' },
  // One card for one ink: a number, a rule for its name, a bottle to paint in
  // and rules to write about it on. Below this the bottle is a smudge and the
  // name has nowhere to go.
  swatch:  { minWMm: 44, minHMm: 30, prefer: 'wide' },
  todo:    { minWMm: 18, minHMm: 28, prefer: 'tall' },
  goal:    { minWMm: 26, minHMm: 18, prefer: 'any' },
  budget:  { minWMm: 34, minHMm: 20, prefer: 'any' },
  grid:    { minWMm: 14, minHMm: 8,  prefer: 'any' },
  lines:   { minWMm: 16, minHMm: 8,  prefer: 'any' },
  memo:    { minWMm: 16, minHMm: 10, prefer: 'any' },
  // A picture is whatever shape its area is; below this it is a stamp rather
  // than something you can see.
  photo:   { minWMm: 15, minHMm: 15, prefer: 'any' },
};

// Whether the refill is used upright or turned a quarter turn. This belongs
// to the paper, not to whatever is printed on it: a memo-only refill can be
// landscape just as a calendar can. It also decides how a spread reads --
// upright pages sit side by side, turned pages stack.
export type Orientation = 'portrait' | 'landscape';

export interface Spanning {
  // Share of the usable page height the calendar takes. It stays at 1 — the
  // whole page — until another part actually joins it.
  ratio: number;
}

// A page of the design. A single sheet has one; a spread has two; a
// 蛇腹 has one per fold panel, counted from the punched one.
export type PageKey = 'single' | 'left' | 'right' | 'f1' | 'f2' | 'f3';

// How many panels the sheet folds into. One means it does not fold. Four is
// deliberately absent: see lib/fold.ts.
export type FoldCount = 1 | 2 | 3;

// Which way a 蛇腹 folds. 'out' folds away from the rings and the strip stays
// a rectangle; 'along' folds across them and the panels after the punched one
// are cut back to clear the holes. See lib/fold.ts.
export type FoldGrain = 'out' | 'along';

// How a 蛇腹's panels are shared out. The creases cannot be dragged -- the
// paper bends where it bends -- so the structure is which panels go together,
// not where a border sits. Within one of these the ordinary division applies:
// its parts split its area by ratios, with borders you can drag.
export interface FoldGroup {
  // How many panels this covers. The whole list adds up to the fold count, so
  // one group covering them all is a part across the unfolded strip.
  panels: number;
  // How many of `placed` sit here, in order: the first group takes the first
  // `parts` of the list, and so on.
  parts: number;
  split?: 'h' | 'v';
  ratios?: { a?: number; b?: number; c?: number };
}

// The area left over once the calendar has taken its band. In a spread this is
// ONE surface across both pages: a part whose region crosses the gutter spans
// the spread, one that fits in a half sits on that page alone.
export interface Surface {
  placed: PartKind[];
  // One entry per placed part, in the same order: the picture a photo slot
  // holds, or null. Kept beside `placed` rather than inside it because every
  // other part has nothing to carry, and a parallel list is the smaller change
  // -- but it does mean every place that adds, removes or swaps a part has to
  // do the same here.
  photos?: (string | null)[];
  // A photo that changes from sheet to sheet, in the same order as `placed`:
  // one picture per sheet of the run for that slot, or null/absent when the
  // slot's picture is the same on every sheet (which is what `photos` holds).
  // A twelve-month run prints one photo twelve times or twelve photos once
  // each, and both are things people want; which one this slot is, is this.
  // Same parallel-list rule as `photos` -- every insert, remove and swap has
  // to move it too.
  photoEach?: ((string | null)[] | null)[];
  // Which page of a spread the parts live on. Omitted -- which is what every
  // layout saved before this said -- means both, the surface running across
  // the gutter as one. Set by dropping against a spread's outer edge, which
  // is the gesture for "this page only" and leaves the facing page blank.
  page?: PageKey;
  // Where the shared borders sit. This is the whole point of the app: a
  // commercial refill's memo area is fixed, here you drag it wider.
  ratios: { a?: number; b?: number; c?: number };
  // How two parts divide the surface. 'h' stacks them, so in a spread both
  // cross the gutter; 'v' sets them side by side, one per page.
  split: 'h' | 'v';
  // Only on a 蛇腹, and omitted on one that has nothing on it yet: which
  // panels are shared with which. `split` and `ratios` above are the plain
  // sheet's; a fold keeps one of each per group.
  fold?: FoldGroup[];
}

export interface Layout {
  version: number;
  id: string;
  name: string;
  size: RefillSize;
  spread: boolean;
  // How many panels the sheet folds into, counting the punched one. One is a
  // plain refill. Anything more is a 蛇腹, which is a different shape of
  // refill rather than a print option: the panels are narrower than the page,
  // only the first is punched, and the paper it prints on decides how wide
  // they can be. A fold and a spread are alternatives, never both.
  fold: FoldCount;
  // Which way it folds. Only one size has both to choose from, and a layout
  // that does not say takes that size's usual one.
  foldGrain?: FoldGrain;
  spanning: Spanning | null;
  surface: Surface;
  // The first month generated. Dated parts repeat for `monthCount` months, so
  // one design yields a whole year of refills in a single export.
  year: number;
  month: number; // 1-12
  monthCount: number;
  // How many days one sheet covers once a weekly grid is on it. Seven is a
  // week to a spread; four and two are the other shapes printed refills come
  // in, and one is a day to a page. It decides how often the sheet repeats,
  // so it belongs to the refill rather than to the part.
  daysPerSheet: number;
  weekStart: WeekStart;
  // Where a run paced by days begins, as a date. Months are too coarse for a
  // weekly: asking for September and being handed the week of August 31st is
  // three weeks of sheets nobody wanted, and making one on the 22nd wastes
  // most of the month. Omitted -- which is what every layout saved before
  // this said -- means the first of `month`.
  runStart?: string;
  // The span of the day a vertical weekly draws, in whole hours. Printed
  // refills differ on this more than on anything else about a vertical -- a
  // work planner starts at 8, a diary at 0 -- and it decides the row count,
  // so it belongs to the refill rather than to the part.
  dayStartHour: number;
  dayEndHour: number;
  // How many bands the vertical folds its days into. One page of seven
  // columns is too narrow to write in on most sizes; two bands of three or
  // four is what printed one-page weeklies do.
  weekTiers: number;
  orientation: Orientation;
  // 紙の地。省略は「なし」——これまで保存したものが全部そう。
  background?: Background;
  // 体裁。リフィル全体にかかるので、パーツではなくレイアウトが持つ。
  // どれも省略できて、省略は今までどおりの見た目になる。
  words?: DateWords;
  tone?: InkTone;
  ruleWeight?: RuleWeight;
  // Printed refills usually tuck next month's dates into the spread's index
  // column, so it is on unless the user clears it.
  // A cover: one page on the outside of the stack, whatever the rest of the
  // book is folded into. Marked rather than guessed from what is on it,
  // because a photograph on a sheet is not the same thing as a cover.
  cover?: boolean;
  // How many identical sheets a section with no dates prints. A note section
  // is "ten sheets of squared paper" -- there is nothing in its content to say
  // how much of it you want, unlike a monthly, which is as long as its months.
  // Omitted means one, which is what everything saved before this was.
  pages?: number;
  // Which sheet of the run this is, counted from 0. Set when a run is cut into
  // sheets, not stored: it is how a part that counts -- an ink card numbered
  // 10, 11, 12 down the binder -- knows which one it is on, the same way a
  // dated part knows its month.
  sheetNo?: number;
  // The ink swatch card: the number it starts counting from, how many rules it
  // leaves to write on, and whether it draws a bottle to paint in.
  swatchFrom?: number;
  swatchLines?: number;
  swatchBottle?: boolean;
  // How many cards one sheet carries. A binder page holds three name cards,
  // and the numbering carries on across sheets rather than starting over.
  swatchPer?: number;
  showNextMonth: boolean;
  habitCount: number;
  updatedAt: string;
  // The first day this sheet covers. Set while a dated run is being drawn and
  // never saved: a layout in the editor has none and shows the first sheet of
  // its period.
  sheetStart?: string;
  // The picture the slot being drawn holds. Set while a page is being drawn,
  // like `sheetStart`, and never saved: parts are drawn from a kind and a
  // layout, and this is how the one kind that carries something of its own
  // gets it.
  slotPhoto?: string;
}

// 日付まわりの言葉。月名と曜日名だけが変わる。
// 'mix' は「9月」＋「Mon」で、日本の市販リフィルで一番よく見る形。
export type DateWords = 'ja' | 'mix' | 'en';

// 線と文字の色。土日祝の色は**どれを選んでも変わらない** — 日曜が赤いのは
// 好みではなく約束事で、色みに合わせて変えると意味が消える。
export type InkTone = 'sepia' | 'grey' | 'indigo' | 'green';

// 罫線の濃さ。家庭のプリンタで飛ぶ・濃すぎるを直すための軸なので、
// 文字には効かせない（読めなくなる）。
export type RuleWeight = 'light' | 'normal' | 'dark';

// 1冊ぶんの中身。市販のリフィルは「年間カレンダー → マンスリー → ウィークリー
// → ノート」のように**順番のあるセクションの並び**で、1種類のリフィルではない。
// 束がその並びで、`sections` の順がそのまま紙に置かれる順（＝綴じる順）。
//
// サイズ・見開き/片面/蛇腹は束で1つ。同じ穴の紙でないと1冊に綴じられないので、
// これは制約ではなく事実で、セクションそれぞれが同じ値を持つ（`src/lib` は
// セクションを1つのリフィルとしてしか見ないので、持たせておくほうが素直）。
export interface Book {
  version: number;
  id: string;
  name: string;
  sections: Layout[];
  updatedAt: string;
}

export const MAX_PARTS = 4;
