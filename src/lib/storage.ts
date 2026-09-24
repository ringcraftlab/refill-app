import type { Book, Layout } from '../types';
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

// A section, up to the version before books existed. Books are version 14, so
// nothing here ever returns one; wrapping is the caller's job.
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
  if (out.version === 13) {
    // 束になった。1つで保存されていたリフィルは、セクション1つの束になる。
    out = { ...out, version: 14 };
  }
  return out.version === SCHEMA_VERSION ? (out as unknown as Layout) : null;
}

// What was saved before version 14 was a single refill. It becomes a book of
// one section, which is what it always was -- a book nobody had a second
// section for yet.
function asBook(raw: Record<string, unknown>): Book | null {
  if (Array.isArray(raw.sections)) {
    const sections = (raw.sections as Record<string, unknown>[])
      .map(migrate).filter((l): l is Layout => l !== null);
    return sections.length ? { ...(raw as unknown as Book), sections } : null;
  }
  const only = migrate(raw);
  return only && {
    version: SCHEMA_VERSION,
    id: only.id,
    name: only.name,
    sections: [only],
    updatedAt: only.updatedAt,
  };
}

const KEY = 'refill-app.layouts';

function load(): Book[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const stored = JSON.parse(raw).layouts as Record<string, unknown>[];
    return stored.map(asBook).filter((b): b is Book => b !== null);
  } catch {
    return [];
  }
}

// Says whether it stuck. Private browsing, blocked site data and a full store
// all land in the catch, and since a background photo can fill the store on
// its own, the difference between "saved" and "did not save" has to reach the
// screen -- a layout that silently did not save is one the user finds missing
// later.
// Bumped on every write. The editor asks what else could share the paper on
// every render now, and reading the store means parsing every saved design
// (photographs included) -- so the answer is cached against this, and saving
// or deleting one is what makes it stale.
let revision = 0;
export const storeRevision = (): number => revision;

function persist(layouts: Book[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify({ layouts }));
    revision++;
    return true;
  } catch {
    return false;
  }
}

export function listBooks(): Book[] {
  return load().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function saveBook(book: Book): boolean {
  const books = load();
  const next = { ...book, updatedAt: new Date().toISOString(), version: SCHEMA_VERSION };
  const i = books.findIndex(b => b.id === book.id);
  if (i >= 0) books[i] = next; else books.push(next);
  return persist(books);
}

export function deleteBook(id: string) {
  persist(load().filter(b => b.id !== id));
}

export function newId(): string {
  return crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
}
