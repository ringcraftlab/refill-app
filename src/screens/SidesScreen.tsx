import type { FoldCount, FoldGrain, RefillSize } from '../types';
import { SIZES } from '../lib/sizes';
import { FOLD_PANELS, foldGrainsOf, foldPlan } from '../lib/fold';
import type { FoldPlan } from '../lib/fold';
import { Button } from '../ui/Button';
import { Choice } from '../app/bits';
import { FoldIcon, FormGlyph2, SheetGlyph } from '../app/icons';
import { SIZE_COLOR, SIZE_WORD, SIZE_NAME, sizeMm, sizeHoles, nameSize, cardSkin } from '../app/look';
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
  const all = [...choices, ...special];
  const picked = all.find(c => c.on) ?? all[0];
  // How wide the thing is when it is open -- the number someone measuring it
  // on the table would get. The L folds downward, so it says its box instead.
  const span = (c: Choice) => (c.plan
    ? (c.plan.grain === 'along' ? `${Math.round(c.plan.sheetWmm)}×${Math.round(c.plan.sheetHmm)}mm` : `広げて${Math.round(c.plan.sheetWmm)}mm`)
    : `${spec.widthMm * c.sheets!.length}mm`);
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
        <span className="truncate text-[12px] leading-tight text-muted">{c.note}</span>
      </span>
      <span className="shrink-0 text-[13px] font-semibold tabular-nums" style={{ color: SIZE_WORD[size] }}>{span(c)}</span>
      <span aria-hidden="true" className="w-3 shrink-0 text-center text-[15px] leading-none" style={{ color: c.on ? SIZE_WORD[size] : 'var(--color-muted)' }}>
        {c.on ? '✓' : ''}
      </span>
    </button>
  );

  return (
    <>
      {/* The one picked, drawn large: pressing a row below redraws this and
          nothing else, so the eye stays on the shape while the finger moves. */}
      <figure className="formpreview m-0 flex flex-col items-center gap-2 rounded-xl bg-white px-3 pb-3 pt-4 shadow-[0_0_0_1px_var(--color-line)]">
        <span className="flex h-[150px] w-full items-center justify-center">{glyph(picked, { w: wide ? 360 : 290, h: 150 })}</span>
        <figcaption className="text-[13px] font-semibold" style={{ color: SIZE_WORD[size] }}>
          {picked.plan?.grain === 'along' ? picked.note : `${span(picked)}・${picked.note}`}
        </figcaption>
      </figure>
      <div className={`grid gap-2 ${wide ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {choices.map(row)}
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
          <div className={`grid gap-2 ${wide ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {special.map(row)}
          </div>
        </div>
      )}
    </>
  );
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
        <span className="flex h-[44px] w-[40px] shrink-0 items-center justify-center">
          <SheetGlyph size={spec} box={{ w: 36, h: 44 }} />
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
        wide={wide} onPick={onPick}
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
