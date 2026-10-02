import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Book, Layout } from './types';
import { SIZES } from './lib/sizes';
import { IMPORT_ACCEPT, readImportFile } from './lib/importfile';
import type { ImportRead } from './lib/importfile';
import { DEFAULT_PRINT } from './lib/render/pages';
import type { PrintOptions } from './lib/render/pages';
import { Modal } from './ui/Overlay';
import { sectionOf, withSection, bodyOf, createBook, importedSection, placeImported } from './app/book';
import type { Stage } from './app/screen';
import { BookView } from './screens/BookView';
import { CanvasScreen } from './screens/CanvasScreen';
import { ContentsScreen } from './screens/ContentsScreen';
import { SidesScreen } from './screens/SidesScreen';
import { SizeScreen } from './screens/SizeScreen';
import { ImportSheet } from './sheets/files';

export function App() {
  const [stage, setStage] = useState<Stage>('size');
  // Where each screen was opened from. Not a parent -- an opener: the contents
  // reached from the editor closes back to the editor, and the editor reached
  // from the contents closes back to the contents. A fixed hierarchy cannot
  // say that, which is why pressing back in the contents used to come out at
  // the form picker however you had got there.
  const [openedFrom, setOpenedFrom] = useState<Partial<Record<Stage, Stage>>>({});
  const go = (next: Stage) => {
    setOpenedFrom(m => ({ ...m, [next]: stage }));
    setStage(next);
  };
  const back = () => { const prev = openedFrom[stage]; if (prev) setStage(prev); };
  const [book, setBook] = useState<Book>(createBook);
  // Where the editor is: which section, and which of its sheets. Turning the
  // page moves the second; the contents moves both.
  const [at, setAt] = useState(0);
  const [nth, setNth] = useState(0);
  const goTo = (i: number, sheet = 0) => { setAt(i); setNth(sheet); };
  // The paper is the book's, not a section's: everything in it is printed in
  // one run, on one kind of paper.
  const [print, setPrint] = useState<PrintOptions>(DEFAULT_PRINT);
  // What the editor should open on when it is entered from the contents: the
  // question that was being asked there, rather than the paper again.
  // Taking a file in. It joins the book being made; the size screen offers no
  // way in, because bringing a file is a side road and not how a book starts.
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState<ImportRead | null>(null);
  const [importBusy, setImportBusy] = useState<string | null>(null);
  const startImport = () => fileRef.current?.click();
  const [openOn, setOpenOn] = useState<{ key: number; what: 'range' | 'part0' }>(
    { key: 0, what: 'range' },
  );
  // Size and form belong to the book: a section on a different punched sheet
  // could not be bound into it. They are kept on every section because that
  // is all `src/lib` knows how to read.
  // A cover stays one page whatever the book is folded into, so the form the
  // picker shows -- and the form it sets -- is the rest of the book's.
  const body = bodyOf(book);
  const finishImport = (fit: 'contain' | 'cover') => {
    const read = importing!;
    setImporting(null);
    const made = read.pages.map((pg, i) => importedSection(pg, i, read, fit, body));
    const placed = placeImported(book.sections, made, body, read.pages[0]?.side);
    setBook(b => ({ ...b, sections: placed.sections }));
    goTo(Math.max(0, placed.sections.indexOf(made[0])), 0);
    if (stage !== 'canvas') go('canvas');
  };
  const importEl = (
    <>
      <input
        ref={fileRef}
        type="file"
        accept={IMPORT_ACCEPT}
        className="importfile hidden"
        onChange={async e => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          setImportBusy('読み込み中…');
          try {
            // Read for the largest size it could go to, so the picture is
            // fine enough whichever size it ends up on.
            const read = await readImportFile(file, { w: 148, h: 210 });
            setImportBusy(null);
            setImporting(read);
          } catch (err) {
            setImportBusy(`${err instanceof Error ? err.message : '読めませんでした'}。JPEG・PNG・PDFのファイルを選んでください`);
          }
        }}
      />
      {importBusy && (
        <Modal title="ファイルから取り込む" onClose={() => setImportBusy(null)}>
          <p className="importbusy m-0 text-[14px] leading-relaxed text-muted">{importBusy}</p>
        </Modal>
      )}
      {importing && (
        <ImportSheet
          read={importing}
          size={SIZES[body.size]}
          pad={placeImported(
            book.sections,
            importing.pages.map((pg, i) => importedSection(pg, i, importing, 'contain', body)),
            body, importing.pages[0]?.side,
          ).padded}
          onConfirm={finishImport}
          onClose={() => setImporting(null)}
        />
      )}
    </>
  );
  const withImport = (screen: ReactNode) => <>{screen}{importEl}</>;
  // The section being worked on. The form belongs to it -- a book of spreads
  // with single-sheet notes at the back is an ordinary planner -- while the
  // size belongs to the book, because a sheet punched differently does not go
  // in the same binder.
  const onlyHere = (fn: (l: Layout) => Layout) =>
    setBook(b => ({
      ...b,
      sections: b.sections.map((l, i) => (i === Math.min(at, b.sections.length - 1) ? fn(l) : l)),
    }));
  const every = (fn: (l: Layout) => Layout) =>
    setBook(b => ({
      ...b,
      sections: b.sections.map(l => (
        l.cover || l.single ? { ...fn(l), spread: l.fold > 1 ? fn(l).spread : false } : fn(l)
      )),
    }));

  if (stage === 'size') {
    return withImport(
      <SizeScreen
        selected={body.size}
        onPick={(size) => { every(l => ({ ...l, size })); go('sides'); }}
      />
    );
  }
  if (stage === 'sides') {
    // The refill being made, which on the first run through is the only one.
    const here = book.sections[Math.min(at, book.sections.length - 1)];
    return (
      <SidesScreen
        size={here.size}
        spread={here.spread}
        fold={here.fold}
        foldGrain={here.foldGrain}
        onPick={(v) => onlyHere(l => ({
          ...l,
          ...v,
          single: undefined,
          // A fold holds one part per panel and has no band, so anything the
          // previous shape carried beyond that goes rather than staying in the
          // layout as a part with nowhere to be drawn.
          spanning: v.fold > 1 ? null : l.spanning,
          surface: v.fold > 1
            ? {
                ...l.surface,
                placed: l.surface.placed.slice(0, v.fold),
                page: undefined, ratios: {},
                // The panels are a different shape now, so how they were
                // shared out says nothing about this strip.
                fold: undefined,
              }
            : l.surface,
        }))}
        onBack={back}
        onConfirm={() => { setAt(0); go('canvas'); }}
      />
    );
  }
  if (stage === 'contents') {
    return withImport(
      <ContentsScreen
        onImport={() => startImport()}
        book={book}
        setBook={setBook}
        print={print}
        at={Math.min(at, book.sections.length - 1)}
        nth={nth}
        onOpen={(i: number, open?: 'range' | 'part0', sheet = 0) => {
          goTo(i, sheet);
          if (open) setOpenOn(o => ({ key: o.key + 1, what: open }));
          go('canvas');
        }}
        onBack={back}
      />
    );
  }
  // Turning through the book as a book. A screen rather than an overlay,
  // because it is a place you go and come back from: pressing a page there
  // opens the editor on it, and closing that editor comes back here, to the
  // same page, still open at the same spread.
  if (stage === 'book') {
    return (
      <BookView
        book={book}
        at={Math.min(at, book.sections.length - 1)}
        nth={nth}
        print={print}
        onClose={back}
        onEdit={(i, sheet) => { goTo(i, sheet); go('canvas'); }}
        // Chosen on an empty page, so it goes at that page. A cover and a
        // blank are not finished when they are chosen -- one wants a picture,
        // the other wants everything -- so both open in the editor; anything
        // else is already what it is, and stays here to be looked at.
        onAddAt={(where, kind) => {
          // A cover is the outside of the stack, so it goes on the front
          // wherever it was asked for -- from the last page of the book it was
          // landing on the last page, which is not a cover of anything.
          // Everything else goes where it was asked for, and is one page,
          // because an empty page is one page: a spread put there takes two
          // and leaves the same empty page one further on.
          const at = kind === 'cover' ? 0 : where;
          setBook(b => ({
            ...b,
            sections: withSection(b.sections, sectionOf(kind, bodyOf(b), true), at),
          }));
          if (kind === 'cover' || kind === 'blank') { goTo(at, 0); go('canvas'); }
        }}
      />
    );
  }
  return withImport(
    <CanvasScreen
      onImport={() => startImport()}
      book={book}
      at={Math.min(at, book.sections.length - 1)}
      nth={nth}
      setBook={setBook}
      onList={() => go('contents')}
      onFlip={() => go('book')}
      // The way home, and where home is. The editor is the workshop, so it has
      // no way out of its own -- only the one back to whatever opened it.
      backTo={openedFrom.canvas === 'contents' || openedFrom.canvas === 'sides'
        || openedFrom.canvas === 'book'
        ? openedFrom.canvas
        : null}
      onBack={back}
      goTo={goTo}
      print={print}
      setPrint={setPrint}
      openOn={openOn}
    />
  );
}
