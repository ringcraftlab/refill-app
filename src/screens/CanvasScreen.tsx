import { Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Book, Layout, PartKind, SizeSpec } from '../types';
import { MAX_PARTS } from '../types';
import { SIZES } from '../lib/sizes';
import { buildGeometry, foldMaxParts, foldOf, MAX_RATIO, MIN_RATIO, eachOf, photosOf, placeParts as planPlacement, regionAt, removeFromFold, ringsOnTop, someEach } from '../lib/layout';
import type { Divider, DropPoint, Geometry, PageGeometry } from '../lib/layout';
import { paletteOf } from '../lib/palette';
import { nextMonthCell } from '../lib/parts';
import { runDates } from '../lib/dates';
import { buildPages, buildPrintSheets, datedSlotOf, hasDatedPart, isDayPaced, isDatedKind, runEnd, sheetAt, sheetCount } from '../lib/render/pages';
import type { PrintOptions } from '../lib/render/pages';
import { PAPERS } from '../lib/render/impose';
import { PageSvg } from '../lib/render/svg';
import { downloadPdf, sheetsToPdf } from '../lib/render/pdf';
import { saveBook } from '../lib/storage';
import { Button, PRESS } from '../ui/Button';
import { Dialog, Modal, Toast } from '../ui/Overlay';
import { DockGrip, DockTab, FilterChip } from '../ui/Dock';
import { Filmstrip } from './Filmstrip';
import { AddSection } from '../sheets/AddSection';
import { formLabel, PART_LABEL, pacedFor, sectionOf, isPlaceholder, withSection, sectionLabel, bodyOf, pagesOf, backSideOf, usePaperJob, SECTION_LABEL, sectionSpan } from '../app/book';
import type { PaperJob } from '../app/book';
import { StampIcon, SizeIcon, SheetGlyph, FormGlyph2, Chevron, ListGlyph, FormGlyph, CalendarGlyph, BackgroundSample, BookGlyph, FileGlyph } from '../app/icons';
import { WORD_SAMPLE, cssColor, BACKGROUND_LABEL, SIZE_COLOR } from '../app/look';
import { GAP, CANVAS_SCREEN, useWide } from '../app/screen';
import type { Box, SheetTarget } from '../app/screen';
import { PartSheet } from '../sheets/PartSheet';
import { ZoomView } from '../sheets/ZoomView';

// Four kinds, and a word under each name saying what it is for: the tray is
// a shelf someone browses, and 「ガント」 says nothing to most people. The kinds
// filter rather than head a run on a phone -- a tab per kind would be one more
// press for fourteen parts, a chip is the same press that picks the kind.
export const TRAY_GROUP = { dated: '日付・暦', list: '書く欄・リスト', note: '方眼・ノート', other: '写真など' } as const;
export type TrayGroup = keyof typeof TRAY_GROUP;

export const TRAY: { kind: PartKind; label: string; note: string; group: TrayGroup }[] = [
  { kind: 'monthly', label: 'マンスリー', note: '1ヶ月の暦', group: 'dated' },
  { kind: 'daylist', label: '日付リスト', note: '1日1行', group: 'dated' },
  { kind: 'weekvert', label: 'バーチカル', note: '時間の目盛り', group: 'dated' },
  { kind: 'weekhoriz', label: 'ウィークリー', note: '1週間を7行', group: 'dated' },
  { kind: 'gantt', label: 'ガント', note: '予定を帯で', group: 'dated' },
  { kind: 'habit', label: 'ハビット', note: '習慣に印', group: 'dated' },
  { kind: 'todo', label: 'TODO', note: 'チェック欄', group: 'list' },
  { kind: 'goal', label: '目標', note: '大きな枠', group: 'list' },
  { kind: 'budget', label: '家計', note: '金額の表', group: 'list' },
  { kind: 'memo', label: 'メモ', note: '見出しつき', group: 'note' },
  { kind: 'lines', label: '罫線', note: '線だけ', group: 'note' },
  { kind: 'grid', label: '方眼', note: 'マス目', group: 'note' },
  { kind: 'photo', label: '写真', note: '画像を貼る', group: 'other' },
  { kind: 'swatch', label: 'インク見本', note: '色を試す', group: 'other' },
];

export const TAUGHT_KEY = 'ringcraft.dividerTaught';

