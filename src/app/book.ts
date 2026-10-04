import { useMemo } from 'react';
import type { Book, FoldGrain, Layout, PartKind, SizeSpec } from '../types';
import { SCHEMA_VERSION } from '../types';
import type { ImportPage, ImportRead } from '../lib/importfile';
import { hasDatedPart, isDayPaced, chainCount, chainOwners, paperPlan, runEnd, sheetCount, sheetSizeOf } from '../lib/render/pages';
import type { PrintOptions } from '../lib/render/pages';
import { newId } from '../lib/storage';
import { readable } from './look';

// The L-shaped fold is a different sheet from the rectangular one -- it is cut
// back on the binding side -- so it says so. The picker calls them 蛇腹N面 and
// L字N面; the editor used to call both 蛇腹N面, which left no way to tell from
// inside what you had picked.
export const formLabel = (l: Layout, grain?: FoldGrain): string =>
  l.fold > 1 ? `${grain === 'along' ? 'L字' : '蛇腹'}${l.fold}面`
    : l.spread ? '見開き' : '片面';

export const PART_LABEL: Record<PartKind, string> = {
  monthly: 'マンスリー', yearcal: '年間カレンダー', daylist: '日付リスト',
  weekvert: '週間バーチカル', weekhoriz: '週間ホリゾンタル', gantt: 'ガントチャート',
  habit: 'ハビットトラッカー', todo: 'TODOリスト',
  goal: '今月の目標', budget: '家計', grid: '方眼', lines: '罫線', memo: 'メモ',
  photo: '写真', swatch: 'インク見本',
};

export function createLayout(): Layout {
  const now = new Date();
  return {
    version: SCHEMA_VERSION,
    id: newId(),
    name: '新しいリフィル',
    size: 'M6',
    spread: true,
    fold: 1,
    spanning: null,
    surface: { placed: [], ratios: {}, split: 'h' },
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    monthCount: 12,
    daysPerSheet: 7,
    weekStart: 1,
    dayStartHour: 6,
    dayEndHour: 24,
    weekTiers: 1,
    orientation: 'portrait',
    showNextMonth: true,
    habitCount: 4,
    updatedAt: now.toISOString(),
  };
}

// A section is a refill on the same paper as the rest of the book: same size,
// same form, same way up. Everything that decides the punched sheet has to
// carry over or it could not be bound in. The 体裁 comes too -- one binder,
// one hand.
//
// `kind` is either a part to fill the sheet with (a note section: squared,
// ruled, dotted, blank) or 'blank', which is an empty sheet for someone to
// design. The note sections are the answer to "the paper has three places
// left": they are one sheet each and need nothing decided about them.
export type SectionKind = PartKind | 'blank' | 'cover' | 'backcover';

// How long a dated run starts out, from how fast it eats paper.
//
// The period used to be twelve months for everything, because a year is what
// a monthly means -- twelve sheets, four of A4. The same twelve months on a
// weekly is 53 sheets: A4 14 on Mini6 and 27 on A5, printed double-sided,
// nobody's idea of a first try. A run you have to cut back is worse than one
// you have to extend, because extending is one tap on the period and cutting
// back is something you only learn to do after wasting the paper.
//
// So the number is not the months, it is the sheets: about fifteen, which is
// four or five of A4 on most sizes. A month to a sheet lands on twelve months
// by itself, which is why the monthly is unchanged.
export const RUN_SHEETS = 15;

export const runMonths = (daysPerSheet: number): number =>
  Math.max(1, Math.min(12, Math.round((RUN_SHEETS * Math.max(1, daysPerSheet)) / 30.4)));

// A section that is paced by days starts at that length rather than at the
// book's. Applied where the pacing is decided -- when the part lands -- and
// never afterwards: silently shortening a run someone set is as bad as
// handing them a long one.
export const pacedFor = (l: Layout): Layout =>
  (isDayPaced(l) ? { ...l, monthCount: runMonths(l.daysPerSheet) } : l);

