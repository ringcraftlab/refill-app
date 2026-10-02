import { useState } from 'react';
import type { RefillSize, SizeSpec } from '../types';
import { SIZES } from '../lib/sizes';
import { Button } from '../ui/Button';
import { LogoMark, SheetGlyph } from '../app/icons';
import { SIZE_GROUPS, SIZE_COLOR, SIZE_WORD, SIZE_NAME, sizeMm, sizeHoles, cardSkin } from '../app/look';
import { useWide, PICK_SCREEN } from '../app/screen';

// The nine sizes as a list to read down: a small sheet, the name and its
// hole count, then what a binder is measured by -- the paper, and the punch.
// The punch is what decides whether a refill fits, and it is the one thing a
// name like 「バイブル」 does not tell someone holding a binder of a brand that
// calls it something else.
const punch = (s: SizeSpec) => {
  const h = s.holes;
  return `φ${h.diameterMm}mm・${h.pitchMm}mmピッチ${h.centreGapMm ? `・中央${h.centreGapMm}mm` : ''}`;
};

export function SizeCards({ selected, wide, onPick }: {
  selected: RefillSize; wide: boolean; onPick: (s: RefillSize) => void;
}) {
  return (
    <div className="mb-auto flex w-full flex-col gap-4 py-0.5">
      {SIZE_GROUPS.map(group => (
        <section key={group.title} className="flex flex-col gap-2">
          <h2 className="sect m-0 flex items-center gap-2 text-[13px] font-bold tracking-[0.04em] text-muted">{group.title}</h2>
          <div className={`grid gap-2 ${wide ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {group.rows.flat().map(id => {
              const on = selected === id;
              return (
                <button
                  key={id}
                  onClick={() => onPick(id)}
                  className="sizerow relative flex min-w-0 items-center gap-3 overflow-hidden rounded-xl border-[1.5px] py-2.5 pl-4 pr-3 text-left"
                  style={cardSkin(on, SIZE_COLOR[id])}
                  aria-pressed={on}
                >
                  {/* The size's colour, flush to the card's edge. */}
                  <span
                    className="absolute right-2.5 top-2 rounded px-1.5 py-[1px] text-[11px] font-bold leading-tight text-white"
                    style={{ background: SIZE_WORD[id] }}
                  >{sizeHoles(SIZES[id])}</span>
                  <span className="absolute inset-y-0 left-0 w-1.5" style={{ background: SIZE_COLOR[id] }} />
                  <span className="flex h-[52px] w-[44px] shrink-0 items-center justify-center">
                    <SheetGlyph size={SIZES[id]} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    {/* Room on the right for the hole count, which sits in the
                        card's corner like a tab on a sheet. */}
                    <strong className="truncate pr-10 text-[16px] font-semibold leading-tight">{SIZE_NAME[id]}</strong>
                    <span className="text-[13px] leading-tight text-ink tabular-nums">{sizeMm(SIZES[id])}</span>
                    <span className="truncate text-[12px] leading-tight text-muted tabular-nums">{punch(SIZES[id])}</span>
                  </span>
                  <span
                    aria-hidden="true"
                    className="shrink-0 text-[15px] leading-none"
                    style={{ color: on ? SIZE_WORD[id] : 'var(--color-muted)' }}
                  >{on ? '✓' : '›'}</span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

// Choosing a size and going on are two presses, as they are on the form
// screen: the card pressed stays chosen where it can be seen and changed,
// and the move to the next screen is the button's, not the card's.
export function SizeScreen({ selected, onPick }: { selected: RefillSize; onPick: (s: RefillSize) => void }) {
  const wide = useWide();
  const [chosen, setChosen] = useState<RefillSize>(selected);
  return (
    <div className={`sizescreen ${PICK_SCREEN}`}>
      {/* The mark: a spread in the app's blue and yellow, held by rings seen
          from straight above -- upright, so short rigid bars from hole to
          hole rather than loops lying on the paper. Only here, before
          anything is made. */}
      <div className="brand flex items-center gap-2.5 text-[13px] font-semibold tracking-[0.22em] text-label">
        <LogoMark className="h-[30px] w-auto" />
        RING CRAFT LAB
      </div>
      <div>
        <h1 className="font-serif text-[22px] font-semibold">手帳のサイズを選ぶ</h1>
        <p className="m-0 mt-1 text-[13px] text-muted">お使いの手帳のサイズを選んでください</p>
        <i aria-hidden="true" className="mt-2.5 block h-[3px] w-7 bg-hi" />
      </div>
      {/* The list starts under the heading rather than floating in the middle
          of the screen, and `mb-auto` keeps it there whether or not it
          overflows -- `justify-center` on a scrolling column would push the
          first row above the scroll origin, where nothing can reach it. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <SizeCards selected={chosen} wide={wide} onPick={setChosen} />
      </div>
      <Button variant="cta" className="sizego shrink-0" onClick={() => onPick(chosen)}>
        {SIZE_NAME[chosen]}で作る
      </Button>
    </div>
  );
}
