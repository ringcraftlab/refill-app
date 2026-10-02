import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Book, Layout } from '../types';
import { SIZES } from '../lib/sizes';
import { foldOf } from '../lib/layout';
import { hasDatedPart, sheetAt, sheetCount } from '../lib/render/pages';
import type { PrintOptions } from '../lib/render/pages';
import { PAPERS } from '../lib/render/impose';
import { Button } from '../ui/Button';
import { Dialog, Modal } from '../ui/Overlay';
import { Thumb } from '../app/bits';
import { formLabel, sectionOf, withSection, sectionLabel, oneForm, bodyOf, sectionMark, pagesOf, shortenTo, runText, sectionSpan, usePaperJob } from '../app/book';
import { useWide, PICK_SCREEN } from '../app/screen';
import { AddSection } from '../sheets/AddSection';

// The contents of one book, in the order it is bound. A commercial refill set
// is a sequence -- year planner, then monthlies, then weeklies, then notes --
// and that sequence is the thing being made. Everything else in this app
// (dividing a surface, dropping parts, the paper) is about one section of it.
//
// The list is a list rather than a picture on purpose: what it answers is
// "what is in here and in what order", and a picture of the paper answers a
// different question (which the export screen answers, with the ＋ on it).
export function ContentsScreen({ book, setBook, print, at, nth, onOpen, onBack, onImport }: {
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
