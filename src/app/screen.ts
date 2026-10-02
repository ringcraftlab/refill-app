import { useLayoutEffect, useState } from 'react';
import type { Layout } from '../types';

export type Stage = 'home' | 'size' | 'sides' | 'contents' | 'canvas' | 'book';

// A rectangle on screen, in the page area's own pixels.
export type Box = { key: string; left: number; top: number; width: number; height: number };

export type SheetTarget =
  { slot: number } | 'spanning' | 'load' | 'save' | 'print'
  // `sheet` is the refill itself -- which size it is and what form it takes.
  // `paper` is the A4 it gets printed on. Two different pieces of paper, and
  // the confusion between them is why they are named apart here.
  | 'sheet' | 'paper' | 'background' | 'look' | 'import' | null;

export const GAP = 6;

// The app is one phone-width column whatever it is shown on. Layout only —
// anything pressable comes from ui/.
// Phone-first, but a tablet is not a tall phone: on a wide screen the column
// was 430px of app in the middle of 834, and the drawing -- which is what the
// whole app is -- came out at a third of the glass. The cap lifts once there
// is room for it, and everything in the column simply gets wider with it.
export const SCREEN = 'relative mx-auto flex h-full max-w-[430px] flex-col overflow-hidden bg-bg md:max-w-[680px]';

// The editor, and only the editor, spreads out on a desktop: the paper takes
// the room and the tools stand beside it. The pickers stay a column -- a list
// of sizes 1400px wide is harder to read, not easier.
export const CANVAS_SCREEN = `${SCREEN} screen-in lg:max-w-[1440px] lg:flex-row`;

// Kept in step with the `lg` variant in styles.css.
export const WIDE = '(min-width: 1024px), (orientation: landscape) and (max-height: 540px) and (min-width: 640px)';

// A mouse and a window are a different shape from a thumb and a phone, and the
// difference is structural rather than a matter of spacing: the tray turns
// from a scroller into a list, and the settings stop covering the paper. So it
// is read once here rather than expressed as a dozen `lg:` classes.
export function useWide(): boolean {
  const [wide, setWide] = useState(
    () => typeof matchMedia === 'function' && matchMedia(WIDE).matches,
  );
  useLayoutEffect(() => {
    const mq = matchMedia(WIDE);
    const read = () => setWide(mq.matches);
    read();
    mq.addEventListener('change', read);
    return () => mq.removeEventListener('change', read);
  }, []);
  return wide;
}

export const SCREEN_PAD = `${SCREEN} gap-[18px] px-[22px] py-7`;

// The two pickers on a desktop. Wider than the phone column, because the cards
// are a comparison and a comparison reads across: the four common sizes fit on
// one row and the whole list is in view without scrolling. Not as wide as the
// editor -- past four across the cards get narrower than the phone's, which is
// how a list of nine turns back into a wall.
export const PICK_SCREEN = `${SCREEN_PAD} screen-in lg:max-w-[1000px]`;
