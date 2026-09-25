import type { ReactNode } from 'react';
import { Button } from './Button';

// Everything that covers the screen lives here, so the dimming, the rounding
// and the stacking order are decided once.

// Settings slide up from the bottom, the way a phone expects. Taller than the
// screen is normal for the export sheet, so it scrolls.
//
// `inline` is the same sheet with nothing covered: on a wide screen it sits in
// the column beside the paper, where a panel is nearer the mouse than the
// bottom of a 900px window and the paper stays visible while it is open. The
// contents are the same either way -- only the frame around them changes.
export function Sheet({ title, onClose, inline = false, children }: {
  title: string;
  onClose: () => void;
  inline?: boolean;
  children: ReactNode;
}) {
  if (inline) {
    return (
      <section className="sheet panel flex min-h-0 grow flex-col gap-3.5 overflow-y-auto border-t border-line bg-white px-[18px] pb-4 pt-2.5">
        <div className="flex shrink-0 items-center gap-2">
          <h2 className="m-0 text-sm font-bold">{title}</h2>
          <Button variant="icon" className="ml-auto" onClick={onClose} aria-label="閉じる">×</Button>
        </div>
        {children}
      </section>
    );
  }

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

// A choice that has to be made now, and nothing else until it is. Wider than
// the question below because what is being chosen are pictures, and centred
// rather than under the thing pressed: a panel below the press sat off the
// bottom of the window on a desktop, and "press ＋ and nothing happens" is
// how that reads.
//
// Its own scrim class, because the sheet's is what a tap outside the sheet
// closes, and these can be open at the same time.
export function Modal({ title, onClose, children }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <>
      <div className="modal-scrim absolute inset-0 z-40 bg-[rgba(35,37,45,0.34)]" onClick={onClose} />
      <div className="modal absolute left-1/2 top-1/2 z-[41] flex max-h-[82%] w-[min(360px,calc(100%-32px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-2.5 overflow-y-auto rounded-2xl bg-white px-4 pb-4 pt-3.5 shadow-[0_12px_32px_rgba(0,0,0,0.2)]">
        <div className="flex shrink-0 items-center gap-2">
          <h2 className="m-0 text-sm font-bold">{title}</h2>
          <Button variant="icon" className="ml-auto" onClick={onClose} aria-label="閉じる">×</Button>
        </div>
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
  return <div className="scrim absolute inset-0 z-30 bg-[rgba(35,37,45,0.28)]" onClick={onClick} />;
}
