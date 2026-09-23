import type { Layout } from '../types';
import { SCHEMA_VERSION } from '../types';

// Version 7 kept the orientation inside the calendar: a spread said it through
// its span pattern, a single page through a field of its own. Version 8 puts it
// on the refill, where it belongs. Version 9 adds how many days a sheet covers,
// version 10 the hours a vertical spans, version 11 how many bands it folds
// into, and version 12 whether the sheet itself folds -- all things a saved
// layout simply did not have a say in. Converting is cheap, and throwing away
// someone's saved layouts over a field we can work out is not acceptable.
const DEFAULT_DAYS_PER_SHEET = 7;
// The hours a vertical used to be fixed to.
const DEFAULT_DAY_HOURS = { dayStartHour: 6, dayEndHour: 24 };

function migrate(raw: Record<string, unknown>): Layout | null {
  if (raw.version === SCHEMA_VERSION) return raw as unknown as Layout;

  let out = raw;
  if (out.version === 7) {
    const span = out.spanning as { pattern?: number; ratio: number } | null;
    const landscape = out.spread ? span?.pattern === 2 : out.monthlyOrientation === 'landscape';
    const { monthlyOrientation, ...rest } = out;
    void monthlyOrientation;
    out = {
      ...rest,
      version: 8,
      orientation: landscape ? 'landscape' : 'portrait',
      spanning: span ? { ratio: span.ratio } : null,
    };
  }
  if (out.version === 8) {
    // A week to a spread is what every saved layout was drawing already.
    out = { ...out, version: 9, daysPerSheet: DEFAULT_DAYS_PER_SHEET };
  }
  if (out.version === 9) {
    // 6:00 to 24:00 is what every vertical was drawing already.
    out = { ...out, version: 10, ...DEFAULT_DAY_HOURS };
  }
  if (out.version === 10) {
    // One band across is what every vertical was drawing already.
    out = { ...out, version: 11, weekTiers: 1 };
  }
  if (out.version === 11) {
    // Nothing saved before this folded.
    out = { ...out, version: 12, fold: 1 };
  }
  if (out.version === 12) {
    // 体裁は省略が既定（セピア・ふつう・9月 Mon）なので、足すのは番号だけ。
    // 古い紙が黙って別の色で刷られないように、既定は今までの色そのもの。
    out = { ...out, version: 13 };
  }
  return out.version === SCHEMA_VERSION ? (out as unknown as Layout) : null;
}

const KEY = 'refill-app.layouts';

function load(): Layout[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const stored = JSON.parse(raw).layouts as Record<string, unknown>[];
    return stored.map(migrate).filter((l): l is Layout => l !== null);
  } catch {
    return [];
  }
}

// Says whether it stuck. Private browsing, blocked site data and a full store
// all land in the catch, and since a background photo can fill the store on
// its own, the difference between "saved" and "did not save" has to reach the
// screen -- a layout that silently did not save is one the user finds missing
// later.
function persist(layouts: Layout[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify({ layouts }));
    return true;
  } catch {
    return false;
  }
}

export function listLayouts(): Layout[] {
  return load().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function saveLayout(layout: Layout): boolean {
  const layouts = load();
  const next = { ...layout, updatedAt: new Date().toISOString(), version: SCHEMA_VERSION };
  const i = layouts.findIndex(l => l.id === layout.id);
  if (i >= 0) layouts[i] = next; else layouts.push(next);
  return persist(layouts);
}

export function deleteLayout(id: string) {
  persist(load().filter(l => l.id !== id));
}

export function newId(): string {
  return crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
}
