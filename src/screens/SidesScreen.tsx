import { useMemo } from 'react';
import type { FoldCount, FoldGrain, Layout, RefillSize } from '../types';
import { SIZES } from '../lib/sizes';
import { FOLD_PANELS, foldGrainsOf, foldPlan } from '../lib/fold';
import type { FoldPlan } from '../lib/fold';
import { Button } from '../ui/Button';
import { placeParts } from '../lib/layout';
import { buildPages } from '../lib/render/pages';
import { PageSvg } from '../lib/render/svg';
import { createLayout } from '../app/book';
import { Choice } from '../app/bits';
import { FoldIcon, FormGlyph2, SheetGlyph } from '../app/icons';
import { SIZE_COLOR, SIZE_WORD, SIZE_NAME, sizeMm, sizeHoles, cardSkin } from '../app/look';
import { useWide, PICK_SCREEN } from '../app/screen';

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
export function FormCards({ size, spread, fold, foldGrain, wide, onPick }: {
  size: RefillSize;
  spread: boolean;
  fold: FoldCount;
  foldGrain?: FoldGrain;
  wide: boolean;
  onPick: (v: { spread: boolean; fold: FoldCount; foldGrain?: FoldGrain }) => void;
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
      // Words, not millimetres: this is a choice of shape, and the numbers
      // are the editor's business once the shape is chosen.
      // What it is for, which is what the choice is made on.
      note: g === 'along' ? '下へ広げる1本の帯' : '畳んで綴じ、広げると横長に使える。長い表や年間の予定に',
      plan,
    }];
  });
  const choices: Choice[] = [
    {
      key: 'spread', on: flat && spread, pick: { spread: true, fold: 1 },
      title: '見開き（2ページ）', note: '左右のページを並べて、1ヶ月分や1週間を大きく使う',
      // The left page's rings are drawn on its right: in a spread the binding
      // is the seam, which is the one thing a picture of it has to get right.
      sheets: [true, false],
    },
    {
      key: 'single', on: flat && !spread, pick: { spread: false, fold: 1 },
      title: '片面（1ページ）', note: '1ページで完結。メモやリストに', sheets: [false],
    },
    ...foldCards('out'),
  ];
  // The L goes below, under a heading of its own. It is not a fourth way of
  // arranging pages: it is the same fold with the paper cut into an L, which
  // one size can do and the rest cannot. Mixed into the run above it read as
  // an ordinary alternative, and the extra cut went unsaid.
  const special = grains.includes('along') ? foldCards('along') : [];
  const all = [...choices, ...special];
  const glyph = (c: Choice, box: { w: number; h: number }) => (c.plan
    ? (c.plan.grain === 'along'
      ? <FoldIcon size={spec} color="#A9A9A3" plan={c.plan} scale={Math.min(box.w / c.plan.sheetWmm, box.h / c.plan.sheetHmm)} rings />
      : <FormGlyph2 size={spec} plan={c.plan} box={box} />)
    : <FormGlyph2 size={spec} pages={c.sheets!.length as 1 | 2} box={box} />);

  // One row per form, read down like the sizes: a small picture, the name and
  // what it is for, and its width at the end.
  const row = (c: Choice) => (
    <button
      key={c.key}
      className="card relative flex min-w-0 items-center gap-3 overflow-hidden rounded-xl border-[1.5px] py-2.5 pl-3 pr-3 text-left"
      style={cardSkin(c.on, color)}
      aria-pressed={c.on}
      onClick={() => onPick(c.pick)}
    >
      <span className="flex h-[40px] w-[56px] shrink-0 items-center justify-center">{glyph(c, { w: 56, h: 40 })}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <strong className="truncate text-[15px] font-semibold leading-tight">{c.title}</strong>
        {/* Broken after a comma or a full stop, never inside a word. */}
        <span className="text-[12px] leading-snug text-muted [&>span]:inline-block">
          {c.note.split(/(?<=[、。])/).map((w, i) => <span key={i}>{w}</span>)}
        </span>
      </span>
      <span aria-hidden="true" className="w-3 shrink-0 text-center text-[15px] leading-none" style={{ color: c.on ? SIZE_WORD[size] : 'var(--color-muted)' }}>
        {c.on ? '✓' : ''}
      </span>
    </button>
  );

  return (
    <>
      {/* The choices come first. A large drawing of the one picked sat above
          them and pushed the last card under the fold; each card already
          carries its own drawing, so the large one only repeated it. */}
      <div className={`grid gap-2 ${wide ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {choices.map(row)}
      </div>
      {special.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div>
            <h2 className="m-0 text-[14px] font-semibold">特殊蛇腹（L字）</h2>
            <p className="m-0 mt-0.5 text-[13px] leading-snug text-muted">
              {`${SIZE_NAME[size]}だけの形。折り目がリングと直角なので、`
                + '内側の面は綴じ側を少し切り落とします'}
            </p>
          </div>
          <div className={`grid gap-2 ${wide ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {special.map(row)}
          </div>
        </div>
      )}
    </>
  );
}

