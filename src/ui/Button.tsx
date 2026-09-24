import type { ButtonHTMLAttributes } from 'react';

// Every pressable control in the app comes from here. Two buttons cannot
// disagree about their padding if there is only one place that decides it —
// which is the whole reason this file exists.
//
// The exceptions are the things drawn over the sheet (part hit areas, border
// handles, clear buttons): those are positioned targets on a drawing, not
// controls in a layout, and they carry their own geometry.
export type ButtonVariant =
  // The one accent button on a screen: "make this", "export".
  | 'cta'
  // The row along the bottom of the canvas.
  | 'action'
  | 'actionWide'
  // Secondary, inside sheets.
  | 'quiet'
  // Takes something away.
  | 'danger'
  // Icon only, no box.
  | 'icon'
  // A pill that sits beside something rather than under it: going back, or
  // the two controls over the drawing. Small, outlined, never the accent.
  | 'chip'
  // At the edge of the paper: turning the page, and putting one before or
  // after this one. Round and raised, because it sits on the drawing and has
  // to read as a control rather than as a mark on the page.
  | 'edge';

const VARIANT: Record<ButtonVariant, string> = {
  cta: 'rounded-xl bg-accent p-3.5 text-sm font-bold text-white',
  action: 'flex-1 rounded-[10px] border border-line-strong bg-white py-3 text-xs font-semibold text-label',
  // Wider and borderless, so the export button reads as the end of the row.
  actionWide: 'flex-[1.3] rounded-[10px] bg-white py-3 text-xs font-semibold text-label',
  quiet: 'rounded-[9px] border border-line-strong bg-bg px-3 py-[11px] text-xs text-muted',
  danger: 'rounded-[10px] border border-line-strong bg-white p-3 text-[13px] font-semibold text-danger',
  icon: 'px-1 text-lg leading-none',
  chip: 'flex shrink-0 items-center gap-1 rounded-full border border-line-strong bg-white px-2.5 py-1 text-[11px] font-normal text-label',
  edge: 'size-9 rounded-full border border-line-strong bg-white text-[17px] leading-none text-muted shadow-[0_2px_6px_rgba(58,54,46,0.16)] hover:border-accent hover:text-accent disabled:opacity-35',
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function Button({ variant = 'action', className = '', ...rest }: Props) {
  return <button className={`${VARIANT[variant]} ${className}`} {...rest} />;
}
