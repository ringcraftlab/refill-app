import { useState } from 'react';
import type { RefillSize } from '../types';
import { SIZES } from '../lib/sizes';
import { Button } from '../ui/Button';
import { LogoMark, SizeIcon } from '../app/icons';
import { SIZE_GROUPS, SHEET_SLOT, SIZE_COLOR, SIZE_WORD, SIZE_NAME, sizeMm, sizeHoles, nameSize, cardSkin } from '../app/look';
import { useWide, PICK_SCREEN } from '../app/screen';

// The nine sizes, laid out to be compared. Extracted from the screen that
// asks for one first, because the same cards are what the paper's own chip
// opens later -- the size is a property of the paper, not a step you passed.
export function SizeCards({ selected, wide, onPick }: {
  selected: RefillSize; wide: boolean; onPick: (s: RefillSize) => void;
}) {
  return (
          <div className="mb-auto flex w-full flex-col gap-3 py-0.5">
            {SIZE_GROUPS.map(group => (
              <section key={group.title} className="flex flex-col gap-1.5">
                <h2 className="sect m-0 flex items-center gap-2 text-[13px] font-bold tracking-[0.04em] text-muted">{group.title}</h2>
                {/* A grid, not nested flex rows: its columns are exactly half
                    each, where a flex item would refuse to shrink below its own
                    name and the longest one on a row would push the column edge
                    over. */}
                <div className="grid grid-cols-2 gap-1.5 lg:grid-cols-4">
                  {(wide ? group.rows.flat() : group.rows.flatMap(row => (row.length === 1 ? [...row, null] : row))).map((id, i) => (
                    id === null
                      // A size with no partner leaves the rest of its row empty
                      // rather than pulling the next pair apart.
                      ? <span key={`empty-${i}`} aria-hidden="true" />
                      : (
                        <button
                          key={id}
                          onClick={() => onPick(id)}
                          className={`sizerow relative flex min-w-0 items-center gap-1 overflow-hidden rounded-[18px] border-[1.5px] py-2 pl-3 pr-1 text-left`}
                          style={cardSkin(selected === id, SIZE_COLOR[id])}
                          aria-pressed={selected === id}
                        >
                          {/* A colour a glance can learn the size by, before the
                              name is read. Flush to the card's own edge and its
                              full height: a bar with air around it is a shape
                              sitting on the card, and this is meant to be the
                              card's edge. */}
                          <span
                            className="absolute inset-y-0 left-0 w-1.5"
                            style={{ background: SIZE_COLOR[id] }}
                          />
                          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <strong className={`truncate font-semibold leading-tight ${nameSize(SIZE_NAME[id])}`}>
                              {SIZE_NAME[id]}
                            </strong>
                            <span className="truncate text-[13px] leading-tight text-muted">
                              {sizeMm(SIZES[id])}
                            </span>
                            {/* In the size's own colour, which is the one place
                                that colour carries a fact rather than a label:
                                the sizes sharing a hole count are the sizes
                                whose sheets swap between binders. Darkened to
                                the point where ten pixels of it can be read. */}
                            <span
                              className="truncate text-[13px] font-semibold leading-tight"
                              style={{ color: SIZE_WORD[id] }}
                            >
                              {sizeHoles(SIZES[id])}
                            </span>
                          </span>
                          <span className="flex shrink-0 items-center justify-center" style={SHEET_SLOT}>
                            <SizeIcon size={SIZES[id]} color={SIZE_COLOR[id]} rings />
                          </span>
                          {/* Decoration: it says "this opens something", which
                              the button already says, so it stays out of the
                              name a screen reader reads -- and off a 320px
                              screen entirely. It and its gap cost 9px of the
                              135px card, which at that width is the difference
                              between "148×210mm" and "148×210m…", and the
                              millimetres are the only clue left to someone who
                              does not know the names. */}
                          <span aria-hidden="true" className="hidden shrink-0 text-[14px] leading-none text-muted min-[360px]:block">›</span>
                        </button>
                      )
                  ))}
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
