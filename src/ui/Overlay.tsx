import type { ReactNode } from 'react';

// Everything that covers the screen lives here, so the dimming, the rounding
// and the stacking order are decided once.

// Settings slide up from the bottom, the way a phone expects. Taller than the
// screen is normal for the export sheet, so it scrolls.
export function Sheet({ title, onClose, children }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <>
      <Scrim onClick={onClose} />
      <div className="sheet absolute inset-x-0 bottom-0 z-[31] flex max-h-[88%] flex-col gap-3.5 overflow-y-auto rounded-t-[18px] bg-white px-[18px] pb-[22px] pt-2.5 shadow-[0_-8px_24px_rgba(0,0,0,0.14)]">
        <span className="mx-auto h-1 w-9 rounded-sm bg-line-strong" />
        <h2 className="text-sm font-bold">{title}</h2>
        {children}
      </div>
    </>
  );
}

// A plain question before anything is taken away.
export function Dialog({ message, confirmLabel, onConfirm, onCancel }: {
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      <Scrim onClick={onCancel} />
      <div className="confirm absolute left-1/2 top-1/2 z-[31] flex w-[264px] -translate-x-1/2 -translate-y-1/2 flex-col gap-[18px] rounded-2xl bg-white px-[18px] pb-4 pt-[22px] shadow-[0_12px_32px_rgba(0,0,0,0.2)]">
        <p className="m-0 text-center text-sm leading-normal">{message}</p>
        <div className="flex gap-2.5">
          <button
            className="flex-1 rounded-[9px] border border-line-strong bg-bg p-3 text-[13px] font-semibold text-muted"
            onClick={onCancel}
          >やめる</button>
          <button
            className="flex-1 rounded-[10px] border border-line-strong bg-white p-3 text-[13px] font-semibold text-danger"
            onClick={onConfirm}
          >{confirmLabel}</button>
        </div>
      </div>
    </>
  );
}

// Says what just happened, or why it did not.
export function Toast({ children }: { children: ReactNode }) {
  return (
    <div className="toast absolute bottom-24 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-[20px] bg-ink px-4 py-2 text-xs text-white shadow-[0_6px_16px_rgba(0,0,0,0.18)]">
      {children}
    </div>
  );
}

function Scrim({ onClick }: { onClick: () => void }) {
  return <div className="scrim absolute inset-0 z-30 bg-[rgba(58,54,46,0.28)]" onClick={onClick} />;
}
