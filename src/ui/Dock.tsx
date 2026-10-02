import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { PRESS } from './Button';

// The sheet under the paper on a phone: a handle that pulls it down to its
// tabs and back, and the tabs themselves. Kept here for the same reason as
// Button -- two tab rows cannot disagree if only one place draws them.

export function DockGrip({ shut, ...rest }: { shut: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className="dockgrip grid h-5 w-full place-items-center"
      aria-label={shut ? '下の段を広げる' : '下の段を縮める'}
      aria-expanded={!shut}
      {...rest}
    >
      <i className="block h-[5px] w-10 rounded-full bg-line-strong" />
    </button>
  );
}

export function DockTab({ on, children, ...rest }: { on: boolean; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      role="tab"
      aria-selected={on}
      className={`docktab shrink-0 whitespace-nowrap border-b-2 px-2.5 pb-2 pt-1 text-[14px] ${PRESS} ${
        on ? 'border-hi font-semibold text-ink' : 'border-transparent text-muted'}`}
      {...rest}
    >{children}</button>
  );
}

// One kind of part to show on the shelf, or all of them. Picked, it is filled
// with ink like a chosen segment, so the row reads as a choice and not as tags.
export function FilterChip({ on, children, ...rest }: { on: boolean; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      aria-pressed={on}
      className={`filterchip shrink-0 whitespace-nowrap rounded-full border px-3 py-[5px] text-[13px] ${PRESS} ${
        on ? 'border-ink bg-ink font-semibold text-white' : 'border-line-strong bg-white text-label'}`}
      {...rest}
    >{children}</button>
  );
}
