import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { Book, Layout } from '../types';
import { SIZES } from '../lib/sizes';
import { buildGeometry, ringsOnTop } from '../lib/layout';
import type { PageGeometry } from '../lib/layout';
import type { Page } from '../lib/draw';
import { buildPages, sheetAt } from '../lib/render/pages';
import type { PrintOptions } from '../lib/render/pages';
import { PageSvg } from '../lib/render/svg';
import { Button } from '../ui/Button';
import { createLayout, isPlaceholder, bodyOf, pagesOf } from '../app/book';
import type { SectionKind, Leaf } from '../app/book';
import { ringOut } from '../app/look';
import { GAP } from '../app/screen';
import { AddSection } from '../sheets/AddSection';

// How long one leaf takes to go over: felt, not watched. A riffle is quicker
// because several are going over at once.
export const TURN_MS = 170;

export const RIFFLE_MS = 90;

// Past this a swipe is a riffle rather than a turn, in pixels per millisecond.
// A deliberate turn is a third of the screen in a third of a second, which is
// 0.4; a flick is the same distance in a tenth, which is 4. The line between
// them is nearer the flick, because turning one page when three were asked for
// is a smaller mistake than the other way round.
export const RIFFLE_SPEED = 1.6;

// How far a swipe has to go before it is a turn at all, and how far down
// before it is the way out.
export const SWIPE_PX = 30;

export const SHUT_PX = 60;

// The binder's rings: hardware, so neither the paper's colour nor the app's.
export const RING_INK = '#D2CCC1';

export const RING_EDGE = '#8E887C';

// How many sheet edges a stack shows before one more stops reading.
export const STACK_MAX = 8;

export function BookView({ book, at, nth, print, onClose, onEdit, onAddAt }: {
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
