import { useState } from 'react';
import type { Book, FoldGrain, SizeSpec } from '../types';
import { SIZES } from '../lib/sizes';
import { printedDpi } from '../lib/importfile';
import type { ImportRead } from '../lib/importfile';
import { Button } from '../ui/Button';
import { Field, Segmented } from '../ui/Field';
import { Modal } from '../ui/Overlay';
import { suggestName } from '../app/book';

// Naming what is being saved. A sheet rather than a dialog, because it is the
// same shape of question as everything else here and it has to work beside the
// paper on a desktop.
export function SaveSheet({ book, size, grain, onSave }: {
  book: Book; size: SizeSpec; grain?: FoldGrain; onSave: (name: string) => void;
}) {
  const [name, setName] = useState(() => (
    book.name && book.name !== '新しい束' ? book.name : suggestName(book, size, grain)
  ));
  return (
    <>
      <Field label="名前">
        <input
          className="savename w-full rounded-[9px] border border-line-strong bg-white px-3 py-[11px] text-[14px]"
          value={name}
          autoFocus
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onSave(name.trim() || suggestName(book, size, grain)); }}
        />
      </Field>
      <p className="m-0 text-[13px] leading-snug text-muted">
        表紙から裏表紙まで、まとめて保存されます。ページの順番も、用紙も、
        <strong className="font-semibold text-label">そのまま開き直せます</strong>
      </p>
      <Button variant="cta" onClick={() => onSave(name.trim() || suggestName(book, size, grain))}>
        保存する
      </Button>
    </>
  );
}

// What was read from a file, before anything goes into the book: what it is,
// what will happen to it on this size, and the one choice that changes how it
// looks. Saying it here, once, is cheaper than someone finding on the paper
// that an A5 page went into a Mini6 at half its size.
export function ImportSheet({ read, size, pad, onConfirm, onClose }: {
  read: ImportRead;
  // A blank page goes in first, so the pages land on the side they were drawn for.
  pad: boolean;
  size: SizeSpec;
  onConfirm: (fit: 'contain' | 'cover') => void;
  onClose: () => void;
}) {
  const [fit, setFit] = useState<'contain' | 'cover'>('contain');
  const paper = { w: size.widthMm, h: size.heightMm };
  const first = read.pages.find(p => p.wMm && p.hMm);
  const shrink = first ? Math.min(paper.w / first.wMm!, paper.h / first.hMm!) : null;
  const dpi = read.pages.length ? Math.min(...read.pages.map(p => printedDpi(p, paper, fit))) : 0;
  const mm = (v: number) => Math.round(v);
  const fileSize = first ? (Object.values(SIZES).find(z => Math.abs(z.widthMm - first.wMm!) < 1 && Math.abs(z.heightMm - first.hMm!) < 1)?.label ?? null) : null;
  return (
    <Modal title="ファイルから取り込む" onClose={onClose}>
      <div className="importsheet flex flex-col gap-3">
        <p className="m-0 text-[13px] leading-relaxed">
          <span className="font-semibold">{read.name}</span>
          <span className="text-muted">
            {read.kind === 'pdf' ? `・PDF ${read.pages.length}ページ` : '・画像'}
          </span>
        </p>
        {read.pages.length > 0 && (
          <span className="flex gap-1.5 overflow-x-auto">
            {read.pages.slice(0, 6).map((p, i) => (
              <img key={i} src={p.src} alt={`${i + 1}ページ目`} className="h-[86px] w-auto shrink-0 rounded-[2px] border border-line bg-white" />
            ))}
          </span>
        )}
        {read.skipped > 0 && (
          <p className="importskip m-0 text-[13px] leading-relaxed text-danger">
            {read.pages.length === 0
              ? 'このPDFは線と文字でできているので、まだ取り込めません。画像だけのPDFか、画像を選んでください'
              : `線と文字でできたページ（${read.skipped}ページ）は、まだ取り込めないので入れません`}
          </p>
        )}
        {read.pages.length > 0 && (
          <>
            <ul className="importfacts m-0 flex list-none flex-col gap-1 p-0 text-[13px] leading-relaxed text-muted">
              {first && <li>元の大きさ {mm(first.wMm!)}×{mm(first.hMm!)}mm{fileSize ? `（${fileSize}）` : ''}</li>}
              <li>
                入れる先 <span className="font-semibold text-label">{size.label} {size.widthMm}×{size.heightMm}mm</span>
              </li>
              {shrink !== null && shrink < 0.95 && (
                <li className="importshrink text-danger">
                  {fileSize ?? '元'}用を{size.label}に入れると、約{Math.round(shrink * 100)}%に縮みます。書き込む欄があるリフィルは、欄が狭くなります
                </li>
              )}
              <li className={dpi < 200 ? 'importdpi text-danger' : 'importdpi'}>
                刷ったときの細かさ 約{dpi}dpi{dpi < 200 ? '。線がぼやけて見えることがあります' : ''}
              </li>
              {read.pages[0]?.side && (
                <li className="importside">
                  1ページ目は見開きの{read.pages[0].side === 'L' ? '左（穴を右に空けてある）' : '右（穴を左に空けてある）'}のページです。
                  {pad ? '穴の側が合うように、前に白紙を1ページ入れます' : 'そのままで穴の側が合います'}
                </li>
              )}
              <li>ページの順に、最後（裏表紙の前）に入ります。取り込んだページにはパーツを置けません</li>
            </ul>
            <Field label="入れ方">
              <Segmented
                options={[{ v: 'contain', label: '全体を入れる' }, { v: 'cover', label: 'いっぱいに広げる' }]}
                value={fit}
                onPick={v => setFit(v as 'contain' | 'cover')}
              />
            </Field>
            <p className="m-0 -mt-1.5 text-[13px] leading-snug text-muted">
              {fit === 'contain' ? '縦横の比を保って全体を入れます。余白が出ることがあります' : '紙いっぱいに広げます。はみ出たところは切れます'}
            </p>
          </>
        )}
        <span className="flex gap-2">
          <Button variant="quiet" className="flex-1" onClick={onClose}>やめる</Button>
          {read.pages.length > 0 && (
            <Button variant="cta" className="importgo flex-[1.4] !p-3 !text-[15px]" onClick={() => onConfirm(fit)}>取り込む</Button>
          )}
        </span>
      </div>
    </Modal>
  );
}