// `single` is for a section that has to be exactly one page -- what an empty
// page in the book asks for. It is not an option on a run of dates, which is
// as long as its dates whatever page it was asked for from.
export function sectionOf(kind: SectionKind, base: Layout, single = false): Layout {
  const sheet: Layout = {
    ...createLayout(),
    size: base.size,
    spread: single && base.fold <= 1 ? false : base.spread,
    single: single || undefined,
    fold: base.fold,
    foldGrain: base.foldGrain,
    orientation: base.orientation,
    year: base.year,
    month: base.month,
    monthCount: base.monthCount,
    weekStart: base.weekStart,
    words: base.words,
    hideRokuyo: base.hideRokuyo,
    tone: base.tone,
    ruleWeight: base.ruleWeight,
    pages: 1,
  };
  if (kind === 'blank') return sheet;
  // The back cover is the cover's twin at the other end: one page, nothing
  // on it, named for what it is. It fills the face the last spread leaves,
  // so it is `single` -- which is also what turns its holes to the right.
  if (kind === 'backcover') {
    return { ...sheet, name: '裏表紙', backCover: true, single: true, spread: base.fold > 1 ? base.spread : false };
  }
  // A cover is a picture filling the sheet. Nobody would arrive at that by
  // dropping a 写真 part on a blank section and stretching it, so it is a
  // thing you can ask for by name -- and it keeps that name, because what it
  // is for is not readable from what is on it.
  if (kind === 'cover') {
    return {
      ...sheet,
      name: '表紙',
      cover: true,
      // One page, even in a book of spreads: a cover is the outside of the
      // stack, not a pair of facing pages. A spread and a single page are the
      // same punched sheet, so it binds in either way -- which is exactly why
      // this is allowed to differ from the rest of the book.
      spread: base.fold > 1 ? base.spread : false,
      // Nothing on it. A cover is the first page of the book, not a
      // photograph: what goes on it is a picture for some people, a title for
      // others, and nothing at all for plenty. Putting a 写真 part on it was
      // the app's own shortage talking -- there is no way to type a word onto
      // a page yet, so a photograph was the only content anyone could supply.
    };
  }
  return pacedFor({ ...sheet, surface: { ...sheet.surface, placed: [kind] } });
}

// The empty sheet a new book starts with. It is somewhere to draw, not a
// thing anyone asked to print, so the first real section takes its place
// rather than printing beside it.
export function isPlaceholder(l: Layout): boolean {
  return !l.spanning && l.surface.placed.length === 0 && !l.background && !l.imported;
}

// Where a new section goes, and what it replaces. `where` is the index it
// lands at -- an empty page knows which one it is, so pressing it puts what
// is chosen exactly there.
export function withSection(sections: Layout[], made: Layout, where: number | boolean): Layout[] {
  const rest = sections.length === 1 && isPlaceholder(sections[0]) ? [] : sections;
  let at = where === true ? 0 : where === false ? rest.length : Math.min(where, rest.length);
  // The back cover stays the last page: what is added "at the end" goes in
  // front of it.
  if (at === rest.length && rest[rest.length - 1]?.backCover && !made.backCover) at--;
  return [...rest.slice(0, at), made, ...rest.slice(at)];
}

// What a section is called in the contents: what is on it, which is what
// anyone scanning a list of them is looking for.
export function sectionLabel(l: Layout): string {
  // A cover is a cover, not 「写真」: what it is for is not readable from
  // what is on it.
  if (l.cover) return '表紙';
  if (l.backCover) return '裏表紙';
  if (l.imported) return '取り込んだリフィル';
  if (l.name && l.name !== '新しいリフィル') return l.name;
  const parts = [
    ...(l.spanning ? ['マンスリー'] : []),
    ...l.surface.placed.map(k => PART_LABEL[k]),
  ];
  return parts.length ? parts.slice(0, 3).join('＋') : '白紙';
}

// The section a new one is copied from: the book's own form, its dates and its
// look. Never the cover, whatever order the book is in -- a cover is one page
// however the book is folded, so it carries 片面, and a monthly added to a book
// of spreads after a cover had been put on the front came out single-sided.
// The one form the whole book is in, or nothing when it is in more than one.
// A planner is allowed to be mixed -- the monthly a spread, the notes at the
// back single sheets -- and then there is no single answer to 「この束の体裁」,
// so the panel says the size and lets each section say its own.
export const oneForm = (sections: Layout[]): Layout | null => {
  const real = sections.filter(l => !l.cover && !l.single);
  const first = real[0];
  if (!first) return null;
  return real.every(l => (
    l.spread === first.spread && l.fold === first.fold && l.foldGrain === first.foldGrain
  )) ? first : null;
};

export const bodyOf = (b: Book): Layout =>
  b.sections.find(l => !l.cover && !l.single) ?? b.sections.find(l => !l.cover) ?? b.sections[0];

// A book of one empty section, which is what every refill made so far was.
export function createBook(): Book {
  const only = createLayout();
  return {
    version: SCHEMA_VERSION,
    id: newId(),
    name: '新しい束',
    sections: [only],
    updatedAt: only.updatedAt,
  };
}

