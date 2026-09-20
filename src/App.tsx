import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Layout, PageKey, PartKind, RefillSize, SpanPattern } from './types';
import { MAX_PARTS_PER_PAGE, SCHEMA_VERSION } from './types';
import { SIZES } from './lib/sizes';
import { buildGeometry, MAX_RATIO, MIN_RATIO } from './lib/layout';
import type { Divider, PageGeometry } from './lib/layout';
import { buildPages } from './lib/render/pages';
import { PageSvg } from './lib/render/svg';
import { downloadPdf, pagesToPdf } from './lib/render/pdf';
import { deleteLayout, listLayouts, newId, saveLayout } from './lib/storage';

type Stage = 'size' | 'sides' | 'canvas';
type SheetTarget = { page: PageKey; slot: number } | 'spanning' | 'load' | null;

const TRAY: { kind: PartKind; label: string; glyph: string }[] = [
  { kind: 'monthly', label: 'マンスリー', glyph: '31' },
  { kind: 'habit', label: 'ハビット', glyph: '✓' },
  { kind: 'grid', label: '方眼', glyph: '#' },
  { kind: 'lines', label: '罫線', glyph: '#' },
  { kind: 'memo', label: 'メモ', glyph: '✎' },
];

const PART_LABEL: Record<PartKind, string> = {
  monthly: 'マンスリー', habit: 'ハビットトラッカー', grid: '方眼', lines: '罫線', memo: 'メモ',
};

const emptyPage = () => ({ placed: [] as PartKind[], ratios: {} });

