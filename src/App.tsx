import { useEffect, useMemo, useState } from 'react';
import type { Layout, Part, RefillSize } from './types';
import { SCHEMA_VERSION } from './types';
import { SIZES } from './lib/sizes';
import { PageSvg } from './lib/render/svg';
import { pagesToPdf, downloadPdf } from './lib/render/pdf';
import { buildHabitTrackerPages } from './lib/parts/habitTracker';
import { buildMonthlyCalendarPages } from './lib/parts/monthlyCalendar';
import { deleteLayout, listLayouts, newId, saveLayout } from './lib/storage';

type Tab = 'habit' | 'monthly';

function defaultPart(tab: Tab): Part {
  const today = new Date();
  const iso = today.toISOString().slice(0, 10);
  if (tab === 'habit') {
    return {
      kind: 'habit-tracker',
      id: newId(),
      startDate: iso,
      days: 31,
      habits: ['読書', '運動', '早起き', '日記'],
      title: 'Habit Tracker',
      weekdayFormat: 'en-initial',
    };
  }
  return {
    kind: 'monthly-calendar',
    id: newId(),
    year: today.getFullYear(),
    month: today.getMonth() + 1,
    weekStart: 1,
    weekdayFormat: 'en-short',
    spread: true,
  };
}

function defaultLayout(tab: Tab): Layout {
  const size: RefillSize = tab === 'habit' ? 'M6' : 'M5';
  return {
    version: SCHEMA_VERSION,
    id: newId(),
    name: tab === 'habit' ? '新規ハビットトラッカー' : '新規マンスリー',
    size,
    part: defaultPart(tab),
    updatedAt: new Date().toISOString(),
  };
}