// One taken-in page as a section: a single page in the book's size and form,
// carrying the picture. A file of several pages becomes several sections, in
// the file's order, so a left page and its right page land as a pair.
export function importedSection(page: ImportPage, i: number, read: ImportRead, fit: 'contain' | 'cover', base: Layout): Layout {
  return {
    ...sectionOf('blank', base, true),
    name: '取り込んだリフィル',
    imported: { src: page.src, fit, pxW: page.pxW, pxH: page.pxH, wMm: page.wMm, hMm: page.hMm, file: read.name, page: i + 1, of: read.pages.length },
  };
}

// The taken-in pages put into the book, with one blank page in front of them
// when the first one would otherwise land on the wrong side. A file drawn as
// a spread leaves the punch side free on each page -- its left page has room
// on the right -- and landing that page on the right of the book puts the
// holes through what is printed.
export function placeImported(sections: Layout[], made: Layout[], base: Layout, sideOfFirst: 'L' | 'R' | undefined): { sections: Layout[]; padded: boolean } {
  // The blank goes in after the pages are placed, beside the first of them:
  // put in on its own it would be taken for the empty starting page and
  // replaced by the next one.
  const put = (pad: boolean) => {
    const all = made.reduce((acc, l) => withSection(acc, l, false), sections);
    if (!pad) return all;
    const at = all.indexOf(made[0]);
    return [...all.slice(0, at), sectionOf('blank', base, true), ...all.slice(at)];
  };
  const plain = put(false);
  if (!sideOfFirst) return { sections: plain, padded: false };
  const i = pagesOf(plain).findIndex(leaf => leaf.at !== null && plain[leaf.at] === made[0]);
  const onLeft = i % 2 === 1;
  if ((sideOfFirst === 'L') === onLeft) return { sections: plain, padded: false };
  return { sections: put(true), padded: true };
}

// The book as pages, in the order they are turned. A page is one side of a
// punched sheet, but nobody who owns a planner thinks of it that way: they
// think 1ページ, 2ページ, and a spread is what two facing pages make.
//
// Facing pages: with the rings on the left, page 1 is alone on the right and
// pairs run 2-3, 4-5. So a spread section has to start on an even page, and
// if the page before it is not there, the book has an empty page at that
// point -- which is a page, not waste: it is where a cover or a year planner
// goes. Printing is what turns these into sheets, and it is not this
// screen's business.
export interface Leaf {
  // Which section this page belongs to, and which sheet of that section.
  at: number | null;
  nth: number;
  // Which page of that sheet: a spread has a left and a right.
  side: number;
  // For an empty page: where in the book something put here would go.
  before: number;
}

// The letter a page wears to say which section it came from -- A, B, C down
// the book. A page panel marks its pages this way because at thumbnail size
// two monthlies and a weekly are the same grey rectangle.
export const sectionMark = (sections: Layout[], at: number): string =>
  String.fromCharCode(65 + (at % 26));

export function pagesOf(sections: Layout[]): Leaf[] {
  const out: Leaf[] = [];
  const blank = (before: number) => out.push({ at: null, nth: 0, side: 0, before });
  sections.forEach((sec, at) => {
    const n = sheetCount(sec);
    if (sec.spread && sec.fold <= 1) {
      // A spread's left page is an even page number, which is an odd index.
      if (out.length % 2 === 0) blank(at);
      for (let nth = 0; nth < n; nth++) {
        out.push({ at, nth, side: 0, before: at });
        out.push({ at, nth, side: 1, before: at });
      }
    } else {
      for (let nth = 0; nth < n; nth++) out.push({ at, nth, side: 0, before: at });
    }
  });
  // The back of the last sheet is a page too -- the one a set puts its index
  // or a note page on.
  if (out.length % 2 === 1) blank(sections.length);
  return out;
}

// Whether this sheet of a one-page section is printed on the back of the
// paper. The pages of the book alternate front and back when both sides are
// printed, and a one-page section takes whichever the book has free there --
// which is how the back of the last spread becomes a page with its holes on
// the right.
export function backSideOf(sections: Layout[], at: number, nth: number, duplex: boolean): boolean {
  const sec = sections[at];
  if (!duplex || !sec || sec.fold > 1) return false;
  // A run of single pages starts on a fresh front and alternates from there,
  // so its second, fourth... sheet is a back and binds on the other edge, as
  // it is printed. Drawn with every page bound on the left, the editor showed
  // November with its holes where October's were; the paper had them right.
  if (!sec.single) return !sec.spread && nth % 2 === 1;
  const i = pagesOf(sections).findIndex(l => l.at === at && l.nth === nth);
  return i >= 0 && i % 2 === 1;
}