function createLayout(): Layout {
  const now = new Date();
  return {
    version: SCHEMA_VERSION,
    id: newId(),
    name: '新しいリフィル',
    size: 'M6',
    spread: true,
    spanning: null,
    pages: { single: emptyPage(), left: emptyPage(), right: emptyPage() },
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    weekStart: 1,
    monthlyOrientation: 'portrait',
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

function SizeScreen({ selected, onPick }: { selected: RefillSize; onPick: (s: RefillSize) => void }) {
  return (
    <div className="screen pad">
      <div className="brand">RingCraftLab</div>
      <h1>手帳のサイズを選ぶ</h1>
      <div className="cards">
        {Object.values(SIZES).map(s => (
          <button key={s.id} className={`card${selected === s.id ? ' on' : ''}`} onClick={() => onPick(s.id)}>
            <span
              className="swatch"
              style={{ width: 18 + (s.widthMm / s.heightMm) * 34, height: 44 }}
            />
            <span className="card-text">
              <strong>{s.label}</strong>
              <small>{s.widthMm}×{s.heightMm}mm</small>
            </span>
          </button>
        ))}
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
  from: { page: PageKey; slot: number } | null;
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
  const [drag, setDrag] = useState<{ x: number; y: number; kinds: PartKind[] } | null>(null);

  const dragRef = useRef<DragState | null>(null);
  const dividerRef = useRef<{ d: Divider; startX: number; startY: number; extentPx: number } | null>(null);
  const pageEls = useRef(new Map<PageKey, HTMLDivElement>());
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

  const GAP = 6;
  const first = geo.pages[0];
  const n = geo.pages.length;
  const acrossMm = geo.flow === 'row' ? first.widthMm * n : first.widthMm;
  const downMm = geo.flow === 'row' ? first.heightMm : first.heightMm * n;
  const gapPx = (n - 1) * GAP;
  const scale = Math.max(0.1, Math.min(
    (box.w - (geo.flow === 'row' ? gapPx : 0)) / acrossMm,
    (box.h - (geo.flow === 'column' ? gapPx : 0)) / downMm,
  ));

  const say = (text: string) => {
    setToast(text);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 1800);
  };

  const addParts = (page: PageKey, kinds: PartKind[]) => {
    setLayout(prev => {
      let spanning = prev.spanning;
      let rest = kinds;
      // On a spread the calendar is one part across both pages, so it becomes
      // the spanning band rather than a tile.
      if (prev.spread && !spanning && kinds.includes('monthly')) {
        spanning = { pattern: 1, ratio: 1 };
        rest = kinds.filter(k => k !== 'monthly');
      }
      // The calendar keeps the whole page until something else actually joins
      // it — space is never reserved in advance.
      if (spanning && rest.length > 0 && spanning.ratio >= 0.95) {
        spanning = { ...spanning, ratio: spanning.pattern === 2 ? 0.48 : 0.72 };
      }
      const pg = prev.pages[page];
      const room = MAX_PARTS_PER_PAGE - pg.placed.length;
      const toAdd = rest.slice(0, room);
      if (rest.length > toAdd.length) say(`1ページに置けるのは${MAX_PARTS_PER_PAGE}つまでです`);
      return {
        ...prev,
        spanning,
        pages: { ...prev.pages, [page]: { placed: [...pg.placed, ...toAdd], ratios: {} } },
      };
    });
  };

  const swapParts = (page: PageKey, a: number, b: number) => {
    if (a === b) return;
    setLayout(prev => {
      const placed = [...prev.pages[page].placed];
      [placed[a], placed[b]] = [placed[b], placed[a]];
      return { ...prev, pages: { ...prev.pages, [page]: { ...prev.pages[page], placed } } };
    });
  };

  const removePart = (page: PageKey, slot: number) => {
    setLayout(prev => ({
      ...prev,
      pages: { ...prev.pages, [page]: { placed: prev.pages[page].placed.filter((_, i) => i !== slot), ratios: {} } },
    }));
    setSheet(null);
  };

  const hitPage = (x: number, y: number): PageKey | null => {
    for (const [key, el] of pageEls.current) {
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return key;
    }
    return null;
  };

  const hitRegion = (page: PageKey, x: number, y: number): number | null => {
    const el = pageEls.current.get(page);
    const pg = geo.pages.find(p => p.key === page);
    if (!el || !pg) return null;
    const r = el.getBoundingClientRect();
    const mx = (x - r.left) / scale, my = (y - r.top) / scale;
    for (let i = 0; i < pg.regions.length; i++) {
      const g = pg.regions[i];
      if (mx >= g.x && mx <= g.x + g.w && my >= g.y && my <= g.y + g.h) return i;
    }
    return null;
  };

  // One pointer gesture covers both tray interactions: a tap toggles the
  // stamp's selection, a drag carries it (or the whole selection) onto a page.
  const startDrag = (e: React.PointerEvent, kinds: PartKind[], from: DragState['from']) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { kinds, from, moved: false, startX: e.clientX, startY: e.clientY };
  };
  const moveDrag = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (!d.moved && Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) < 8) return;
    d.moved = true;
    setDrag({ x: e.clientX, y: e.clientY, kinds: d.kinds });
  };
  const endTrayDrag = (e: React.PointerEvent, kind: PartKind) => {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!d) return;
    if (!d.moved) {
      setTraySelected(prev => prev.includes(kind) ? prev.filter(k => k !== kind) : [...prev, kind]);
      return;
    }
    const page = hitPage(e.clientX, e.clientY);
    if (page) {
      addParts(page, d.kinds);
      setTraySelected([]);
    }
  };
  const endPartDrag = (e: React.PointerEvent, page: PageKey, slot: number) => {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!d) return;
    if (!d.moved) { setSheet({ page, slot }); return; }
    const target = hitRegion(page, e.clientX, e.clientY);
    if (target !== null) swapParts(page, slot, target);
  };

  const startDivider = (e: React.PointerEvent, d: Divider) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
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
      : { ...prev, pages: { ...prev.pages, [d.page]: { ...prev.pages[d.page], ratios: { ...prev.pages[d.page].ratios, [d.key]: next } } } });
  };
  const endDivider = () => { dividerRef.current = null; };

  const onExport = async () => {
    const bytes = await pagesToPdf(pages, layout.name);
    downloadPdf(bytes, `${layout.name || 'refill'}.pdf`);
    say('原寸PDFを書き出しました');
  };

  return (
    <div className="screen">
      <header className="bar">
        <button className="icon" onClick={onBack} aria-label="戻る">←</button>
        <span>{size.label} ・ {layout.spread ? '見開き' : '片面'}</span>
      </header>

      <div className="stage" ref={boxRef}>
        <div className="sheetset" style={{ flexDirection: geo.flow, gap: GAP }}>
          {geo.pages.map((pg, i) => (
            <PageView
              key={pg.key}
              pg={pg}
              page={pages[i]}
              scale={scale}
              layout={layout}
              register={el => { if (el) pageEls.current.set(pg.key, el); else pageEls.current.delete(pg.key); }}
              onPartDown={(e, slot) => startDrag(e, [layout.pages[pg.key].placed[slot]], { page: pg.key, slot })}
              onPartMove={moveDrag}
              onPartUp={(e, slot) => endPartDrag(e, pg.key, slot)}
              onSpanTap={() => setSheet('spanning')}
              onDividerDown={startDivider}
              onDividerMove={moveDivider}
              onDividerUp={endDivider}
            />
          ))}
        </div>
      </div>

      <p className={`hint${traySelected.length > 1 ? ' active' : ''}`}>
        {traySelected.length > 1
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
        <button className="primary" onClick={onExport}>PDF出力</button>
      </div>

      {drag && (
        <div className="ghost" style={{ left: drag.x, top: drag.y }}>
          {drag.kinds.map(k => PART_LABEL[k]).join(' + ')}
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}

      {sheet && (
        <PartSheet
          target={sheet}
          layout={layout}
          setLayout={setLayout}
          onClose={() => setSheet(null)}
          onRemove={removePart}
          onLoad={l => { setLayout(() => l); setSheet(null); say('読み込みました'); }}
        />
      )}
    </div>
  );
}

function PageView({ pg, page, scale, layout, register, onPartDown, onPartMove, onPartUp, onSpanTap, onDividerDown, onDividerMove, onDividerUp }: {
  pg: PageGeometry;
  page: ReturnType<typeof buildPages>[number];
  scale: number;
  layout: Layout;
  register: (el: HTMLDivElement | null) => void;
  onPartDown: (e: React.PointerEvent, slot: number) => void;
  onPartMove: (e: React.PointerEvent) => void;
  onPartUp: (e: React.PointerEvent, slot: number) => void;
  onSpanTap: () => void;
  onDividerDown: (e: React.PointerEvent, d: Divider) => void;
  onDividerMove: (e: React.PointerEvent) => void;
  onDividerUp: () => void;
}) {
  const placed = layout.pages[pg.key].placed;
  const px = (mm: number) => mm * scale;
  const empty = placed.length === 0 && !pg.spanRect;

  return (
    <div className="page" ref={register} style={{ width: px(pg.widthMm), height: px(pg.heightMm) }}>
      <PageSvg page={page} scale={scale} showGuides />

      {empty && <div className="drop-hint">スタンプをドラッグして<br />ここに配置</div>}

      {pg.spanRect && (
        <button
          className="hitbox"
          onClick={onSpanTap}
          style={{ left: px(pg.spanRect.x), top: px(pg.spanRect.y), width: px(pg.spanRect.w), height: px(pg.spanRect.h) }}
          aria-label="マンスリーの設定"
        />
      )}

      {placed.map((kind, slot) => {
        const r = pg.regions[slot];
        if (!r) return null;
        return (
          <div
            key={slot}
            className="hitbox part"
            style={{ left: px(r.x), top: px(r.y), width: px(r.w), height: px(r.h) }}
            onPointerDown={e => onPartDown(e, slot)}
            onPointerMove={onPartMove}
            onPointerUp={e => onPartUp(e, slot)}
            title={PART_LABEL[kind]}
          />
        );
      })}

      {pg.dividers.map(d => (
        <div
          key={d.id}
          className={`divider ${d.axis}`}
          style={d.axis === 'h'
            ? { left: px(d.x), top: px(d.y) - 11, width: px(d.length), height: 22 }
            : { left: px(d.x) - 11, top: px(d.y), width: 22, height: px(d.length) }}
          onPointerDown={e => onDividerDown(e, d)}
          onPointerMove={onDividerMove}
          onPointerUp={onDividerUp}
          onPointerCancel={onDividerUp}
        >
          <i />
        </div>
      ))}
    </div>
  );
}

function PartSheet({ target, layout, setLayout, onClose, onRemove, onLoad }: {
  target: Exclude<SheetTarget, null>;
  layout: Layout;
  setLayout: (fn: (l: Layout) => Layout) => void;
  onClose: () => void;
  onRemove: (page: PageKey, slot: number) => void;
  onLoad: (l: Layout) => void;
}) {
  const saved = useMemo(() => target === 'load' ? listLayouts() : [], [target]);
  const kind = target === 'spanning' || target === 'load'
    ? null
    : layout.pages[target.page].placed[target.slot];

  const title = target === 'load' ? '保存済みレイアウト'
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
            onPick={v => setLayout(l => ({
              ...l,
              spanning: l.spanning ? { ...l.spanning, pattern: v as SpanPattern } : null,
            }))}
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

        {target !== 'load' && target !== 'spanning' && (
          <button className="danger" onClick={() => onRemove(target.page, target.slot)}>このパーツを外す</button>
        )}
        {target === 'spanning' && (
          <button className="danger" onClick={() => { setLayout(l => ({ ...l, spanning: null })); onClose(); }}>
            このパーツを外す
          </button>
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