// How far the clear button sits in from the block's right edge. It has to
// overlap a little to read as attached, without sitting on top of a date.
export const CLEAR_INSET = 17;

// What the design is, in the header. A fold says how many panels because that
// is the thing you chose, and the thing the paper has to carry.
// The outline of a fold that was cut back, as a clip path. The cut is always
// a corner: it runs the whole way along one edge and out to the end of the
// strip, so the paper is an L and six points describe it.
export function notchClip(pg: PageGeometry): string | undefined {
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

export interface DragState {
  kinds: PartKind[];
  fromSlot: number | null;
  moved: boolean;
  startX: number;
  startY: number;
}

export function CanvasScreen({
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
  const [trayKind, setTrayKind] = useState<TrayGroup | 'all'>('all');
  // What belongs to the whole book rather than to the run being edited --
  // its order, its paper, opening and saving it -- in one place of its own,
  // so the settings tab only holds what it says it holds.
  const [bookOpen, setBookOpen] = useState(false);
  const [cautionOpen, setCautionOpen] = useState(false);
  // Where the strip's ＋ was pressed, and which run was held.
  const [insertAt, setInsertAt] = useState<number | null>(null);
  const [held, setHeld] = useState<number | null>(null);
  // The tray is what this page can take. A cover is one page, so nothing that
  // runs on dates belongs in it -- and offering a part only to refuse it after
  // the drag is worse than not offering it: turning the pages is meant to be
  // something you do without stopping.
  const trayAll = layout.imported ? [] : layout.cover || layout.backCover ? TRAY.filter(t => !isDatedKind(t.kind)) : TRAY;
  const trayKinds = (Object.keys(TRAY_GROUP) as TrayGroup[]).filter(g => trayAll.some(t => t.group === g));
  // A kind the page cannot take -- the dated ones on a cover -- is not a kind
  // to be left looking at an empty shelf in.
  const shownKind = trayKind !== 'all' && trayKinds.includes(trayKind) ? trayKind : 'all';
  const trayParts = shownKind === 'all' ? trayAll : trayAll.filter(t => t.group === shownKind);
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
  // The settings are the run's that is picked in the row above the paper, so
  // the tab is named after it: 「見開きの設定」, 「表紙の設定」.
  const scopeName = layout.cover ? '表紙' : layout.backCover ? '裏表紙'
    : book.sections.filter(sec => !sec.cover && !sec.backCover).length === 1
      ? formLabel(layout, foldNow?.grain) : sectionLabel(layout);
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
          onBook={() => setBookOpen(true)}
          compact={!wide}
        />
  );

  // On a phone these sit over and under the paper. Beside a desk-width
  // paper they stand at the top of the tools instead: a single page is
  // tall and narrow, so the height they took was the one thing it was
  // short of, while the width either side of it went unused.
  // The book as a whole, for the phone's title and the strip under it.
  const bookBody = bodyOf(book);
  // Until it is named, what is in it -- the size and form are said on the
  // line under the name already.
  const bookName = book.name && book.name !== '新しい束' ? book.name
    : book.sections.map(sectionLabel).slice(0, 3).join('＋');
  const leavesAll = pagesOf(book.sections);
  const bookSpreads = book.sections.some(sec => !sec.cover && !sec.backCover && sec.spread && sec.fold <= 1);
  const canCover = !book.sections[0]?.cover && bookSpreads;
  const canBack = !book.sections.some(sec => sec.backCover) && bookSpreads
    && leavesAll.length > 0 && leavesAll[leavesAll.length - 1].at === null
    && book.sections.some(sec => !sec.cover && !sec.backCover && !isPlaceholder(sec));
  // What to know before printing, said once at the top rather than found on
  // the paper afterwards.
  const emptyRuns = book.sections.filter(sec => !sec.cover && !sec.backCover && !sec.imported
    && sec.surface.placed.length === 0 && !sec.spanning && !sec.background);
  const cautions: string[] = [
    ...(emptyRuns.length ? [`何も置いていないページがあります（${emptyRuns.map(sectionLabel).join('、')}）。白紙のまま刷られます`] : []),
    ...(print.impose && job.spare > 0
      ? [`最後の${PAPERS[print.paper].label}に、あと${job.spare}${job.unit}ぶん空きがあります。メモなどを足すと紙が無駄になりません`] : []),
  ];
  // A run moves among the runs; the cover stays in front and the back cover
  // at the end.
  const canMove = (i: number, d: number) => {
    const to = i + d;
    const t = book.sections[to];
    return !!t && !t.cover && !t.backCover;
  };
  const moveSection = (i: number, d: number) => setBook(b => {
    const sections = [...b.sections];
    [sections[i], sections[i + d]] = [sections[i + d], sections[i]];
    return { ...b, sections };
  });
  const dropSection = (i: number) => {
    setBook(b => ({ ...b, sections: b.sections.length > 1 ? b.sections.filter((_, k) => k !== i) : b.sections }));
    goTo(Math.max(0, Math.min(i, book.sections.length - 2)), 0);
  };

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
      {!wide && (
        <button className="bookmenu flex min-w-0 flex-1 flex-col items-start text-left" onClick={() => setBookOpen(true)} aria-label="この1冊">
          <span className="flex max-w-full items-center gap-1 text-[16px] font-bold text-ink">
            <span className="truncate">{bookName}</span><span className="text-[12px] text-muted" aria-hidden="true">▾</span>
          </span>
          <span className="max-w-full truncate text-[12px] font-normal text-muted">
            {size.label}・{formLabel(bookBody, foldNow?.grain)}{paging ? `・${paging.of}ページ` : ''}
          </span>
        </button>
      )}
      {!wide && cautions.length > 0 && (
        <Button variant="chip" className="cautions shrink-0 text-danger" onClick={() => setCautionOpen(true)} aria-label="刷る前に">
          ⚠ {cautions.length}
        </Button>
      )}
      {wide && <Button
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
      </Button>}
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

      {!wide && (
        <Filmstrip
          sections={book.sections} at={at} nth={nth} size={size}
          onGo={(i, k) => goTo(i, k)}
          onAddCover={canCover ? addCover : undefined}
          onAddBack={canBack ? addBackCover : undefined}
          onInsert={before => setInsertAt(before)}
          onHold={i => setHeld(i)}
        />
      )}

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
              ? `${traySelected.length}つ選択中。紙をタップすると置けます`
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
      {/* On a phone the strip above the paper is the rest of the book. */}


      </div>

      {/* The tools. Under the paper on a phone, beside it on a desktop, and
          the same blocks in the same order either way. */}
      {/* On a phone the sheet is one height whichever tab is showing, so
          changing tabs never moves the paper above it. */}
      <aside className={`flex min-h-0 shrink-0 flex-col overflow-hidden ${!wide && !dockShut ? 'h-[180px]' : ''} lg:w-[340px] lg:overflow-y-auto lg:border-l lg:border-line lg:bg-paper`}>
      {wide && <div className="asidehead border-b border-line pb-2">{headerEl}{pagerEl}{alsoEl}</div>}
      {wide && <div className="border-b border-line pb-2 pt-2">{railEl}</div>}
      {!wide && (
        <div className="dock shrink-0 rounded-t-2xl border-t border-line bg-paper shadow-[0_-2px_10px_rgba(0,0,0,0.06)]">
          <DockGrip shut={dockShut} onClick={() => setDockShut(v => !v)} />
          <div className="flex items-end gap-1 px-3" role="tablist">
            {([['parts', 'パーツ'], ['paper', `${scopeName}の設定`]] as const).map(([k, name]) => (
              <DockTab key={k} on={dock === k && !dockShut} onClick={() => { setDock(k); setDockShut(false); }}>
                {name}
              </DockTab>
            ))}
            <span className={`saying ml-auto min-w-0 self-center truncate pb-1 text-[13px] ${
              teachDivider || traySelected.length > 0 ? 'text-accent-text' : 'text-muted'}`}>
              {teachDivider
                ? '仕切りを動かすと広さが変わります'
                : traySelected.length > 0
                  ? `${traySelected.length}つ選択中。紙をタップ`
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
        <div className="traykinds flex gap-1.5 overflow-x-auto px-3 pt-1.5 lg:px-4 lg:pt-3" role="group" aria-label="パーツの種類">
          <FilterChip on={shownKind === 'all'} onClick={() => setTrayKind('all')}>すべて</FilterChip>
          {trayKinds.map(g => (
            <FilterChip key={g} on={shownKind === g} onClick={() => setTrayKind(g)}>{TRAY_GROUP[g]}</FilterChip>
          ))}
        </div>
        <div
          ref={el => { trayRef.current = el; readTrayEdges(); }}
          onScroll={readTrayEdges}
          // On a desktop the tray and the settings share one column, and the
          // tray is the one that can give way: it is a palette that is always
          // there, while the settings are what was just asked for. Without
          // this the thirteen stamps took the whole column and the settings
          // were a 200px slot at the bottom -- open the photo settings and
          // the button to choose a picture was below the fold.
          // One row on a phone, scrolled sideways; the kinds above it are how
          // a long shelf gets short.
          className={`grid auto-cols-max grid-flow-col grid-rows-1 gap-2 overflow-x-auto px-3 pb-2.5 pt-2 lg:grid-flow-row lg:auto-cols-auto lg:grid-rows-none lg:gap-2.5 lg:grid-cols-3 lg:overflow-x-visible lg:px-4 lg:pt-4 ${
            sheetEl ? 'lg:max-h-[34vh] lg:overflow-y-auto' : ''
          }`}
        >
        {trayParts.map((t, n) => {
          const idx = traySelected.indexOf(t.kind);
          const head = n === 0 || trayParts[n - 1].group !== t.group;
          return (
            <Fragment key={t.kind}>
            {head && wide && shownKind === 'all' && (
              // Down the side of the two rows on a phone; across the column
              // on a desk.
              <span className="trayhead col-span-3 flex items-center gap-2 pt-1 text-[12px] text-muted first:pt-0">
                {TRAY_GROUP[t.group]}
                <i className="h-px flex-1 bg-line" />
              </span>
            )}
            <button
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
              <span className="text-[11px] font-normal leading-none text-muted">{t.note}</span>
            </button>
            </Fragment>
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
        </div>
      )}
      <div className={`flex shrink-0 gap-2 bg-paper px-3 pb-3.5 pt-2 ${wide ? '' : 'hidden'} lg:sticky lg:bottom-0 lg:z-10 lg:mt-auto lg:border-t lg:border-line lg:px-4 lg:pt-3`}>
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

      {/* What belongs to the whole book, at the foot of the screen on a
          phone: the paper it is made on, keeping it, and printing it. */}
      {!wide && (
        <div className="bookbar flex shrink-0 gap-2 border-t border-line bg-paper px-3 pb-3 pt-2">
          <Button className="papernow" onClick={() => setSheet('sheet')}>サイズ・穴</Button>
          <Button onClick={() => setSheet('save')}>保存</Button>
          <Button variant="actionWide" onClick={() => setSheet('print')} aria-label="PDF出力プレビュー">PDF出力</Button>
        </div>
      )}

      {ghost && (
        <div
          className="pointer-events-none fixed z-40 -translate-x-1/2 -translate-y-[140%] whitespace-nowrap rounded-[20px] bg-ink px-3 py-[7px] text-[13px] text-white"
          style={{ left: ghost.x, top: ghost.y }}
        >
          {ghost.kinds.map(k => PART_LABEL[k]).join(' + ')}
        </div>
      )}

      {toast && <Toast>{toast}</Toast>}

      {bookOpen && (
        <Modal title="この1冊" onClose={() => setBookOpen(false)}>
          <div className="bookmenu-body flex flex-col gap-2">
            <Button variant="quiet" className="torail-list flex items-center gap-2 text-ink" onClick={() => { setBookOpen(false); onList(); }}>
              <ListGlyph />並びを整える<span className="ml-auto text-muted">{paging ? `全${paging.of}ページ` : ''}</span>
            </Button>
            <Button variant="quiet" className="paper flex items-center gap-2 text-ink" onClick={() => { setBookOpen(false); setSheet('paper'); }}>
              <span className="text-[14px] leading-none">▭</span>用紙
              <span className="ml-auto text-muted">
                {print.impose ? `${PAPERS[print.paper].label} ${job.sheets}枚` : `${PAPERS[print.paper].label}に1枚ずつ`}
                {print.impose && job.spare > 0 && `（あと${job.spare}${job.unit}ぶん）`}
              </span>
            </Button>
            <Button variant="quiet" className="rename flex items-center gap-2 text-ink" onClick={() => { setBookOpen(false); setSheet('save'); }}>
              名前<span className="ml-auto min-w-0 truncate text-muted">{bookName}</span>
            </Button>
            <Button onClick={() => { setBookOpen(false); setSheet('load'); }} aria-label="保存したものを開く">ほかの1冊を開く</Button>
          </div>
        </Modal>
      )}

      {cautionOpen && (
        <Modal title="刷る前に" onClose={() => setCautionOpen(false)}>
          <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[13px] leading-relaxed">
            {cautions.map((c, i) => <li key={i} className="caution">{c}</li>)}
          </ul>
        </Modal>
      )}

      {insertAt !== null && (
        <AddSection
          job={job} print={print}
          positioned
          cover={false}
          onPick={kind => {
            const where = insertAt;
            setInsertAt(null);
            setBook(b => ({ ...b, sections: withSection(b.sections, sectionOf(kind, bodyOf(b)), where) }));
            goTo(where, 0);
          }}
          onClose={() => setInsertAt(null)}
        />
      )}

      {held !== null && book.sections[held] && (
        <Modal title={sectionLabel(book.sections[held])} onClose={() => setHeld(null)}>
          <p className="m-0 text-[13px] text-muted">{sectionSpan(book.sections[held])}</p>
          {!book.sections[held].cover && !book.sections[held].backCover && (
            <span className="flex gap-1.5">
              <Button variant="quiet" className="flex-1" disabled={!canMove(held, -1)} onClick={() => { moveSection(held, -1); setHeld(held - 1); }}>← 前へ</Button>
              <Button variant="quiet" className="flex-1" disabled={!canMove(held, 1)} onClick={() => { moveSection(held, 1); setHeld(held + 1); }}>後ろへ →</Button>
            </span>
          )}
          {book.sections.length > 1 && (
            <Button variant="quiet" className="text-danger" onClick={() => { dropSection(held); setHeld(null); }}>この{book.sections[held].cover ? '表紙' : book.sections[held].backCover ? '裏表紙' : 'まとまり'}を外す</Button>
          )}
        </Modal>
      )}

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

// A small round control sitting over a block on the sheet. Positioned onto a
// drawing rather than laid out, so it is not an ordinary Button.
export function RoundButton({ left, top, label, onClick, hook = 'clearmini', children }: {
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
export function DividerHandle({ box, teach, onDown, onMove, onUp }: {
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
export function BindingRail({ sections, at, size, print, job, onGo, onAddCover, onFillBack, onList, onPaper, onBook, compact = false }: {
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
  onBook?: () => void;
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
          ? tile('cover', at === 0, <SheetGlyph size={size} box={{ w: 34, h: 44 }} />,
              '表紙', 'p.1', () => onGo(0), '')
          : spreads && tile('cover', false, empty, '表紙', 'p.1', onAddCover, 'addbefore', '表紙を入れる')}
        {body.map(({ sec, i }) => {
          const one = body.length === 1;
          const dated = hasDatedPart(sec);
          const end = dated ? runEnd(sec) : null;
          const n = sheetCount(sec);
          // White paper, as on the size and form screens: the shape is the
          // form, and the size's colour is the screen's, not each picture's.
          const plan = sec.fold > 1 ? foldOf(sec, size) : null;
          const picture = plan ? <FormGlyph2 size={size} plan={plan} box={{ w: 72, h: 44 }} />
            : sec.spread
              ? <FormGlyph2 size={size} pages={2} box={{ w: 64, h: 44 }} />
              : <SheetGlyph size={size} box={{ w: 34, h: 44 }} />;
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
          <SheetGlyph size={size} box={{ w: 34, h: 44 }} />,
          '裏表紙', pagesFor(backAt), () => onGo(backAt), '')}
        {backAt < 0 && backBlank && (filled
          ? tile('back', false, empty, '裏表紙', `p.${all.length}`, onFillBack, 'fillback', '裏表紙に入れる')
          : tile('back', false, waiting, '裏表紙', `p.${all.length}`, () => {}, 'fillback cursor-default',
              '裏表紙（見開きに何か置くと入れられます）', true))}
    </>
  );
  if (compact) {
    return (
      <div className="rail flex shrink-0 items-center gap-1.5 px-3 pb-1 pt-0.5">
        {/* The runs scroll; the way into the whole book stays put at the end. */}
        <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto">{tiles}</div>
        <Button variant="chip" className="bookmenu" onClick={onBook ?? onList} aria-label="この1冊">
          <ListGlyph />1冊
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
export function PaperSetting({ className = '', label, value, sample, onClick }: {
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