// The smallest change that gets a section down to `want` sheets or fewer.
// A note section is however many sheets it says; a dated one is as long as
// its dates, so it is shortened a month at a time -- a weekly cannot stop
// mid-month, and pretending otherwise would be a control that lies.
export function shortenTo(l: Layout, want: number): Layout | null {
  if (want < 1 || sheetCount(l) <= want) return null;
  if (!hasDatedPart(l)) return { ...l, pages: want };
  let months = Math.max(1, l.monthCount);
  while (months > 1 && sheetCount({ ...l, monthCount: months }) > want) months--;
  const out = { ...l, monthCount: months };
  return sheetCount(out) < sheetCount(l) ? out : null;
}

// How long a section runs, in the words its own content uses: months for a
// monthly, weeks for a weekly, sheets for a note. Not in places on the paper
// -- a week is a page and two pages share a sheet, so "48枚" for a year of
// weeks is true of neither the run nor the paper.
export function runText(l: Layout): string {
  // Pages, because the contents is a list of pages: a note section of three
  // is three pages of the book, not three sheets of paper (a sheet carries
  // two). The paper has its own line, in its own unit.
  if (!hasDatedPart(l)) return `${Math.max(1, l.pages ?? 1)}ページ`;
  if (isDayPaced(l)) return l.daysPerSheet === 7 ? `${sheetCount(l)}週` : `${sheetCount(l)}枚`;
  return `${Math.max(1, l.monthCount)}ヶ月`;
}

// How long a section runs, with the dates it covers. This is what someone
// shortens when it turns out to be too much.
export function sectionSpan(l: Layout): string {
  if (!hasDatedPart(l)) return runText(l);
  const end = runEnd(l);
  return `${l.year}年${l.month}月 → ${end.year}年${end.month}月・${runText(l)}`;
}

// ── 📖 めくって見る ──────────────────────────────────────────────────────
// The book as a book. Someone who has just finished a month does not want to
// know how many faces fit on A4: they want to know what it will look like in
// the binder, which is a thing you find out by turning the pages. So nothing
// about paper, imposition, sides or cut lines gets in here -- that is the
// export sheet's business, and this screen never mentions it.
//
// It opens on the page the editor was on, because checking the page being
// worked on is what this is used for most, and pressing a page opens it in the
// editor. That makes this a way of getting to work as much as a way of
// looking: turn to the week that is wrong, press it, fix it, come back.

// A name someone would recognise a week later, made of what the book is: its
// size, its form, and what is in it. Better than 新しい束 and better than
// making someone think of one before they can save.
export function suggestName(book: Book, size: SizeSpec, grain?: FoldGrain): string {
  const what = book.sections.map(sectionLabel).slice(0, 3).join('＋');
  // The form is the book's, and a cover has none of its own: with one on the
  // front, a book of spreads was saving itself as 「ミニ6 片面」.
  const body = bodyOf(book);
  return `${size.label} ${formLabel(body, grain)}・${what}`;
}

// What the job comes to on paper. The editor needs these numbers as much as
// the export screen does now that the paper can be filled from either.
export function usePaperJob(sections: Layout[], size: SizeSpec, print: PrintOptions) {
  const [first, ...rest] = sections;
  // The book as one chain, which is what is actually printed: a section that
  // slots into the face another one was leaving costs no paper at all.
  const used = chainCount(sections, size, print);
  const plan = paperPlan(size, used, sheetSizeOf(first, size), print.paper);
  const perPaper = plan.perPage;
  // What the last sheet has left over. Zero when it comes out even, which is
  // worth saying too: it stops the reader looking for room that is not there.
  const spare = perPaper > 0 ? (perPaper - (used % perPaper)) % perPaper : 0;
  const sheets = perPaper > 0 ? Math.ceil(used / perPaper) : 0;
  // Which section owns each place on the paper, in the order the imposition
  // lays them down: the book's sections, in order, each one whole. This is
  // what lets a page on the printed sheet say what it is.
  const owners = useMemo(() => chainOwners(sections, size, print), [sections, size, print]);
  // A folded refill is a strip, and a strip is counted in 本 -- the same place
  // on the paper, a different word for what sits in it.
  const unit = first.fold > 1 ? '本' : '枚';
  return { also: rest, used, plan, perPaper, spare, sheets, owners, unit };
}

export type PaperJob = ReturnType<typeof usePaperJob>;

export const SECTION_MENU: { title: string; kinds: SectionKind[]; run?: boolean }[] = [
  { title: 'カレンダー', kinds: ['monthly', 'yearcal', 'weekhoriz', 'weekvert', 'daylist'], run: true },
  { title: '書くところ', kinds: ['memo', 'lines', 'grid', 'todo'] },
];

export const SECTION_LABEL = (kind: SectionKind): string => (
  kind === 'cover' ? '表紙' : kind === 'backcover' ? '裏表紙' : kind === 'blank' ? '白紙' : PART_LABEL[kind]
);
