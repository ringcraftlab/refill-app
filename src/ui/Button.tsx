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
  | 'icon';

const VARIANT: Record<ButtonVariant, string> = {
  cta: 'rounded-xl bg-accent p-3.5 text-sm font-bold text-white',
  action: 'flex-1 rounded-[10px] border border-line-strong bg-white py-3 text-xs font-semibold text-label',
  // Wider and borderless, so the export button reads as the end of the row.
  actionWide: 'flex-[1.3] rounded-[10px] bg-white py-3 text-xs font-semibold text-label',
  quiet: 'rounded-[9px] border border-line-strong bg-bg px-3 py-[11px] text-xs text-muted',
  danger: 'rounded-[10px] border border-line-strong bg-white p-3 text-[13px] font-semibold text-danger',
  icon: 'px-1 text-lg leading-none',
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function Button({ variant = 'action', className = '', ...rest }: Props) {
  return <button className={`${VARIANT[variant]} ${className}`} {...rest} />;
}