export function App() {
  const [tab, setTab] = useState<Tab>('habit');
  const [layout, setLayout] = useState<Layout>(() => defaultLayout('habit'));
  const [saved, setSaved] = useState<Layout[]>(() => listLayouts());
  const [showGuides, setShowGuides] = useState(true);

  useEffect(() => {
    // Switching tab resets to a matching template unless the current part
    // already matches.
    const wantKind = tab === 'habit' ? 'habit-tracker' : 'monthly-calendar';
    if (layout.part.kind !== wantKind) setLayout(defaultLayout(tab));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const size = SIZES[layout.size];
  const pages = useMemo(() => {
    if (layout.part.kind === 'habit-tracker') return buildHabitTrackerPages(layout.part, size);
    return buildMonthlyCalendarPages(layout.part, size);
  }, [layout, size]);

  const refreshSaved = () => setSaved(listLayouts());

  const onSave = () => {
    saveLayout(layout);
    refreshSaved();
  };
  const onLoad = (l: Layout) => setLayout({ ...l, id: l.id });
  const onDelete = (id: string) => { deleteLayout(id); refreshSaved(); };

  const onExportPdf = async () => {
    const bytes = await pagesToPdf(pages, layout.name);
    downloadPdf(bytes, `${layout.name || 'refill'}.pdf`);
  };

  return (
    <div className="app">
      <aside className="panel">
        <h1>RingCraftLab</h1>

        <div className="tabs">
          <button className={tab==='habit' ? 'active' : ''} onClick={() => setTab('habit')}>ハビット</button>
          <button className={tab==='monthly' ? 'active' : ''} onClick={() => setTab('monthly')}>マンスリー</button>
        </div>

        <label>レイアウト名</label>
        <input value={layout.name} onChange={e => setLayout({ ...layout, name: e.target.value })} />

        <label>サイズ</label>
        <select value={layout.size} onChange={e => setLayout({ ...layout, size: e.target.value as RefillSize })}>
          {Object.values(SIZES).map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>

        {layout.part.kind === 'habit-tracker' && (
          <HabitControls layout={layout} onChange={setLayout} />
        )}
        {layout.part.kind === 'monthly-calendar' && (
          <MonthlyControls layout={layout} onChange={setLayout} />
        )}

        <h2>表示</h2>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={showGuides} onChange={e => setShowGuides(e.target.checked)} />
          リング・穴ガイドを表示（印刷には出力しません）
        </label>

        <h2>操作</h2>
        <button onClick={onSave}>保存</button>
        <button className="secondary" onClick={onExportPdf}>PDF出力（原寸）</button>
        <button className="secondary" onClick={() => setLayout(defaultLayout(tab))}>新規作成</button>

        <h2>保存済みレイアウト</h2>
        {saved.length === 0 && <p style={{ fontSize: 13, color: '#888' }}>まだ保存されていません</p>}
        <ul className="saved-list">
          {saved.map(l => (
            <li key={l.id}>
              <span>{l.name} <small style={{ color: '#999' }}>({SIZES[l.size].label})</small></span>
              <span>
                <button onClick={() => onLoad(l)}>読込</button>
                <button className="secondary" onClick={() => onDelete(l.id)}>削除</button>
              </span>
            </li>
          ))}
        </ul>
      </aside>

      <main className="preview">
        <div style={{ fontSize: 13, color: '#666' }}>
          {size.label} · プレビューは実寸の約3倍で表示
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {pages.map((p, i) => (
            <PageSvg key={i} page={p} scale={3} showGuides={showGuides} />
          ))}
        </div>
      </main>
    </div>
  );
}

function HabitControls({ layout, onChange }: { layout: Layout; onChange: (l: Layout) => void }) {
  if (layout.part.kind !== 'habit-tracker') return null;
  const p = layout.part;
  const set = (patch: Partial<typeof p>) => onChange({ ...layout, part: { ...p, ...patch } });
  return (
    <>
      <h2>ハビット設定</h2>
      <label>タイトル</label>
      <input value={p.title} onChange={e => set({ title: e.target.value })} />

      <label>開始日</label>
      <input type="date" value={p.startDate} onChange={e => set({ startDate: e.target.value })} />

      <label>日数（月またぎ可）</label>
      <input type="number" min={1} max={62} value={p.days} onChange={e => set({ days: Number(e.target.value) })} />

      <label>曜日表示</label>
      <select value={p.weekdayFormat} onChange={e => set({ weekdayFormat: e.target.value as any })}>
        <option value="en-initial">S M T W ...</option>
        <option value="en-short">Sun Mon ...</option>
        <option value="jp-long">日 月 火 ...</option>
      </select>

      <label>習慣リスト</label>
      {p.habits.map((h, i) => (
        <div className="habit-row" key={i}>
          <input value={h} onChange={e => {
            const habits = [...p.habits];
            habits[i] = e.target.value;
            set({ habits });
          }} />
          <button className="secondary" onClick={() => set({ habits: p.habits.filter((_, j) => j !== i) })}>×</button>
        </div>
      ))}
      <button className="secondary" onClick={() => set({ habits: [...p.habits, '新しい習慣'] })}>＋ 習慣を追加</button>
    </>
  );
}

function MonthlyControls({ layout, onChange }: { layout: Layout; onChange: (l: Layout) => void }) {
  if (layout.part.kind !== 'monthly-calendar') return null;
  const p = layout.part;
  const set = (patch: Partial<typeof p>) => onChange({ ...layout, part: { ...p, ...patch } });
  return (
    <>
      <h2>マンスリー設定</h2>
      <label>年</label>
      <input type="number" value={p.year} onChange={e => set({ year: Number(e.target.value) })} />
      <label>月</label>
      <input type="number" min={1} max={12} value={p.month} onChange={e => set({ month: Number(e.target.value) })} />

      <label>週の始まり</label>
      <select value={p.weekStart} onChange={e => set({ weekStart: Number(e.target.value) as 0 | 1 })}>
        <option value={1}>月曜始まり</option>
        <option value={0}>日曜始まり</option>
      </select>

      <label>曜日表示</label>
      <select value={p.weekdayFormat} onChange={e => set({ weekdayFormat: e.target.value as any })}>
        <option value="en-short">Sun Mon ...</option>
        <option value="en-initial">S M T W ...</option>
        <option value="jp-long">日 月 火 ...</option>
      </select>

      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input type="checkbox" style={{ width: 'auto' }} checked={p.spread} onChange={e => set({ spread: e.target.checked })} />
        見開き2ページ（M5推奨）
      </label>
    </>
  );
}
