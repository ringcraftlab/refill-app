import type { ReactNode } from 'react';
import { PRESS } from './Button';

// A labelled row inside a sheet. Every setting looks the same because they all
// come through here.
export function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="field-label text-[13px] text-muted">{label}</span>
      {children}
    </div>
  );
}

// Two or three choices, one of them on. The whole app's settings are this
// shape, which is why nothing here needs a dropdown.
export function Segmented<T extends string | number>({ options, value, onPick, tight = false }: {
  options: { v: T; label: string; icon?: ReactNode }[];
  value: T;
  onPick: (v: T) => void;
  // The same control standing in a row of chips beside the paper rather than
  // owning its line in a sheet: pill-shaped and chip-sized, so the row reads
  // as one row. Nothing else about it changes -- it is still the whole set of
  // answers with the current one filled in, which is what lets it be read
  // without being opened.
  tight?: boolean;
}) {
  return (
    <div className={tight ? 'flex gap-1' : 'flex gap-2'}>
      {options.map(o => (
        <button
          key={String(o.v)}
          onClick={() => onPick(o.v)}
          className={`${
            tight
              ? 'flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[13px]'
              : 'flex-1 rounded-[9px] border px-1 py-[11px] text-[13px] font-semibold'
          } ${PRESS} ${
            o.v === value
              ? 'border-ink bg-ink text-white'
              : 'border-line-strong bg-white text-label'
          }`}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Minus, value, plus. Used for months, counts and the print scale.
// `tight` is the same stepper standing next to other buttons in one row
// instead of owning its line: the reading stays, the air around it goes.
export function Stepper({ value, onStep, canDown = true, canUp = true, tight = false }: {
  value: ReactNode;
  onStep: (n: number) => void;
  canDown?: boolean;
  canUp?: boolean;
  tight?: boolean;
}) {
  const box = `${tight ? 'size-[34px]' : 'size-[38px]'} shrink-0 rounded-lg border border-line-strong bg-bg text-base disabled:opacity-40`;
  return (
    <div className={`stepper flex shrink-0 items-center ${tight ? 'gap-1.5' : 'gap-2.5'}`}>
      <button className={box} disabled={!canDown} onClick={() => onStep(-1)} aria-label="減らす">−</button>
      <strong className={`${tight ? 'min-w-[2.2rem]' : 'min-w-[84px]'} text-center text-[14px]`}>{value}</strong>
      <button className={box} disabled={!canUp} onClick={() => onStep(1)} aria-label="増やす">＋</button>
    </div>
  );
}
