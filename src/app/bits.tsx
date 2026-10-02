import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Layout, SizeSpec } from '../types';
import { buildGeometry } from '../lib/layout';
import { buildPages, INK_INSET_MM, paperPlan, punchInset } from '../lib/render/pages';
import type { PaperId } from '../lib/render/impose';
import { PageSvg } from '../lib/render/svg';
import { Field, Segmented } from '../ui/Field';

// Whether the refills reach the paper's edge, and what that costs. Packing
// them edge to edge is what buys A5 its second refill and Micro5 its seventh
// and eighth, and the price is that a printer's unprintable border eats into
// whichever side has no clearance. Which side matters: the binding edge
// carries the punch guide, whose rim comes 2.0-3.3mm in, while every other
// edge is clear for 4.2mm. So the note says the number the user has to
// compare against their own printer rather than a verdict this cannot reach.
export function EdgeNote({ size, count, sheet, paper }: {
  size: SizeSpec; count: number; sheet?: { widthMm: number; heightMm: number }; paper: PaperId;
}) {
  const plan = paperPlan(size, count, sheet, paper);
  const tight: string[] = [];
  if (plan.sideMm < 0.75) tight.push('左右');
  if (plan.endMm < 0.75) tight.push('上下');
  if (!tight.length) {
    return (
      <p className="edge-note m-0 mb-[13px] text-[13px] text-muted">
        外周に{Math.floor(Math.min(plan.sideMm, plan.endMm))}mm余ります。端まで刷る必要はありません
      </p>
    );
  }
  // The binding edge runs down the side of every size the app carries, so a
  // size whose left and right reach the paper is the only one whose punch
  // guide is in the firing line.
  const onEdge = tight.includes('左右') ? punchInset(size) : INK_INSET_MM;
  return (
    <p className="edge-note m-0 mb-[13px] text-[13px] text-muted">
      <span className="font-semibold text-label">{tight.join('と')}は紙の端まで使います。</span>
      お使いのプリンタの余白が{onEdge.toFixed(onEdge < 4 ? 2 : 1)}mmより広いと、
      {tight.includes('左右') ? '穴の目印の外側' : '中身のふち'}がそのぶん欠けます
    </p>
  );
}

// One saved refill, small enough to sit in a list and big enough to tell a
// calendar from a memo.
export function Thumb({ layout, size, side = 0, box = { w: 34, h: 46 }, ring = false, lazy = false }: {
  layout: Layout;
  size: SizeSpec;
  // Which page of the design: a spread has two, and in a list of pages they
  // are two different pictures.
  side?: number;
  box?: { w: number; h: number };
  // Marks the page the editor is on. The border rather than a tint, so the
  // drawing underneath stays the colour it will print.
  ring?: boolean;
  // Draw only once the picture is near the window. A book is a list of every
  // page it has, and building them all at once means building every day of
  // every month -- a year of monthlies is 26 sheets and half a second, and
  // most of that is counting six-day cycles nobody is looking at yet.
  lazy?: boolean;
}) {
  const mark = useRef<HTMLSpanElement | null>(null);
  const [near, setNear] = useState(!lazy);
  useLayoutEffect(() => {
    const el = mark.current;
    if (near || !el) return;
    const io = new IntersectionObserver(
      seen => { if (seen.some(e => e.isIntersecting)) setNear(true); },
      // A window ahead, so the picture is there before the scroll stops.
      { rootMargin: '400px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near]);

  // The room it takes is geometry alone -- no dates, no almanac -- so the
  // space can be held without drawing anything into it, and nothing jumps
  // when the drawing arrives.
  const geo = useMemo(() => buildGeometry(layout, size), [layout, size]);
  const shape = geo.pages[Math.min(side, geo.pages.length - 1)];
  const drawn = useMemo(
    () => (near ? buildPages(layout, size) : null),
    [near, layout, size],
  );
  if (!shape) return null;
  const scale = Math.min(box.w / shape.widthMm, box.h / shape.heightMm);
  const page = drawn?.[Math.min(side, drawn.length - 1)];
  return (
    <span
      ref={mark}
      className={`thumb block shrink-0 overflow-hidden rounded-[3px] border bg-white ${
        ring ? 'border-accent shadow-[0_0_0_1px_var(--color-accent)]' : 'border-line-strong'
      }`}
      style={{ width: shape.widthMm * scale, height: shape.heightMm * scale }}
    >
      {page && <PageSvg page={page} scale={scale} />}
    </span>
  );
}

// Kept as a name because every setting reads as one, but it is only the
// shared Field and Segmented underneath.
export function Choice<T extends string | number>({ label, options, value, onPick }: {
  label: string;
  options: { v: T; label: string }[];
  value: T;
  onPick: (v: T) => void;
}) {
  return (
    <Field label={label}>
      <Segmented options={options} value={value} onPick={onPick} />
    </Field>
  );
}
