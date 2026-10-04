import { useMemo, useState } from 'react';
import type { Book, Layout, SizeSpec } from '../types';
import { SIZES } from '../lib/sizes';
import { foldOf, isLandscape, placeParts as planPlacement, ringsOnTop } from '../lib/layout';
import { addDays, addMonths, isoDate, runDates } from '../lib/dates';
import { hasDatedPart, isDayPaced, duplexFlipOf, imposeCount, MONTH_PACED, sheetCount, sheetSizeOf } from '../lib/render/pages';
import type { BackFill, PrintOptions } from '../lib/render/pages';
import { PAPER_ORDER, PAPERS } from '../lib/render/impose';
import type { PaperId } from '../lib/render/impose';
import { deleteBook, listBooks } from '../lib/storage';
import { Button } from '../ui/Button';
import { Field, Segmented, Stepper } from '../ui/Field';
import { Sheet } from '../ui/Overlay';
import { EdgeNote, Thumb, Choice } from '../app/bits';
import { PART_LABEL, sectionLabel, runText, usePaperJob } from '../app/book';
import type { SectionKind } from '../app/book';
import { readable } from '../app/look';
import type { SheetTarget } from '../app/screen';
import { FormCards } from '../screens/SidesScreen';
import { SizeCards } from '../screens/SizeScreen';
import { AddSection } from './AddSection';
import { PrintPreview } from './PrintPreview';
import { SaveSheet } from './files';
import { PhotoField, ImportedSheet, LookSheet, BackgroundSheet, PageSheet } from './settings';

export const ymd = (d: Date) => `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;

// Move a day-paced run to begin on a day. The months go with it: they still
// name how long the run is and still feed everything paced by months, so a
// start in August with the months left saying September would have the two
// halves of the same setting disagreeing.
export const startOn = (l: Layout, d: Date): Layout => ({
  ...l, runStart: isoDate(d), year: d.getFullYear(), month: d.getMonth() + 1,
});

export function PartSheet({
  target, book, layout, setLayout, inline, onClose, onRemove, onRemoveSpanning, onLoad, onSave,
  size, onExport, onExportFrames, print, setPrint, onAddSection, setBook, say, nth, onImport,
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
  onExportFrames: (opts: PrintOptions) => void;
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
            {/* For decorating in Canva and the like: the frame alone, a page
                to a refill. Quiet, because printing is what this sheet is for. */}
            <div className="flex flex-col gap-1">
              <Button variant="quiet" className="frameexport" onClick={() => onExportFrames(print)}>
                枠だけ書き出す（Canvaなどで飾る用）
              </Button>
              <p className="m-0 text-[13px] leading-snug text-muted">
                1ページにリフィル1枚。穴の目印と切り取り線は入れません。とじ穴の側には絵を置かないでください
              </p>
            </div>
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
