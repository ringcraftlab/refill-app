import type { Layout } from '../types';
import { SCHEMA_VERSION } from '../types';

const KEY = 'refill-app.layouts.v1';

interface Store { layouts: Layout[]; }

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { layouts: [] };
    const data = JSON.parse(raw);
    // Migration hook for future schema bumps
    return { layouts: (data.layouts as Layout[]).map(migrate) };
  } catch {
    return { layouts: [] };
  }
}

function migrate(l: Layout): Layout {
  // Currently only v1 exists. Add up-conversions here on future bumps.
  if (l.version === SCHEMA_VERSION) return l;
  return { ...l, version: SCHEMA_VERSION };
}

function save(store: Store) {
  localStorage.setItem(KEY, JSON.stringify(store));
}

export function listLayouts(): Layout[] {
  return load().layouts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function saveLayout(layout: Layout) {
  const store = load();
  const idx = store.layouts.findIndex(l => l.id === layout.id);
  const withTs = { ...layout, updatedAt: new Date().toISOString(), version: SCHEMA_VERSION };
  if (idx >= 0) store.layouts[idx] = withTs;
  else store.layouts.push(withTs);
  save(store);
}

export function deleteLayout(id: string) {
  const store = load();
  store.layouts = store.layouts.filter(l => l.id !== id);
  save(store);
}

export function exportLayout(layout: Layout): string {
  return JSON.stringify(layout, null, 2);
}

export function importLayout(json: string): Layout {
  const parsed = JSON.parse(json);
  return migrate(parsed);
}

export function newId(): string {
  return (crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)) as string;
}
