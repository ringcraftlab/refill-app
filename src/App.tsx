import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Layout, PartKind, RefillSize, SizeSpec, SpanPattern } from './types';
import { MAX_PARTS, SCHEMA_VERSION } from './types';
import { holeCentres, SIZES } from './lib/sizes';
import { buildGeometry, MAX_RATIO, MIN_RATIO, placeParts as planPlacement, regionAt } from './lib/layout';
import type { Divider } from './lib/layout';
import { nextMonthCell } from './lib/parts';
import { addMonths } from './lib/dates';
import { buildPages, buildPrintSheets, DEFAULT_PRINT, hasDatedPart, perPaperCount } from './lib/render/pages';
import type { BackFill, PrintOptions } from './lib/render/pages';
import { PageSvg } from './lib/render/svg';
import { downloadPdf, sheetsToPdf } from './lib/render/pdf';
import { deleteLayout, listLayouts, newId, saveLayout } from './lib/storage';

type Stage = 'size' | 'sides' | 'canvas';
type SheetTarget = { slot: number } | 'spanning' | 'load' | 'print' | null;

const GAP = 6;

const TRAY: { kind: PartKind; label: string; glyph: string }[] = [
  { kind: 'monthly', label: 'マンスリー', glyph: '31' },
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
  monthly: 'マンスリー', habit: 'ハビットトラッカー', todo: 'TODOリスト',
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
    monthlyOrientation: 'portrait',
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
const SIZE_ORDER: RefillSize[] = ['M5', 'M6', 'NARROW', 'BIBLE', 'A5'];
const SIZE_NOTE: Record<RefillSize, string> = {
  A5: '書き込み',
  BIBLE: '王道',
  NARROW: '細身',
  M6: '携帯性',
  M5: 'メモ帳',
};
// Millimetres to pixels for the picker. The whole row has to fit a phone.
// Stacked, so this is bounded by the screen's height rather than by five
// sheets' combined width — which caps a side-by-side row at about 0.75.
const PICKER_SCALE = 0.71;

function SizeIcon({ size }: { size: SizeSpec }) {
  return (
    <svg
      width={size.widthMm * PICKER_SCALE}
      height={size.heightMm * PICKER_SCALE}
      viewBox={`0 0 ${size.widthMm} ${size.heightMm}`}
      aria-hidden="true"
    >
      <rect
        x={0.4} y={0.4} width={size.widthMm - 0.8} height={size.heightMm - 0.8}
        rx={1.5} fill="#fff" stroke="#C9C2B2" strokeWidth={0.8}
      />
      {holeCentres(size.holes).map((cy, i) => (
        <circle
          key={i}
          cx={size.ringMarginMm / 2} cy={cy} r={size.holes.diameterMm / 2}
          fill="none" stroke="#A8A192" strokeWidth={0.7}
        />
      ))}
    </svg>
  );
}

function SizeScreen({ selected, onPick }: { selected: RefillSize; onPick: (s: RefillSize) => void }) {
  // One icon column with every binding edge on the same line, so the sheets
  // read as a stack and only their size differs.
  const widest = Math.max(...SIZE_ORDER.map(id => SIZES[id].widthMm)) * PICKER_SCALE;
  return (
    <div className="screen pad">
      <div className="brand">RingCraftLab</div>
      <h1>手帳のサイズを選ぶ</h1>
      <div className="sizelist">
        {SIZE_ORDER.map(id => {
          const s = SIZES[id];
          return (
            <button key={id} className={`sizerow${selected === id ? ' on' : ''}`} onClick={() => onPick(id)}>
              <span className="art" style={{ width: widest }}><SizeIcon size={s} /></span>
              <span className="meta">
                <strong>{s.label}</strong>
                <small>{s.widthMm}×{s.heightMm}mm ・ {s.holes.count}穴</small>
                <small className="note">{SIZE_NOTE[id]}</small>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SidesScreen({ spread, onPick, onBack, onConfirm }: {
  spread: boolean; onPick: (v: boolean) => void; onBack: () => void; onConfirm: () => void;
}) {
  return (
    <div className="screen pad">
      <button className="link" onClick={onBack}>← サイズを選び直す</button>
      <h1>ページ構成を選ぶ</h1>
      <div className="cards">
        <button className={`card${spread ? ' on' : ''}`} onClick={() => onPick(true)}>
          <span className="mini-spread"><i /><i /></span>
          <span className="card-text"><strong>見開き（2ページ）</strong><small>左右セットで1ヶ月分</small></span>
        </button>
        <button className={`card${!spread ? ' on' : ''}`} onClick={() => onPick(false)}>
          <span className="mini-single" />
          <span className="card-text"><strong>片面（1ページ）</strong><small>1ページで完結</small></span>
        </button>
      </div>
      <button className="primary bottom" onClick={onConfirm}>この構成で作る</button>
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
  const clears: { key: string; label: string; left: number; top: number; run: () => void }[] = [];

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
    <div className="screen">
      <header className="bar">
        <button className="icon" onClick={onBack} aria-label="戻る">←</button>
        <span>{size.label} {size.widthMm}×{size.heightMm}mm ・ {layout.spread ? '見開き' : '片面'}</span>
      </header>

      {dated && (
        // Which months this makes is a design decision, not a printing one,
        // so it belongs in sight rather than inside the export sheet.
        <button className="range" onClick={() => setSheet(monthlyTarget)}>
          {layout.year}年{layout.month}月 → {lastMonth.year}年{lastMonth.month}月
          <em>{layout.monthCount}ヶ月分</em>
        </button>
      )}

      <div className="stage" ref={boxRef}>
        <div
          className="sheetset"
          ref={setRef}
          style={{ flexDirection: geo.flow, gap: GAP, position: 'relative' }}
        >
          {geo.pages.map((pg, i) => (
            <div key={pg.key} className="page" style={{ width: pw, height: ph }}>
              <PageSvg page={pages[i]} scale={scale} showGuides />
              {pg.spanRect && (
                <button
                  className="hitbox"
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

          {empty && <div className="drop-hint">スタンプをドラッグして<br />ここに配置</div>}

          {partBoxes.map(b => (
            <div
              key={b.key}
              className="hitbox part"
              style={{ left: b.left, top: b.top, width: b.width, height: b.height }}
              onPointerDown={e => startDrag(e, [layout.surface.placed[b.slot]], b.slot)}
              onPointerMove={moveDrag}
              onPointerUp={e => endPartDrag(e, b.slot)}
              title={PART_LABEL[layout.surface.placed[b.slot]]}
            />
          ))}

          {clears.map(c => (
            <button
              key={c.key}
              className="clearmini"
              style={{ left: c.left, top: c.top }}
              onClick={() => askRemove(c.label, c.run)}
              aria-label={`${c.label}を外す`}
            >×</button>
          ))}

          {miniCell && (
            <button
              className="clearmini"
              style={{
                left: pageOrigin(0).x + (miniCell.x + miniCell.w) * scale - CLEAR_INSET,
                top: pageOrigin(0).y + miniCell.y * scale + 2,
              }}
              onClick={() => askRemove('翌月のカレンダー', () => setLayout(l => ({ ...l, showNextMonth: false })))}
              aria-label="翌月のカレンダーを外す"
            >×</button>
          )}

          {dividerBoxes.map(b => (
            <div
              key={b.key}
              className={`divider ${b.d.axis}${taught ? '' : ' teach'}`}
              style={{ left: b.left, top: b.top, width: b.width, height: b.height }}
              onPointerDown={e => startDivider(e, b.d)}
              onPointerMove={moveDivider}
              onPointerUp={endDivider}
              onPointerCancel={endDivider}
            >
              <i />
              <b className="knob"><span /><span /></b>
            </div>
          ))}
        </div>
      </div>

      <p className={`hint${traySelected.length > 1 || teachDivider ? ' active' : ''}`}>
        {teachDivider
          ? 'つまみを上下にドラッグすると、パーツの広さを変えられます'
          : traySelected.length > 1
            ? `${traySelected.length}個選択中：まとめてドラッグで自動配置`
            : 'タップで複数選択 → まとめてドラッグで自動配置'}
      </p>

      <div className="tray">
        {TRAY.map(t => {
          const idx = traySelected.indexOf(t.kind);
          return (
            <button
              key={t.kind}
              className={`stamp${idx >= 0 ? ' on' : ''}`}
              onPointerDown={e => startDrag(e, idx >= 0 && traySelected.length > 1 ? [...traySelected] : [t.kind], null)}
              onPointerMove={moveDrag}
              onPointerUp={e => endTrayDrag(e, t.kind)}
            >
              {idx >= 0 && <i className="badge">{idx + 1}</i>}
              <span className="glyph">{t.glyph}</span>
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      <div className="actions">
        <button onClick={() => setSheet('load')}>読み込み</button>
        <button onClick={() => { saveLayout(layout); say('レイアウトを保存しました'); }}>保存</button>
        <button className="primary" onClick={() => setSheet('print')}>PDF出力</button>
      </div>

      {ghost && (
        <div className="ghost" style={{ left: ghost.x, top: ghost.y }}>
          {ghost.kinds.map(k => PART_LABEL[k]).join(' + ')}
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}

      {confirm && (
        <>
          <div className="scrim" onClick={() => setConfirm(null)} />
          <div className="confirm">
            <p>{confirm.what}を外していいですか？</p>
            <div className="confirm-row">
              <button className="ghostbtn" onClick={() => setConfirm(null)}>やめる</button>
              <button className="danger" onClick={() => { confirm.run(); setConfirm(null); }}>外す</button>
            </div>
          </div>
        </>
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
    : target === 'print' ? '印刷'
    : target === 'spanning' ? '見開きマンスリー'
    : kind ? PART_LABEL[kind] : 'パーツ';

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet">
        <span className="grip" />
        <h2>{title}</h2>

        {target === 'load' && (
          saved.length === 0
            ? <p className="muted">まだ保存されていません</p>
            : <ul className="saved">
                {saved.map(l => (
                  <li key={l.id}>
                    <button className="grow" onClick={() => onLoad(l)}>{l.name}</button>
                    <button className="ghostbtn" onClick={() => { deleteLayout(l.id); onClose(); }}>削除</button>
                  </li>
                ))}
              </ul>
        )}

        {target === 'print' && (
          <>
            <Choice
              label="用紙"
              options={[{ v: 'a4', label: 'A4にまとめる' }, { v: 'exact', label: '原寸のまま' }]}
              value={print.impose ? 'a4' : 'exact'}
              onPick={v => setPrint(p => ({ ...p, impose: v === 'a4' }))}
            />
            <p className="muted">
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

            <div className="field">
              <span className="field-label">部数</span>
              <div className="stepper">
                <button onClick={() => setPrint(p => ({ ...p, copies: Math.max(1, p.copies - 1) }))}>−</button>
                <strong>{print.copies}</strong>
                <button onClick={() => setPrint(p => ({ ...p, copies: Math.min(24, p.copies + 1) }))}>＋</button>
              </div>
            </div>

            {print.impose && (
              <Choice
                label="切り取り線"
                options={[{ v: 'on', label: '入れる' }, { v: 'off', label: '入れない' }]}
                value={print.cutLines ? 'on' : 'off'}
                onPick={v => setPrint(p => ({ ...p, cutLines: v === 'on' }))}
              />
            )}

            {print.impose && (
              <div className="field">
                <span className="field-label">倍率補正（刷って穴位置がずれるとき）</span>
                <div className="stepper">
                  <button onClick={() => setPrint(p => ({ ...p, scalePercent: Math.max(95, +(p.scalePercent - 0.5).toFixed(1)) }))}>−</button>
                  <strong>{print.scalePercent.toFixed(1)}%</strong>
                  <button onClick={() => setPrint(p => ({ ...p, scalePercent: Math.min(105, +(p.scalePercent + 0.5).toFixed(1)) }))}>＋</button>
                </div>
              </div>
            )}

            <button className="primary" onClick={() => onExport(print)}>書き出す</button>
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

        {target === 'spanning' && layout.spanning && (
          <Choice
            label="見開きの分け方"
            options={[{ v: 1, label: '曜日で分ける' }, { v: 2, label: '週で分ける（横向き）' }]}
            value={layout.spanning.pattern}
            // The two patterns leave different amounts of room, so the band
            // resets to what this one would have taken.
            onPick={v => setLayout(l => ({
              ...l,
              spanning: l.spanning ? {
                ...l.spanning,
                pattern: v as SpanPattern,
                ratio: l.surface.placed.length === 0 ? 1 : (v === 2 ? 0.48 : 0.72),
              } : null,
            }))}
          />
        )}

        {(target === 'spanning' || kind === 'monthly') && (
          <>
            <div className="field">
              <span className="field-label">開始月</span>
              <div className="stepper">
                <button onClick={() => setLayout(l => ({ ...l, ...addMonths(l.year, l.month, -1) }))}>−</button>
                <strong>{layout.year}年{layout.month}月</strong>
                <button onClick={() => setLayout(l => ({ ...l, ...addMonths(l.year, l.month, 1) }))}>＋</button>
              </div>
            </div>
            <div className="field">
              <span className="field-label">終了月（{layout.monthCount}ヶ月分）</span>
              <div className="stepper">
                <button onClick={() => setLayout(l => ({ ...l, monthCount: Math.max(1, l.monthCount - 1) }))}>−</button>
                <strong>{lastMonth.year}年{lastMonth.month}月</strong>
                <button onClick={() => setLayout(l => ({ ...l, monthCount: Math.min(36, l.monthCount + 1) }))}>＋</button>
              </div>
            </div>
          </>
        )}

        {target === 'spanning' && layout.spanning?.pattern === 1 && (
          <Choice
            label="翌月のミニカレンダー"
            options={[{ v: 'on', label: '入れる' }, { v: 'off', label: '入れない' }]}
            value={layout.showNextMonth ? 'on' : 'off'}
            onPick={v => setLayout(l => ({ ...l, showNextMonth: v === 'on' }))}
          />
        )}

        {kind === 'monthly' && !layout.spread && (
          <Choice
            label="ページの向き（リング位置も変わります）"
            options={[{ v: 'portrait', label: '縦' }, { v: 'landscape', label: '横（回転）' }]}
            value={layout.monthlyOrientation}
            onPick={v => setLayout(l => ({ ...l, monthlyOrientation: v as 'portrait' | 'landscape' }))}
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
          <div className="field">
            <span className="field-label">習慣の数</span>
            <div className="stepper">
              <button onClick={() => setLayout(l => ({ ...l, habitCount: Math.max(1, l.habitCount - 1) }))}>−</button>
              <strong>{layout.habitCount}</strong>
              <button onClick={() => setLayout(l => ({ ...l, habitCount: Math.min(8, l.habitCount + 1) }))}>＋</button>
            </div>
          </div>
        )}

        {typeof target !== 'string' && (
          <button className="danger" onClick={() => onRemove(target.slot)}>このパーツを外す</button>
        )}
        {target === 'spanning' && (
          <button className="danger" onClick={onRemoveSpanning}>このパーツを外す</button>
        )}
      </div>
    </>
  );
}

function Choice<T extends string | number>({ label, options, value, onPick }: {
  label: string;
  options: { v: T; label: string }[];
  value: T;
  onPick: (v: T) => void;
}) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="segmented">
        {options.map(o => (
          <button key={String(o.v)} className={o.v === value ? 'on' : ''} onClick={() => onPick(o.v)}>{o.label}</button>
        ))}
      </div>
    </div>
  );
}
