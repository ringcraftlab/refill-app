import { useMemo, useState } from 'react';
import type { Layout, SizeSpec } from '../types';
import { buildPrintSheets, hasDatedPart, sheetSizeOf } from '../lib/render/pages';
import type { PrintOptions } from '../lib/render/pages';
import type { TilePlan } from '../lib/render/impose';
import { SheetSvg } from '../lib/render/svg';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import type { PaperJob } from '../app/book';

// The places on a printed sheet that nothing is going on, drawn over the
// sheet itself. The imposition centres the block and fills it in order, so
// the empty ones are the last places of the last sheet -- mirrored on a back,
// because that is what the paper does when it is turned over.
// Where one place on the printed sheet sits, as a fraction of the paper. The
// artwork is scaled about the paper's centre, so the places are too, or a mark
// would sit beside the square it names.
export function placeStyle(
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
export function PlaceNumbers({ plan, tile, count, mirror, scalePercent, numberOf, small }: {
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

export function SpareSlots({ plan, tile, first, count, mirror, scalePercent, empty, onPress }: {
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

// Only the first few, because a year of refills is a lot of paper and the
// pattern is clear by the second sheet.
export const PREVIEW_PAGES = 4;

// Big enough that a place on the sheet can be pressed. At 110 an A3 of twelve
// was 18px a place, which is a picture, not a control.
export const PREVIEW_PX = 168;

// Imposed, duplexed sheets look like nonsense until you see them laid out and
// numbered. Showing them here means the options can be judged before anyone
// spends ink on them.
export function PrintPreview({ layout, size, print, also, job, onPlus, onPage }: {
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
