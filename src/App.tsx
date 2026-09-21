import { Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Layout, PartKind, RefillSize, SizeSpec } from './types';
import { MAX_PARTS, SCHEMA_VERSION } from './types';
import { holeCentres, SIZES } from './lib/sizes';
import { buildGeometry, MAX_RATIO, MIN_RATIO, placeParts as planPlacement, regionAt } from './lib/layout';
import type { Divider } from './lib/layout';
import { nextMonthCell } from './lib/parts';
import { addMonths } from './lib/dates';
import { buildPages, buildPrintSheets, DEFAULT_PRINT, hasDatedPart, perPaperCount } from './lib/render/pages';
import type { BackFill, PrintOptions } from './lib/render/pages';
import { PageSvg, SheetSvg } from './lib/render/svg';
import { downloadPdf, sheetsToPdf } from './lib/render/pdf';
import { deleteLayout, listLayouts, newId, saveLayout } from './lib/storage';
import { Button } from './ui/Button';
import { Field, Segmented, Stepper } from './ui/Field';
import { Dialog, Sheet, Toast } from './ui/Overlay';

type Stage = 'size' | 'sides' | 'canvas';
type SheetTarget = { slot: number } | 'spanning' | 'load' | 'print' | null;

const GAP = 6;

// The app is one phone-width column whatever it is shown on. Layout only —
// anything pressable comes from ui/.
const SCREEN = 'relative mx-auto flex h-full max-w-[430px] flex-col overflow-hidden bg-bg';
const SCREEN_PAD = `${SCREEN} gap-[18px] px-[22px] py-7`;
const SHEET_MINI = 'h-[52px] w-[34px] shrink-0 rounded-sm border border-line-strong bg-white';

const TRAY: { kind: PartKind; label: string; glyph: string }[] = [
  { kind: 'monthly', label: 'マンスリー', glyph: '31' },
  { kind: 'daylist', label: '日付リスト', glyph: '日' },
  { kind: 'weekvert', label: 'バーチカル', glyph: '時' },
  { kind: 'weekhoriz', label: 'ウィークリー', glyph: '週' },
  { kind: 'gantt', label: 'ガント', glyph: '▤' },
  { kind: 'habit', label: 'ハビット', glyph: '✓' },
  { kind: 'todo', label: 'TODO', glyph: '☐' },
  { kind: 'goal', label: '目標', glyph: '◎' },
  { kind: 'budget', label: '家計', glyph: '¥' },
  { kind: 'grid', label: '方眼', glyph: '#' },
  { kind: 'lines', label: '罫線', glyph: '≡' },
  { kind: 'memo', label: 'メモ', glyph: '✎' },
];

const TAUGHT_KEY = 'ringcraft.dividerTaught';
// How far the clear button sits in from the block's right edge. It has to
// overlap a little to read as attached, without sitting on top of a date.
const CLEAR_INSET = 17;

const PART_LABEL: Record<PartKind, string> = {
  monthly: 'マンスリー', daylist: '日付リスト',
  weekvert: '週間バーチカル', weekhoriz: '週間ホリゾンタル', gantt: 'ガントチャート',
  habit: 'ハビットトラッカー', todo: 'TODOリスト',
  goal: '今月の目標', budget: '家計', grid: '方眼', lines: '罫線', memo: 'メモ',
};

function createLayout(): Layout {
  const now = new Date();
  return {
    version: SCHEMA_VERSION,
    id: newId(),
    name: '新しいリフィル',
    size: 'M6',
    spread: true,
    spanning: null,
    surface: { placed: [], ratios: {}, split: 'h' },
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    monthCount: 12,
    weekStart: 1,
    orientation: 'portrait',
    showNextMonth: true,
    habitCount: 4,
    updatedAt: now.toISOString(),
  };
}

export function App() {
  const [stage, setStage] = useState<Stage>('size');
  const [layout, setLayout] = useState<Layout>(createLayout);

  if (stage === 'size') {
    return (
      <SizeScreen
        selected={layout.size}
        onPick={(size) => { setLayout(l => ({ ...l, size })); setStage('sides'); }}
      />
    );
  }
  if (stage === 'sides') {
    return (
      <SidesScreen
        spread={layout.spread}
        onPick={(spread) => setLayout(l => ({ ...l, spread }))}
        onBack={() => setStage('size')}
        onConfirm={() => setStage('canvas')}
      />
    );
  }
  return <CanvasScreen layout={layout} setLayout={setLayout} onBack={() => setStage('sides')} />;
}

// Smallest first, drawn to one scale so the list itself shows how the sizes
// compare.
const SIZE_ORDER: RefillSize[] = ['M5', 'M6', 'NARROW', 'BIBLE', 'A5SLIM', 'A5'];
// A colour per size, so a glance tells them apart even before the millimetres
// are read. Muted enough to still look like paper on the warm background.
const SIZE_TINT: Record<RefillSize, { fill: string; line: string }> = {
  M5: { fill: '#F6DCD3', line: '#C39284' },
  M6: { fill: '#F8E8CC', line: '#C6A26B' },
  NARROW: { fill: '#DFE8D8', line: '#94AC86' },
  BIBLE: { fill: '#D9E3EE', line: '#8699AF' },
  A5SLIM: { fill: '#EDDDE6', line: '#B38DA6' },
  A5: { fill: '#E6DDEE', line: '#9D8DB4' },
};
const SIZE_NOTE: Record<RefillSize, string> = {
  A5SLIM: '細長',
  A5: '書き込み',
  BIBLE: '王道',
  NARROW: '細身',
  M6: '携帯性',
  M5: 'メモ帳',
};
// The short name people actually say. The full Japanese name goes underneath.
const SIZE_CODE: Record<RefillSize, string> = {
  M5: 'M5', M6: 'M6', NARROW: 'ナロー', BIBLE: 'バイブル', A5SLIM: 'A5スリム', A5: 'A5',
};
// Millimetres to pixels for the picker. Every sheet is drawn to this one
// scale, so a tile's height is the paper's height: the grid itself is the
// size comparison. Two columns give the sheet the full tile width, so it can
// be drawn larger than it could beside the name.
const PICKER_SCALE = 0.8;

