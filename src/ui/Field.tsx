import type { ReactNode } from 'react';

// A labelled row inside a sheet. Every setting looks the same because they all
// come through here.
export function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="field-label text-[11px] text-muted">{label}</span>
      {children}
    </div>
  );
}

// Two or three choices, one of them on. The whole app's settings are this
// shape, which is why nothing here needs a dropdown.
export function Segmented<T extends string | number>({ options, value, onPick }: {
  options: { v: T; label: string }[];
  value: T;
  onPick: (v: T) => void;
}) {
  return (
    <div className="flex gap-2">
      {options.map(o => (
        <button
          key={String(o.v)}
          onClick={() => onPick(o.v)}
          className={`flex-1 rounded-[9px] border px-1 py-[11px] text-xs font-semibold ${
            o.v === value
              ? 'border-ink bg-ink text-white'
              : 'border-line-strong bg-white text-label'
          }`}
        >
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
      <strong className={`${tight ? 'min-w-[2.2rem]' : 'min-w-[84px]'} text-center text-[13px]`}>{value}</strong>
      <button className={box} disabled={!canUp} onClick={() => onStep(1)} aria-label="増やす">＋</button>
    </div>
  );
}
