import { useLayoutEffect, useState } from 'react';
import type { FoldCount, FoldGrain, RefillSize } from '../types';
import { SIZES } from '../lib/sizes';
import { FOLD_PANELS, foldGrainsOf, foldPlan } from '../lib/fold';
import type { FoldPlan } from '../lib/fold';
import { Button } from '../ui/Button';
import { Choice } from '../app/bits';
import { SizeIcon, FoldIcon } from '../app/icons';
import { SHEET_SCALE, ringOut, SIZE_COLOR, SIZE_WORD, SIZE_NAME, sizeMm, sizeHoles, nameSize, cardSkin } from '../app/look';
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
export function FormCards({ size, spread, fold, foldGrain, wide, onPick, onScale }: {
  size: RefillSize;
  spread: boolean;
  fold: FoldCount;
  foldGrain?: FoldGrain;
  wide: boolean;
  onPick: (v: { spread: boolean; fold: FoldCount; foldGrain?: FoldGrain }) => void;
  // Whatever draws this paper above the cards has to draw it the same size,
  // so the scale the cards settle on is handed back.
  onScale?: (k: number) => void;
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
  // The drawing is the choice, so it gets the room: as large as the widest
  // one on this screen can be and still fit a card, and one box only as tall
  // as the tallest of them -- the picker's own slot is A5's, which on
  // 横長ミニ3穴 left four rows of empty air above a 55mm strip. One scale for
  // every card, or a folded strip and a pair of pages could not be compared.
  const all = [...choices, ...special];
  const widestMm = Math.max(...all.map(c => (c.plan ? c.plan.sheetWmm : spec.widthMm * c.sheets!.length)));
  const tallestMm = Math.max(...all.map(c => (c.plan ? c.plan.sheetHmm : spec.heightMm)));
  const k = Math.min(SHEET_SCALE * 2.2, (wide ? 190 : 140) / widestMm);
  // The box the sheets are drawn in: one constant area, the same on every
  // card, so a sheet that fills more of it is a bigger sheet. The slot was
  // already this ruler -- shading it makes the comparison visible instead of
  // leaving it to be noticed. Plain grey, not ruled: a field of dots behind a
  // ruled sheet is two grids arguing, and the one that matters is the sheet's.
  // A margin of table around even the widest sheet: with the box cut exactly
  // to the widest one, that card's grey never showed, and a ruler you cannot
  // see on the longest thing you are measuring is not a ruler.
  const field = {
    width: (widestMm + ringOut(spec)) * k + 16,
    height: tallestMm * k + 12,
    backgroundColor: 'rgba(38,36,31,0.05)',
  } as const;
  // How wide the thing is when it is open, said under the drawing as the line
  // anyone measuring it would draw. The L folds downward, where a line under
  // it would be measuring the wrong edge, so it keeps to its note.
  const span = (c: Choice) => {
    if (c.plan) {
      return c.plan.grain === 'along'
        ? null
        : { mm: c.plan.sheetWmm, text: `広げて${Math.round(c.plan.sheetWmm)}mm` };
    }
    // Just the number: the title above already says how many pages it is.
    const mm = spec.widthMm * c.sheets!.length;
    return { mm, text: `${mm}mm` };
  };

  const card = (choice: Choice) => (
    <button
      key={choice.key}
      className="card flex flex-col items-center gap-2 rounded-[18px] border-[1.5px] px-2 py-3 text-center"
      style={cardSkin(choice.on, color)}
      aria-pressed={choice.on}
      onClick={() => onPick(choice.pick)}
    >
      {/* No gap between the two pages of a spread: each page's box already
          carries the room its own rings stand out into, and what meets in the
          middle is the one ring the two of them hang on. */}
      <span className="ruler flex items-center justify-center rounded-[10px]" style={field}>
        {choice.plan
          ? <FoldIcon size={spec} color={color} plan={choice.plan} scale={k} rings />
          : choice.sheets!.map((flip, i) => (
            <SizeIcon
              key={i} size={spec} color={color} flip={flip} scale={k} rings
            />
          ))}
      </span>
      {/* The rule keeps the size's bright colour -- a rule is a shape, not a
          word -- and the millimetres under it take the darkened one: Bible's
          pale blue at 11px came to 2.45:1. */}
      {span(choice) && (
        <span className="dim -mt-1 flex flex-col items-center" style={{ color }}>
          <svg width={Math.round(span(choice)!.mm * k)} height={7} aria-hidden="true" className="block">
            <g stroke="currentColor" strokeWidth={1}>
              <line x1={0.5} y1={3.5} x2={span(choice)!.mm * k - 0.5} y2={3.5} />
              <line x1={0.5} y1={0.5} x2={0.5} y2={6.5} />
              <line x1={span(choice)!.mm * k - 0.5} y1={0.5} x2={span(choice)!.mm * k - 0.5} y2={6.5} />
            </g>
          </svg>
          <em
            className="not-italic text-[13px] font-semibold leading-tight"
            style={{ color: SIZE_WORD[size] }}
          >{span(choice)!.text}</em>
        </span>
      )}
      <span className="flex flex-col gap-0.5">
        <strong className="text-[14px] font-semibold leading-tight">{choice.title}</strong>
        <span className="text-[13px] leading-tight text-muted">{choice.note}</span>
      </span>
    </button>
  );

  useLayoutEffect(() => { onScale?.(k); }, [k, onScale]);

  return (
    <>
      {/* Side by side. A comparison reads across, not down: stacked, these
          were the same drawing seen twice in a row instead of one beside the
          other. Every card keeps one box the height of the largest sheet, so
          a folded strip and a pair of pages are drawn to the same scale. */}
      <div className="grid grid-cols-2 gap-1.5 lg:grid-cols-4">
        {choices.map(choice => card(choice))}
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
          <div className="grid grid-cols-2 gap-1.5 lg:grid-cols-4">
            {special.map(choice => card(choice))}
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
  // The cards below decide it; the sheet in the strip above has to match.
  const [k, setK] = useState(SHEET_SCALE);
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
        <span
          className="flex shrink-0 items-center justify-center"
          style={{ width: (spec.widthMm + ringOut(spec)) * k, height: spec.heightMm * k }}
        >
          <SizeIcon size={spec} color={color} scale={k} rings />
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
        wide={wide} onPick={onPick} onScale={setK}
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
