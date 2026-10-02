import { useLayoutEffect, useRef, useState } from 'react';
import type { Page } from '../lib/draw';
import { PageSvg } from '../lib/render/svg';
import { GAP } from '../app/screen';

// The design filling the glass. Fitting it is not enough on a phone, where the
// drawing is as wide as the screen already and taking the tray away buys
// nothing: the point of looking at it big is to look closer than the paper
// really is, so a tap goes past fit and the view scrolls. Nothing here is
// editable, which is what lets it scroll under a finger at all -- the editor's
// pages take the touch themselves.
export const ZOOM_STEP = 2.5;

export function ZoomView({ pages, flow, onClose }: {
  pages: Page[]; flow: 'row' | 'column'; onClose: () => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 320, h: 480 });
  const [big, setBig] = useState(false);
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const gapPx = (pages.length - 1) * GAP;
  const acrossMm = flow === 'row'
    ? pages.reduce((t, p) => t + p.widthMm, 0)
    : Math.max(...pages.map(p => p.widthMm));
  const downMm = flow === 'column'
    ? pages.reduce((t, p) => t + p.heightMm, 0)
    : Math.max(...pages.map(p => p.heightMm));
  const fit = Math.max(0.1, Math.min(
    (box.w - 24 - (flow === 'row' ? gapPx : 0)) / acrossMm,
    (box.h - 24 - (flow === 'column' ? gapPx : 0)) / downMm,
  ));
  const scale = big ? fit * ZOOM_STEP : fit;

  return (
    <div className="lightbox fixed inset-0 z-50 flex flex-col bg-[rgba(28,26,22,0.9)]">
      <button
        className="absolute right-3.5 top-3 z-10 size-[34px] rounded-full bg-white/20 p-0 text-[18px] leading-[34px] text-white"
        onClick={onClose}
        aria-label="閉じる"
      >×</button>
      <div className="flex min-h-0 grow overflow-auto p-3" ref={boxRef} onClick={onClose}>
        <div
          className="m-auto flex items-center justify-center"
          style={{ flexDirection: flow, gap: GAP }}
          onClick={e => { e.stopPropagation(); setBig(z => !z); }}
        >
          {pages.map((page, i) => (
            <div
              key={i}
              className="shrink-0 overflow-hidden rounded-sm bg-white shadow-[0_10px_30px_rgba(0,0,0,0.4)]"
            >
              <PageSvg page={page} scale={scale} showGuides />
            </div>
          ))}
        </div>
      </div>
      <p className="zoom-hint m-0 pb-[18px] text-center text-[13px] text-white/55">
        {big ? '紙をタップで全体・外をタップで閉じる' : '紙をタップでさらに拡大・外をタップで閉じる'}
      </p>
    </div>
  );
}
