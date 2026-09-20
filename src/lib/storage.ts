import type { Layout } from '../types';
import { SCHEMA_VERSION } from '../types';

const KEY = 'refill-app.layouts';

function load(): Layout[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const layouts = JSON.parse(raw).layouts as Layout[];
    // Earlier schemas belonged to a different editor and cannot be converted.
    return layouts.filter(l => l.version === SCHEMA_VERSION);
  } catch {
    return [];
  }
}

function persist(layouts: Layout[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ layouts }));
  } catch {
    // Private browsing and blocked site data both land here; saving simply
    // does not stick, which the caller reports through its toast.
  }
}

export function listLayouts(): Layout[] {
  return load().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function saveLayout(layout: Layout) {
  const layouts = load();
  const next = { ...layout, updatedAt: new Date().toISOString(), version: SCHEMA_VERSION };
  const i = layouts.findIndex(l => l.id === layout.id);
  if (i >= 0) layouts[i] = next; else layouts.push(next);
  persist(layouts);
}

export function deleteLayout(id: string) {
  persist(load().filter(l => l.id !== id));
}

export function newId(): string {
  return crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
}