function SizeIcon({ size, tint }: { size: SizeSpec; tint: { fill: string; line: string } }) {
  return (
    <svg
      width={size.widthMm * PICKER_SCALE}
      height={size.heightMm * PICKER_SCALE}
      viewBox={`0 0 ${size.widthMm} ${size.heightMm}`}
      className="block"
      aria-hidden="true"
    >
      <rect
        x={0.4} y={0.4} width={size.widthMm - 0.8} height={size.heightMm - 0.8}
        rx={1.5} fill={tint.fill} stroke={tint.line} strokeWidth={0.8}
      />
      {holeCentres(size.holes).map((cy, i) => (
        <circle
          key={i}
          cx={size.ringMarginMm / 2} cy={cy} r={size.holes.diameterMm / 2}
          fill="#fff" stroke={tint.line} strokeWidth={0.7}
        />
      ))}
    </svg>
  );
}

function SizeScreen({ selected, onPick }: { selected: RefillSize; onPick: (s: RefillSize) => void }) {
  return (
    <div className={SCREEN_PAD}>
      <div className="text-[13px] font-bold tracking-[0.04em] text-muted">RingCraftLab</div>
      <h1 className="text-[19px] font-bold">手帳のサイズを選ぶ</h1>
      {/* `justify-center` on a scrolling column puts the first tile above the
          scroll origin when it overflows, where nothing can reach it. Centring
          with `m-auto` on the inner block falls back to the top instead. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="m-auto grid w-full grid-cols-2 gap-2 py-1">
          {SIZE_ORDER.map((id, i) => {
            const s = SIZES[id];
            // An odd count leaves the last one alone on its row. It keeps a
            // column's width and sits in the middle, so the row of sheets
            // still reads as one run of sizes.
            const alone = i === SIZE_ORDER.length - 1 && SIZE_ORDER.length % 2 === 1;
            return (
              <button
                key={id}
                onClick={() => onPick(id)}
                className={`sizerow flex flex-col items-center gap-3 rounded-[20px] border-2 bg-white p-3 ${
                  alone ? 'col-span-2 w-[calc(50%-4px)] justify-self-center' : ''
                } ${selected === id ? 'border-ink' : 'border-line'}`}
              >
                {/* Bottom aligned and all to one scale, so a glance down the
                    grid compares the sizes. */}
                <span className="flex w-full flex-1 items-end justify-center">
                  <SizeIcon size={s} tint={SIZE_TINT[id]} />
                </span>
                <strong className="text-[24px] font-light leading-none tracking-tight">{SIZE_CODE[id]}</strong>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SidesScreen({ spread, onPick, onBack, onConfirm }: {
  spread: boolean; onPick: (v: boolean) => void; onBack: () => void; onConfirm: () => void;
}) {
  const card = (on: boolean) =>
    `card flex items-center gap-3.5 rounded-[14px] border-[1.5px] bg-white p-3.5 text-left ${
      on ? 'border-ink' : 'border-line'
    }`;
  return (
    <div className={SCREEN_PAD}>
      <button className="self-start p-0 text-xs text-muted" onClick={onBack}>← サイズを選び直す</button>
      <h1 className="text-[19px] font-bold">ページ構成を選ぶ</h1>
      <div className="flex flex-col gap-2.5">
        <button className={card(spread)} onClick={() => onPick(true)}>
          <span className="flex shrink-0 gap-[3px]"><i className={SHEET_MINI} /><i className={SHEET_MINI} /></span>
          <span className="flex flex-col gap-0.5">
            <strong className="text-sm">見開き（2ページ）</strong>
            <small className="text-[11px] text-faint">左右セットで1ヶ月分</small>
          </span>
        </button>
        <button className={card(!spread)} onClick={() => onPick(false)}>
          <span className={SHEET_MINI} />
          <span className="flex flex-col gap-0.5">
            <strong className="text-sm">片面（1ページ）</strong>
            <small className="text-[11px] text-faint">1ページで完結</small>
          </span>
        </button>
      </div>
      <Button variant="cta" className="mt-auto" onClick={onConfirm}>この構成で作る</Button>
    </div>
  );
}

interface DragState {
  kinds: PartKind[];
  fromSlot: number | null;
  moved: boolean;
  startX: number;
  startY: number;
}

function CanvasScreen({ layout, setLayout, onBack }: {
  layout: Layout; setLayout: (fn: (l: Layout) => Layout) => void; onBack: () => void;
}) {
  const size = SIZES[layout.size];
  const geo = useMemo(() => buildGeometry(layout, size), [layout, size]);
  const pages = useMemo(() => buildPages(layout, size), [layout, size]);

  const [traySelected, setTraySelected] = useState<PartKind[]>([]);
  const [sheet, setSheet] = useState<SheetTarget>(null);
  const [toast, setToast] = useState('');
  const [ghost, setGhost] = useState<{ x: number; y: number; kinds: PartKind[] } | null>(null);
  // Taking a part out reflows every other part on the sheet, so nothing is
  // removed without a plain question first.
  const [confirm, setConfirm] = useState<{ what: string; run: () => void } | null>(null);
  const askRemove = (what: string, run: () => void) => { setSheet(null); setConfirm({ what, run }); };
  // Dragging a border is the app's one irreplaceable gesture, so the handles
  // keep asking for it until it has been used once.
  const [taught, setTaught] = useState(() => {
    try { return localStorage.getItem(TAUGHT_KEY) === '1'; } catch { return false; }
  });

  const dragRef = useRef<DragState | null>(null);
  const dividerRef = useRef<{ d: Divider; startX: number; startY: number; extentPx: number } | null>(null);
  const setRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<number>();

  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 320, h: 360 });
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const first = geo.pages[0];
  const n = geo.pages.length;
  const gapPx = (n - 1) * GAP;
  const scale = Math.max(0.1, Math.min(
    (box.w - (geo.flow === 'row' ? gapPx : 0)) / (geo.flow === 'row' ? first.widthMm * n : first.widthMm),
    (box.h - (geo.flow === 'column' ? gapPx : 0)) / (geo.flow === 'row' ? first.heightMm : first.heightMm * n),
  ));
  const pw = first.widthMm * scale;
  const ph = first.heightMm * scale;
  const pageOrigin = (i: number) => geo.flow === 'row'
    ? { x: i * (pw + GAP), y: 0 }
    : { x: 0, y: i * (ph + GAP) };

  const say = (text: string) => {
    setToast(text);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 1800);
  };

  // Client point → surface millimetres, or null when the point is off the
  // pages or on a page the calendar has filled.
  const toSurface = (cx: number, cy: number): { sx: number; sy: number } | null => {
    const el = setRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const lx = cx - r.left, ly = cy - r.top;
    for (let i = 0; i < geo.pages.length; i++) {
      const o = pageOrigin(i);
      if (lx < o.x || lx > o.x + pw || ly < o.y || ly > o.y + ph) continue;
      const s = geo.surface.slices.find(sl => sl.key === geo.pages[i].key);
      if (!s) return null;
      return {
        sx: (lx - o.x) / scale - s.ox + s.fromMm,
        sy: (ly - o.y) / scale - s.oy,
      };
    }
    return null;
  };

  const overPages = (cx: number, cy: number): boolean => {
    const el = setRef.current;
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
  };

  const placeParts = (kinds: PartKind[], at: { sx: number; sy: number } | null) => {
    setLayout(prev => {
      const planned = planPlacement(prev, size, kinds, at);
      if (!planned) {
        const what = kinds.length === 1 ? PART_LABEL[kinds[0]] : 'パーツ';
        say(`${what}を置く広さがありません。つまみで空けてください`);
        return prev;
      }
      if (planned.overflow > 0) say(`一度に置けるのは${MAX_PARTS}つまでです`);
      return planned.layout;
    });
  };

  const swapParts = (a: number, b: number) => {
    if (a === b) return;
    setLayout(prev => {
      const placed = [...prev.surface.placed];
      [placed[a], placed[b]] = [placed[b], placed[a]];
      return { ...prev, surface: { ...prev.surface, placed } };
    });
  };

  const removePart = (slot: number) => {
    setLayout(prev => {
      const placed = prev.surface.placed.filter((_, i) => i !== slot);
      return {
        ...prev,
        // With nothing left beside it the calendar takes the page back, rather
        // than holding on to space it was only sharing.
        spanning: prev.spanning && placed.length === 0
          ? { ...prev.spanning, ratio: 1 }
          : prev.spanning,
        surface: { ...prev.surface, placed, ratios: {} },
      };
    });
    setSheet(null);
  };

  const startDrag = (e: React.PointerEvent, kinds: PartKind[], fromSlot: number | null) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { kinds, fromSlot, moved: false, startX: e.clientX, startY: e.clientY };
  };
  const moveDrag = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (!d.moved && Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) < 8) return;
    d.moved = true;
    setGhost({ x: e.clientX, y: e.clientY, kinds: d.kinds });
  };
  const endTrayDrag = (e: React.PointerEvent, kind: PartKind) => {
    const d = dragRef.current;
    dragRef.current = null;
    setGhost(null);
    if (!d) return;
    if (!d.moved) {
      setTraySelected(prev => prev.includes(kind) ? prev.filter(k => k !== kind) : [...prev, kind]);
      return;
    }
    if (!overPages(e.clientX, e.clientY)) return;
    // Dropping several at once is an automatic arrangement, so the landing
    // point only steers a single part.
    placeParts(d.kinds, d.kinds.length === 1 ? toSurface(e.clientX, e.clientY) : null);
    setTraySelected([]);
  };
  const endPartDrag = (e: React.PointerEvent, slot: number) => {
    const d = dragRef.current;
    dragRef.current = null;
    setGhost(null);
    if (!d) return;
    if (!d.moved) { setSheet({ slot }); return; }
    const at = toSurface(e.clientX, e.clientY);
    if (!at) return;
    const target = regionAt(geo.surface.regions, at.sx, at.sy);
    if (target !== null) swapParts(slot, target);
  };

  const startDivider = (e: React.PointerEvent, d: Divider) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (!taught) {
      setTaught(true);
      try { localStorage.setItem(TAUGHT_KEY, '1'); } catch { /* private mode */ }
    }
    dividerRef.current = { d, startX: e.clientX, startY: e.clientY, extentPx: d.extentMm * scale };
  };
  const moveDivider = (e: React.PointerEvent) => {
    const drag = dividerRef.current;
    if (!drag) return;
    const { d, extentPx } = drag;
    const delta = d.axis === 'h' ? e.clientY - drag.startY : e.clientX - drag.startX;
    const next = Math.min(MAX_RATIO, Math.max(MIN_RATIO, d.ratio + delta / extentPx));
    setLayout(prev => d.key === 'span'
      ? { ...prev, spanning: prev.spanning ? { ...prev.spanning, ratio: next } : null }
      : { ...prev, surface: { ...prev.surface, ratios: { ...prev.surface.ratios, [d.key]: next } } });
  };
  const endDivider = () => { dividerRef.current = null; };

  const onExport = async (opts: PrintOptions) => {
    const sheets = buildPrintSheets(layout, size, opts);
    downloadPdf(await sheetsToPdf(sheets, layout.name), `${layout.name || 'refill'}.pdf`);
    setSheet(null);
    say(opts.impose ? `A4 ${sheets.length}枚を書き出しました` : `原寸 ${sheets.length}枚を書き出しました`);
  };

  // Hit areas and borders are drawn over the sheets rather than inside them, so
  // a border sitting on the gutter stays grabbable from both sides.
  const partBoxes: { key: string; slot: number; left: number; top: number; width: number; height: number }[] = [];
  const dividerBoxes: { key: string; d: Divider; left: number; top: number; width: number; height: number }[] = [];

  geo.surface.slices.forEach(s => {
    const i = geo.pages.findIndex(p => p.key === s.key);
    const o = pageOrigin(i);
    const toX = (sx: number) => o.x + (sx - s.fromMm + s.ox) * scale;
    const toY = (sy: number) => o.y + (sy + s.oy) * scale;

    geo.surface.regions.forEach((r, slot) => {
      const lo = Math.max(r.x, s.fromMm), hi = Math.min(r.x + r.w, s.toMm);
      if (hi <= lo) return;
      partBoxes.push({
        key: `${slot}-${s.key}`, slot,
        left: toX(lo), top: toY(r.y), width: (hi - lo) * scale, height: r.h * scale,
      });
    });

    geo.surface.dividers.forEach(d => {
      if (d.axis === 'h') {
        const lo = Math.max(d.x, s.fromMm), hi = Math.min(d.x + d.length, s.toMm);
        if (hi <= lo) return;
        dividerBoxes.push({ key: `${d.id}-${s.key}`, d, left: toX(lo), top: toY(d.y) - 11, width: (hi - lo) * scale, height: 22 });
      } else if (d.x >= s.fromMm && d.x <= s.toMm) {
        dividerBoxes.push({ key: `${d.id}-${s.key}`, d, left: toX(d.x) - 11, top: toY(d.y), width: 22, height: d.length * scale });
      }
    });
  });

  geo.pages.forEach((pg, i) => {
    if (!pg.spanDivider) return;
    const o = pageOrigin(i);
    const d = pg.spanDivider;
    dividerBoxes.push({ key: d.id, d, left: o.x + d.x * scale, top: o.y + d.y * scale - 11, width: d.length * scale, height: 22 });
  });

  const empty = layout.surface.placed.length === 0 && !layout.spanning;

  const dated = hasDatedPart(layout);
  const lastMonth = addMonths(layout.year, layout.month, Math.max(1, layout.monthCount) - 1);
  const monthlySlot = layout.surface.placed.indexOf('monthly');
  const monthlyTarget: SheetTarget = layout.spanning ? 'spanning' : { slot: monthlySlot };

  // One button per removable thing, at the outer top corner of the whole
  // block. A part straddling the gutter is still one part, and its button
  // belongs at the edge of the spread rather than in the middle of it.
  const clears: {
    key: string; label: string; left: number; top: number;
    run: () => void;
  }[] = [];

  // Turning the refill is a property of the paper, so it works on a blank
  // sheet and on one with only a memo. A calendar follows along: an upright
  // spread splits the weekdays, a turned one splits the weeks.
  const turn = () => setLayout(l => {
    const orientation = l.orientation === 'landscape' ? 'portrait' : 'landscape';
    return {
      ...l,
      orientation,
      // The two ways of splitting leave different amounts of room, so the
      // calendar's band resets to what this one would have taken.
      spanning: l.spanning
        ? {
            ...l.spanning,
            ratio: l.surface.placed.length === 0 ? 1 : (orientation === 'landscape' ? 0.48 : 0.72),
          }
        : null,
    };
  });

  const spanCorners = geo.pages.flatMap((pg, i) => {
    if (!pg.spanRect) return [];
    const o = pageOrigin(i);
    return [{ right: o.x + (pg.spanRect.x + pg.spanRect.w) * scale, top: o.y + pg.spanRect.y * scale }];
  });
  if (spanCorners.length) {
    const c = spanCorners.reduce((a, b) => (b.right > a.right ? b : a));
    clears.push({
      key: 'span', label: 'マンスリー', left: c.right - CLEAR_INSET, top: c.top + 3,
      run: () => setLayout(l => ({ ...l, spanning: null })),
    });
  }

  layout.surface.placed.forEach((kind, slot) => {
    const boxes = partBoxes.filter(b => b.slot === slot);
    if (boxes.length === 0) return;
    const b = boxes.reduce((a, x) => (x.left + x.width > a.left + a.width ? x : a));
    clears.push({
      key: `p${slot}`, label: PART_LABEL[kind],
      left: b.left + b.width - CLEAR_INSET, top: b.top + 3,
      run: () => removePart(slot),
    });
  });
  const teachDivider = !taught && dividerBoxes.length > 0;

  // The next-month calendar is part of the monthly rather than a part of its
  // own, so it gets a clear button on the sheet instead of a tray entry.
  const leftSpan = geo.pages.find(p => p.key === 'left')?.spanRect;
  const miniCell = layout.showNextMonth && leftSpan ? nextMonthCell(leftSpan, layout) : null;

  return (
    <div className={SCREEN}>
      <header className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-3 text-xs font-semibold text-label">
        <Button variant="icon" onClick={onBack} aria-label="戻る">←</Button>
        <span>{size.label} {size.widthMm}×{size.heightMm}mm ・ {layout.spread ? '見開き' : '片面'}</span>
      </header>

      {dated && (
        // Which months this makes is a design decision, not a printing one,
        // so it belongs in sight rather than inside the export sheet.
        <button
          className="range mb-0.5 ml-3.5 flex shrink-0 items-center gap-2 self-start rounded-full border border-line-strong bg-white px-3 py-1.5 text-[11px] text-ink"
          onClick={() => setSheet(monthlyTarget)}
        >
          {layout.year}年{layout.month}月 → {lastMonth.year}年{lastMonth.month}月
          <em className="not-italic text-faint">{layout.monthCount}ヶ月分</em>
        </button>
      )}

      <div className="relative flex min-h-0 grow items-center justify-center px-3 py-2" ref={boxRef}>
        <button
          className="rotate absolute right-3 top-1 z-10 flex items-center gap-1 rounded-full border border-line-strong bg-white px-2.5 py-1 text-[11px] text-label"
          onClick={turn}
          aria-label="リフィルを回転"
        >
          <span className="text-[13px] leading-none">↻</span>
          {layout.orientation === 'landscape' ? '縦にする' : '横にする'}
        </button>
        <div
          className="flex items-center justify-center"
          ref={setRef}
          style={{ flexDirection: geo.flow, gap: GAP, position: 'relative' }}
        >
          {geo.pages.map((pg, i) => (
            <div
              key={pg.key}
              className="page relative shrink-0 touch-none overflow-hidden rounded-sm bg-white shadow-[0_10px_30px_rgba(58,54,46,0.16)]"
              style={{ width: pw, height: ph }}
            >
              <PageSvg page={pages[i]} scale={scale} showGuides />
              {pg.spanRect && (
                <button
                  className="hitbox absolute p-0"
                  onClick={() => setSheet('spanning')}
                  style={{
                    left: pg.spanRect.x * scale, top: pg.spanRect.y * scale,
                    width: pg.spanRect.w * scale, height: pg.spanRect.h * scale,
                  }}
                  aria-label="マンスリーの設定"
                />
              )}

            </div>
          ))}

          {empty && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-center text-[11px] leading-[1.7] text-faint">
              スタンプをドラッグして<br />ここに配置
            </div>
          )}

          {partBoxes.map(b => (
            <div
              key={b.key}
              className="hitbox part absolute touch-none p-0 active:bg-[rgba(193,115,74,0.08)]"
              style={{ left: b.left, top: b.top, width: b.width, height: b.height }}
              onPointerDown={e => startDrag(e, [layout.surface.placed[b.slot]], b.slot)}
              onPointerMove={moveDrag}
              onPointerUp={e => endPartDrag(e, b.slot)}
              title={PART_LABEL[layout.surface.placed[b.slot]]}
            />
          ))}

          {clears.map(c => (
            <RoundButton
              key={c.key}
              left={c.left}
              top={c.top}
              label={`${c.label}を外す`}
              onClick={() => askRemove(c.label, c.run)}
            >×</RoundButton>
          ))}

          {miniCell && (
            <RoundButton
              left={pageOrigin(0).x + (miniCell.x + miniCell.w) * scale - CLEAR_INSET}
              top={pageOrigin(0).y + miniCell.y * scale + 2}
              label="翌月のカレンダーを外す"
              onClick={() => askRemove('翌月のカレンダー', () => setLayout(l => ({ ...l, showNextMonth: false })))}
            >×</RoundButton>
          )}

          {dividerBoxes.map(b => (
            <DividerHandle
              key={b.key}
              box={b}
              teach={!taught}
              onDown={e => startDivider(e, b.d)}
              onMove={moveDivider}
              onUp={endDivider}
            />
          ))}
        </div>
      </div>

      <p className={`m-0 shrink-0 px-3.5 py-1 text-[10px] ${
        traySelected.length > 1 || teachDivider ? 'text-accent' : 'text-faint'
      }`}>
        {teachDivider
          ? 'つまみを上下にドラッグすると、パーツの広さを変えられます'
          : traySelected.length > 1
            ? `${traySelected.length}個選択中：まとめてドラッグで自動配置`
            : 'タップで複数選択 → まとめてドラッグで自動配置'}
      </p>

      <div className="flex shrink-0 gap-2.5 overflow-x-auto border-t border-line bg-paper px-3 pb-2.5 pt-2">
        {TRAY.map(t => {
          const idx = traySelected.indexOf(t.kind);
          return (
            <button
              key={t.kind}
              className={`stamp relative flex w-[60px] shrink-0 touch-none flex-col items-center gap-1 rounded-xl border-[1.5px] py-[9px] text-[9px] font-semibold ${
                idx >= 0 ? 'border-accent bg-accent-soft' : 'border-line bg-white'
              }`}
              onPointerDown={e => startDrag(e, idx >= 0 && traySelected.length > 1 ? [...traySelected] : [t.kind], null)}
              onPointerMove={moveDrag}
              onPointerUp={e => endTrayDrag(e, t.kind)}
            >
              {idx >= 0 && (
                <i className="absolute -right-[5px] -top-[5px] size-[17px] rounded-full bg-accent text-[9px] not-italic leading-[17px] text-white">
                  {idx + 1}
                </i>
              )}
              <span className="text-[15px] leading-none">{t.glyph}</span>
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      <div className="flex shrink-0 gap-2 bg-paper px-3 pb-3.5 pt-2">
        <Button onClick={() => setSheet('load')}>読み込み</Button>
        <Button onClick={() => { saveLayout(layout); say('レイアウトを保存しました'); }}>保存</Button>
        <Button variant="actionWide" onClick={() => setSheet('print')}>PDF出力プレビュー</Button>
      </div>

      {ghost && (
        <div
          className="pointer-events-none fixed z-40 -translate-x-1/2 -translate-y-[140%] whitespace-nowrap rounded-[20px] bg-ink px-3 py-[7px] text-[11px] text-white"
          style={{ left: ghost.x, top: ghost.y }}
        >
          {ghost.kinds.map(k => PART_LABEL[k]).join(' + ')}
        </div>
      )}

      {toast && <Toast>{toast}</Toast>}

      {confirm && (
        <Dialog
          message={`${confirm.what}を外していいですか？`}
          confirmLabel="外す"
          onConfirm={() => { confirm.run(); setConfirm(null); }}
          onCancel={() => setConfirm(null)}
        />
      )}

      {sheet && (
        <PartSheet
          target={sheet}
          layout={layout}
          setLayout={setLayout}
          onClose={() => setSheet(null)}
          onRemove={slot => askRemove(PART_LABEL[layout.surface.placed[slot]], () => removePart(slot))}
          onRemoveSpanning={() => askRemove('マンスリー', () => setLayout(l => ({ ...l, spanning: null })))}
          onLoad={l => { setLayout(() => l); setSheet(null); say('読み込みました'); }}
          size={size}
          onExport={onExport}
        />
      )}
    </div>
  );
}

// A small round control sitting over a block on the sheet. Positioned onto a
// drawing rather than laid out, so it is not an ordinary Button.
function RoundButton({ left, top, label, onClick, hook = 'clearmini', children }: {
  left: number; top: number; label: string; onClick: () => void;
  // Names the control for the checking scripts, which count them by kind.
  hook?: 'clearmini' | 'rotatemini';
  children: ReactNode;
}) {
  return (
    <button
      className={`${hook} absolute z-[5] size-4 rounded-full bg-[rgba(58,54,46,0.34)] p-0 text-[10px] leading-4 text-white active:bg-[rgba(58,54,46,0.7)]`}
      style={{ left, top }}
      onClick={onClick}
      aria-label={label}
    >{children}</button>
  );
}

// The border between two parts, and the grab handle that says so. Until
// someone has dragged one, the handle asks to be dragged.
function DividerHandle({ box, teach, onDown, onMove, onUp }: {
  box: { d: Divider; left: number; top: number; width: number; height: number };
  teach: boolean;
  onDown: (e: React.PointerEvent) => void;
  onMove: (e: React.PointerEvent) => void;
  onUp: () => void;
}) {
  const horizontal = box.d.axis === 'h';
  return (
    <div
      className={`divider ${box.d.axis} group absolute z-[4] flex touch-none items-center justify-center ${
        horizontal ? 'cursor-row-resize' : 'cursor-col-resize'
      }`}
      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <i className={`block rounded-sm bg-line-strong group-active:bg-accent ${
        horizontal ? 'h-[3px] w-full' : 'h-full w-[3px]'
      }`} />
      <b className={`absolute flex items-center justify-center gap-0.5 rounded-[7px] border bg-white shadow-[0_1px_3px_rgba(58,54,46,0.18)] group-active:border-accent ${
        horizontal ? 'h-[13px] w-[34px] flex-col' : 'h-[34px] w-[13px]'
      } ${teach ? 'animate-knob border-accent' : 'border-line-strong'}`}>
        {[0, 1].map(i => (
          <span key={i} className={`block rounded-[1px] group-active:bg-accent ${
            horizontal ? 'h-[1.5px] w-[14px]' : 'h-[14px] w-[1.5px]'
          } ${teach ? 'bg-accent' : 'bg-faint'}`} />
        ))}
      </b>
    </div>
  );
}

function PartSheet({ target, layout, setLayout, onClose, onRemove, onRemoveSpanning, onLoad, size, onExport }: {
  target: Exclude<SheetTarget, null>;
  layout: Layout;
  setLayout: (fn: (l: Layout) => Layout) => void;
  onClose: () => void;
  onRemove: (slot: number) => void;
  onRemoveSpanning: () => void;
  onLoad: (l: Layout) => void;
  size: SizeSpec;
  onExport: (opts: PrintOptions) => void;
}) {
  const [print, setPrint] = useState<PrintOptions>(DEFAULT_PRINT);
  const lastMonth = addMonths(layout.year, layout.month, Math.max(1, layout.monthCount) - 1);
  const saved = useMemo(() => target === 'load' ? listLayouts() : [], [target]);
  const kind = typeof target === 'string' ? null : layout.surface.placed[target.slot];

  const title = target === 'load' ? '保存済みレイアウト'
    : target === 'print' ? 'PDF出力プレビュー'
    : target === 'spanning' ? '見開きマンスリー'
    : kind ? PART_LABEL[kind] : 'パーツ';

  return (
    <Sheet title={title} onClose={onClose}>

        {target === 'load' && (
          saved.length === 0
            ? <p className="text-[13px] text-faint">まだ保存されていません</p>
            : <ul className="m-0 flex max-h-60 list-none flex-col gap-1.5 overflow-y-auto p-0">
                {saved.map(l => (
                  <li key={l.id} className="flex gap-2">
                    <button
                      className="flex-1 rounded-[9px] border border-line-strong bg-white px-3 py-[11px] text-left text-[13px]"
                      onClick={() => onLoad(l)}
                    >{l.name}</button>
                    <Button variant="quiet" onClick={() => { deleteLayout(l.id); onClose(); }}>削除</Button>
                  </li>
                ))}
              </ul>
        )}

        {target === 'print' && (
          <>
            <PrintPreview layout={layout} size={size} print={print} />
            <Choice
              label="用紙"
              options={[{ v: 'a4', label: 'A4にまとめる' }, { v: 'exact', label: '原寸のまま' }]}
              value={print.impose ? 'a4' : 'exact'}
              onPick={v => setPrint(p => ({ ...p, impose: v === 'a4' }))}
            />
            {/* The browser's own paragraph margin, kept deliberately: it is the
                breathing room between the paper choice and the print options. */}
            <p className="print-summary my-[13px] text-[13px] text-faint">
              {hasDatedPart(layout) && `${layout.year}年${layout.month}月から${layout.monthCount}ヶ月分・`}
              {print.impose && `A4 1枚に ${perPaperCount(size)} 面`}
            </p>

            <Choice
              label="印刷"
              options={[{ v: 'both', label: '両面' }, { v: 'one', label: '片面' }]}
              value={print.duplex ? 'both' : 'one'}
              onPick={v => setPrint(p => ({ ...p, duplex: v === 'both' }))}
            />
            {print.duplex && (
              <Choice
                label="裏面（使わない面）"
                options={[
                  { v: 'blank', label: '白紙' },
                  { v: 'grid', label: '方眼' },
                  { v: 'lines', label: '罫線' },
                ]}
                value={print.backFill}
                onPick={v => setPrint(p => ({ ...p, backFill: v as BackFill }))}
              />
            )}

            <Choice
              label="穴ガイド"
              options={[{ v: 'on', label: '印刷する' }, { v: 'off', label: '印刷しない' }]}
              value={print.punchGuides ? 'on' : 'off'}
              onPick={v => setPrint(p => ({ ...p, punchGuides: v === 'on' }))}
            />

            <Field label="部数">
              <Stepper
                value={print.copies}
                onStep={n => setPrint(p => ({ ...p, copies: Math.min(24, Math.max(1, p.copies + n)) }))}
              />
            </Field>

            {print.impose && (
              <Choice
                label="切り取り線"
                options={[{ v: 'on', label: '入れる' }, { v: 'off', label: '入れない' }]}
                value={print.cutLines ? 'on' : 'off'}
                onPick={v => setPrint(p => ({ ...p, cutLines: v === 'on' }))}
              />
            )}

            {print.impose && (
              <Field label="倍率補正（刷って穴位置がずれるとき）">
                <Stepper
                  value={`${print.scalePercent.toFixed(1)}%`}
                  onStep={n => setPrint(p => ({
                    ...p,
                    scalePercent: Math.min(105, Math.max(95, +(p.scalePercent + n * 0.5).toFixed(1))),
                  }))}
                />
              </Field>
            )}

            <Button variant="cta" onClick={() => onExport(print)}>書き出す</Button>
          </>
        )}

        {(target === 'spanning' || kind === 'monthly') && (
          <Choice
            label="週の始まり"
            options={[{ v: 1, label: '月曜始まり' }, { v: 0, label: '日曜始まり' }]}
            value={layout.weekStart}
            onPick={v => setLayout(l => ({ ...l, weekStart: v as 0 | 1 }))}
          />
        )}

        {(target === 'spanning' || kind === 'monthly') && (
          <>
            <Field label="開始月">
              <Stepper
                value={`${layout.year}年${layout.month}月`}
                onStep={n => setLayout(l => ({ ...l, ...addMonths(l.year, l.month, n) }))}
              />
            </Field>
            <Field label={`終了月（${layout.monthCount}ヶ月分）`}>
              <Stepper
                value={`${lastMonth.year}年${lastMonth.month}月`}
                onStep={n => setLayout(l => ({ ...l, monthCount: Math.min(36, Math.max(1, l.monthCount + n)) }))}
              />
            </Field>
          </>
        )}

        {target === 'spanning' && layout.orientation === 'portrait' && (
          <Choice
            label="翌月のミニカレンダー"
            options={[{ v: 'on', label: '入れる' }, { v: 'off', label: '入れない' }]}
            value={layout.showNextMonth ? 'on' : 'off'}
            onPick={v => setLayout(l => ({ ...l, showNextMonth: v === 'on' }))}
          />
        )}

        {kind && layout.surface.placed.length >= 2 && (
          <Choice
            label="並べ方"
            options={[{ v: 'v', label: '左右に並べる' }, { v: 'h', label: '上下に並べる' }]}
            value={layout.surface.split}
            onPick={v => setLayout(l => ({ ...l, surface: { ...l.surface, split: v as 'h' | 'v' } }))}
          />
        )}

        {kind === 'habit' && (
          <Field label="習慣の数">
            <Stepper
              value={layout.habitCount}
              onStep={n => setLayout(l => ({ ...l, habitCount: Math.min(8, Math.max(1, l.habitCount + n)) }))}
            />
          </Field>
        )}

        {typeof target !== 'string' && (
          <Button variant="danger" onClick={() => onRemove(target.slot)}>このパーツを外す</Button>
        )}
        {target === 'spanning' && (
          <Button variant="danger" onClick={onRemoveSpanning}>このパーツを外す</Button>
        )}
    </Sheet>
  );
}

// Only the first few, because a year of refills is a lot of paper and the
// pattern is clear by the second sheet.
const PREVIEW_PAGES = 4;

// Imposed, duplexed sheets look like nonsense until you see them laid out and
// numbered. Showing them here means the options can be judged before anyone
// spends ink on them.
function PrintPreview({ layout, size, print }: { layout: Layout; size: SizeSpec; print: PrintOptions }) {
  const sheets = useMemo(() => buildPrintSheets(layout, size, print), [layout, size, print]);
  // A thumbnail is enough to see how the paper is laid out, not enough to read
  // a date, so any of them opens full size.
  const [open, setOpen] = useState<number | null>(null);
  // Four refills fit on one A4, so the whole sheet at phone width is too small
  // to read a date on. Tapping swaps between the whole sheet and a size you
  // can actually check.
  const [zoom, setZoom] = useState(false);
  const shown = sheets.slice(0, PREVIEW_PAGES);
  const label = (i: number) => print.duplex
    ? `${Math.floor(i / 2) + 1}枚目 ${i % 2 === 0 ? '表' : '裏'}`
    : `${i + 1}枚目`;
  const step = (n: number) => {
    setZoom(false);
    setOpen(o => (o === null ? null : Math.min(sheets.length - 1, Math.max(0, o + n))));
  };

  return (
    <Field label={`刷り上がり（全${sheets.length}ページ・タップで拡大）`}>
      <div className="preview flex gap-2.5 overflow-x-auto pb-1 pt-0.5">
        {shown.map((sheet, i) => (
          <figure key={i} className="m-0 flex shrink-0 flex-col items-center gap-1">
            <button className="block p-0" onClick={() => { setZoom(false); setOpen(i); }} aria-label={`${label(i)}を拡大`}>
              <SheetSvg sheet={sheet} boxPx={110} className="block rounded-sm border border-line-strong bg-white" />
            </button>
            <figcaption className="whitespace-nowrap text-[10px] text-muted">{label(i)}</figcaption>
          </figure>
        ))}
        {sheets.length > shown.length && (
          <button
            className="flex min-h-[142px] w-[110px] shrink-0 items-center justify-center rounded-sm border border-dashed border-line-strong text-center text-[10px] leading-[1.6] text-faint"
            onClick={() => { setZoom(false); setOpen(PREVIEW_PAGES); }}
          >
            ほか<br />{sheets.length - shown.length}ページ
          </button>
        )}
      </div>
      {print.duplex && layout.spread && hasDatedPart(layout) && (
        <p className="m-0 text-[10px] leading-[1.7] text-faint">
          見開きは左ページが必ず裏面に来るので、最初の表と最後の裏だけが余ります。
          そのまま両面で刷って、切り取って順に重ねてください。
        </p>
      )}

      {open !== null && sheets[open] && (
        <div
          className="lightbox fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-[rgba(28,26,22,0.9)] px-4 pb-[18px] pt-[54px]"
          onClick={() => setOpen(null)}
        >
          <button
            className="absolute right-3.5 top-3 size-[34px] rounded-full bg-white/20 p-0 text-[17px] leading-[34px] text-white"
            onClick={() => setOpen(null)}
            aria-label="閉じる"
          >×</button>
          <div
            className={`overflow-auto rounded-sm bg-white ${
              zoom ? 'h-[calc(100vh-128px)] w-[calc(100vw-32px)]' : ''
            }`}
            onClick={e => { e.stopPropagation(); setZoom(z => !z); }}
          >
            {/* Both maxima with auto sizing, so the page shrinks to fit whichever
                runs out first and keeps its proportions. */}
            <SheetSvg
              sheet={sheets[open]}
              boxPx={1400}
              className={zoom
                ? 'block w-[calc((100vw-32px)*2.4)] max-w-none'
                : 'block h-auto w-auto max-h-[calc(100vh-128px)] max-w-[calc(100vw-32px)]'}
            />
          </div>
          <div className="lightbox-bar flex items-center gap-3.5 text-xs text-white" onClick={e => e.stopPropagation()}>
            <Button variant="quiet" className="min-w-[52px] disabled:opacity-35" disabled={open === 0} onClick={() => step(-1)} aria-label="前のページ">←</Button>
            <span className="flex flex-col items-center gap-0.5 text-center">
              {label(open)}　{open + 1}/{sheets.length}
              <em className="not-italic text-[10px] text-white/55">{zoom ? 'タップで全体' : 'タップで拡大'}</em>
            </span>
            <Button variant="quiet" className="min-w-[52px] disabled:opacity-35" disabled={open === sheets.length - 1} onClick={() => step(1)} aria-label="次のページ">→</Button>
          </div>
        </div>
      )}
    </Field>
  );
}

// Kept as a name because every setting reads as one, but it is only the
// shared Field and Segmented underneath.
function Choice<T extends string | number>({ label, options, value, onPick }: {
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