// The form picked, as paper: this size in this shape with a monthly on it,
// drawn by the code that prints it. It sits under the list, so it never pushes
// a choice out of sight, and the button stays where it is at the bottom.
function FormSample({ size, spread, fold, foldGrain, title }: {
  size: RefillSize; spread: boolean; fold: FoldCount; foldGrain?: FoldGrain; title: string;
}) {
  const spec = SIZES[size];
  const pages = useMemo(() => {
    const base: Layout = { ...createLayout(), size, spread, fold, foldGrain };
    return buildPages(placeParts(base, spec, ['monthly'], null)?.layout ?? base, spec);
  }, [size, spread, fold, foldGrain, spec]);
  const down = fold > 1 && foldGrain === 'along';
  const w = down ? Math.max(...pages.map(p => p.widthMm)) : pages.reduce((a, p) => a + p.widthMm, 0);
  const h = down ? pages.reduce((a, p) => a + p.heightMm, 0) : Math.max(...pages.map(p => p.heightMm));
  const scale = Math.min(300 / w, 150 / h);
  return (
    <figure className="formsample m-0 flex shrink-0 flex-col items-center gap-2 rounded-xl bg-white px-3 pb-3 pt-4 shadow-[0_0_0_1px_var(--color-line)]">
      <span className={`flex gap-[2px] drop-shadow-[0_1px_2px_rgba(0,0,0,0.15)] ${down ? 'flex-col' : ''}`}>
        {pages.map((p, i) => <PageSvg key={i} page={p} scale={scale} />)}
      </span>
      <figcaption className="text-[12px] text-muted">{`${SIZE_NAME[size]}の${title}に、マンスリーを置いた見本`}</figcaption>
    </figure>
  );
}

// The name of a form, as the bar under the choices says it.
export function formTitle(size: RefillSize, spread: boolean, fold: FoldCount, foldGrain?: FoldGrain) {
  if (fold <= 1) return spread ? '見開き（2ページ）' : '片面（1ページ）';
  const grains = foldGrainsOf(SIZES[size]);
  const g = foldGrain && grains.includes(foldGrain) ? foldGrain : grains[0];
  return `${g === 'along' ? 'L字' : '蛇腹'}${fold}面`;
}

export function SidesScreen({ size, spread, fold, foldGrain, onPick, onBack, onConfirm }: {
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
      {/* Everything between the title and the button scrolls, so nothing in it
          is squeezed to fit. As plain children of the screen's column they all
          had flex-shrink, and on a short window the strip was the first to
          give: on Micro5 it went from 97px to 18px and the name and the sheet
          were clipped away, leaving a bar with 「62×105mm」 in it. */}
      <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto">
      {/* One line: what is settled stays in sight but leaves the room to the
          choices. Grey, not a card, so it does not read as one of them. */}
      <button
        className="sizenow relative flex w-full min-w-0 shrink-0 items-center gap-3 overflow-hidden rounded-lg border border-line py-2 pl-4 pr-3 text-left hover:border-line-strong lg:w-auto lg:self-start lg:pr-4"
        style={{ background: 'rgba(38,36,31,0.04)' }}
        onClick={onBack}
      >
        <span className="absolute inset-y-0 left-0 w-1.5" style={{ background: color }} />
        <span className="flex h-[32px] w-[28px] shrink-0 items-center justify-center">
          <SheetGlyph size={spec} box={{ w: 26, h: 32 }} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-[11px] leading-tight text-muted">選択中のサイズ</span>
          <span className="truncate leading-tight">
            <strong className="text-[15px] font-semibold">{SIZE_NAME[size]}</strong>
            <span className="ml-2 text-[12px] text-muted">{sizeMm(spec)}・</span>
            <span className="text-[12px] font-semibold" style={{ color: SIZE_WORD[size] }}>{sizeHoles(spec)}</span>
          </span>
        </span>
        <span className="shrink-0 text-[13px] text-accent-text">変更</span>
      </button>
      {/* Side by side, on the same two-column grid as the picker. A comparison
          reads across, not down: stacked, these were the same drawing seen
          twice in a row instead of one beside the other. Which also settles
          the shape of the card -- half the screen is too narrow to set a title
          beside the paper, so the paper goes on top and the words underneath.
          Every card keeps one box the height of the largest sheet, so a folded
          strip and a pair of pages are drawn to the same scale. */}
      <FormCards
        size={size} spread={spread} fold={fold} foldGrain={foldGrain}
        wide={wide} onPick={onPick}
      />
      <FormSample size={size} spread={spread} fold={fold} foldGrain={foldGrain} title={formTitle(size, spread, fold, foldGrain)} />
      {/* The note that was here said three things about a fold, and the
          drawing now says two of them better: the rings are on the head panel
          only because that is where they are drawn, and what it comes to when
          shut is the card's own line (「畳むと80×128mm」). The third was the
          inner panels' millimetres, which is a number for laying parts out,
          not for choosing a form -- and the picture of a strip cut into
          numbered panels is what the choice is made on. */}
      </div>
      {/* What is picked, beside the button that goes with it: the list scrolls,
          and the choice should not scroll away with it. */}
      <div className="formbar mt-auto flex shrink-0 items-center gap-3">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-[11px] leading-tight text-muted">選択中の構成</span>
          <strong className="truncate text-[15px] font-semibold leading-tight">{formTitle(size, spread, fold, foldGrain)}</strong>
        </span>
        <Button variant="cta" className="shrink-0 px-6" onClick={onConfirm}>この構成で作る</Button>
      </div>
    </div>
  );
}
