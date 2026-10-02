import { useEffect, useRef } from 'react';
import type { Layout, SizeSpec } from '../types';
import { hasDatedPart, sheetAt, sheetCount, sheetLabel } from '../lib/render/pages';
import { PRESS } from '../ui/Button';
import { isPlaceholder, pagesOf, sectionLabel } from '../app/book';
import { Thumb } from '../app/bits';

// The book on a phone, one picture per sheet, in the order it is bound: what
// the rail and the page list used to say between them, on the editor itself.
// Between two runs there is a ＋ to put something in; holding a picture asks
// what to do with the run it belongs to (move it, take it out). A run is not
// split by a ＋ in its middle -- there is no such thing as half a run yet.
export function Filmstrip({ sections, at, nth, size, onGo, onAddCover, onAddBack, onInsert, onHold }: {
  sections: Layout[];
  at: number;
  nth: number;
  size: SizeSpec;
  onGo: (at: number, nth: number) => void;
  // Shown only when there is room for one: a book of spreads leaves page 1
  // alone on the right and the back of its last sheet empty.
  onAddCover?: () => void;
  onAddBack?: () => void;
  onInsert: (before: number) => void;
  onHold: (at: number) => void;
}) {
  const all = pagesOf(sections);
  const pagesFor = (i: number, n: number) => {
    const own = all.map((l, k) => ({ l, k })).filter(({ l }) => l.at === i && l.nth === n);
    if (!own.length) return '';
    const a = own[0].k + 1, b = own[own.length - 1].k + 1;
    return a === b ? `p.${a}` : `p.${a}–${b}`;
  };
  // What a sheet is called in a strip 60px wide: its month, its week, or its
  // run's name. The year is in the title; it is not news on every picture.
  const nameOf = (sec: Layout, n: number) => {
    if (sec.cover) return '表紙';
    if (sec.backCover) return '裏表紙';
    if (!hasDatedPart(sec)) return n === 0 ? sectionLabel(sec) : `${n + 1}枚目`;
    const s = sheetLabel(sec, n).replace(/^\d+年/, '');
    const week = s.match(/^(\d+)月(\d+)日の週$/);
    return week ? `${week[1]}/${week[2]}〜` : s;
  };

  const strip = useRef<HTMLDivElement>(null);
  // The picture of where the editor is stays in view as the pages turn.
  useEffect(() => {
    const el = strip.current?.querySelector<HTMLElement>('.filmtile.on');
    el?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [at, nth, sections.length]);

  // A hold is a press that stays put. Moving more than a few pixels is the
  // strip being scrolled, and that is not a question about the run.
  const hold = useRef<{ t: number; x: number; y: number; fired: boolean } | null>(null);
  const press = (i: number) => ({
    onPointerDown: (e: React.PointerEvent) => {
      const h = { t: 0, x: e.clientX, y: e.clientY, fired: false };
      h.t = window.setTimeout(() => { h.fired = true; onHold(i); }, 520);
      hold.current = h;
    },
    onPointerMove: (e: React.PointerEvent) => {
      const h = hold.current;
      if (h && Math.hypot(e.clientX - h.x, e.clientY - h.y) > 8) { clearTimeout(h.t); hold.current = null; }
    },
    onPointerUp: () => { if (hold.current) clearTimeout(hold.current.t); },
    onPointerCancel: () => { if (hold.current) clearTimeout(hold.current.t); hold.current = null; },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });

  const add = (key: string, label: string, onClick: () => void, cls: string, aria: string) => (
    <button
      key={key}
      className={`${cls} flex shrink-0 flex-col items-center justify-center gap-0.5 self-stretch rounded-md border border-dashed border-act px-2 text-[12px] font-semibold text-act ${PRESS}`}
      onClick={onClick}
      aria-label={aria}
    >
      <span className="text-[15px] leading-none">＋</span>{label}
    </button>
  );

  const items: React.ReactNode[] = [];
  if (onAddCover) items.push(add('cover', '表紙', onAddCover, 'addbefore', '表紙を入れる'));
  sections.forEach((sec, i) => {
    // The stub a new book starts with is not a page of it; a cover that is
    // still blank is.
    if (isPlaceholder(sec) && !sec.cover && !sec.backCover && sections.length > 1) return;
    const n = sheetCount(sec);
    for (let k = 0; k < n; k++) {
      const sheet = sheetAt(sec, k);
      const sides = sec.spread && sec.fold <= 1 && !sec.cover && !sec.backCover ? [0, 1] : [0];
      const on = at === i && nth === k;
      items.push(
        <button
          key={`${i}:${k}`}
          className={`filmtile relative flex shrink-0 flex-col items-center gap-1 rounded-md px-1.5 pb-1 pt-1.5 ${PRESS} ${
            on ? 'on bg-white shadow-[0_0_0_1px_var(--color-line-strong),inset_0_-3px_0_var(--color-hi)]' : ''}`}
          aria-current={on ? 'page' : undefined}
          onClick={() => { if (!hold.current?.fired) onGo(i, k); hold.current = null; }}
          {...press(i)}
        >
          <span className="flex gap-[1px]">
            {sides.map(side => (
              <Thumb key={side} layout={sheet} size={size} side={side} box={{ w: 26, h: 38 }} lazy />
            ))}
          </span>
          <span className="max-w-[72px] truncate text-[11px] font-semibold leading-none text-ink" title={pagesFor(i, k)}>{nameOf(sec, k)}</span>
        </button>,
      );
    }
    // Between two runs: the place something can be put in. Not before the
    // back cover's own page -- that is the end, and the end has its own.
    const next = sections[i + 1];
    if (next && !next.backCover) items.push(add(`ins${i}`, '挟む', () => onInsert(i + 1), 'filmins', 'ここに挟む'));
  });
  // The end of the book takes more pages until a back cover closes it.
  const backAt = sections.findIndex(s => s.backCover);
  items.push(add('end', '足す', () => onInsert(backAt >= 0 ? backAt : sections.length), 'filmins', '最後に足す'));
  if (onAddBack) items.push(add('back', '裏表紙', onAddBack, 'fillback', '裏表紙に入れる'));

  return (
    <div ref={strip} className="filmstrip flex shrink-0 items-stretch gap-1 overflow-x-auto px-3 pb-1 pt-0.5" aria-label="綴じた順">
      {items}
    </div>
  );
}
