import type { PartKind } from '../types';
import type { PrintOptions } from '../lib/render/pages';
import { PAPERS } from '../lib/render/impose';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Overlay';
import { SECTION_MENU, SECTION_LABEL } from '../app/book';
import type { SectionKind, PaperJob } from '../app/book';
import { StampIcon, FileGlyph } from '../app/icons';

export function AddSection({ job, print, positioned = false, cover = true, onPick, onClose, onImport }: {
  // Taking a page in from a file. Not offered on a single empty page: a file
  // is as many pages as it has.
  onImport?: () => void;
  // How much room is left on the last sheet -- or nothing at all, when the
  // screen asking is one that does not talk about paper (📖).
  job: PaperJob | null;
  print: PrintOptions;
  // Pressed on a particular empty page. What is chosen lands there and is one
  // page, because that is what an empty page is -- so the runs of dates are
  // not offered here: a monthly is as long as its months, and choosing one
  // from a single empty page would put twelve pages where one was asked for,
  // and leave the empty page where it was. Saying 「末尾に入ります」 in this
  // case is the sheet contradicting the press that opened it.
  positioned?: boolean;
  // Whether a cover is worth offering: there is nowhere for a second one to
  // go, and from an empty page in the middle of the book the answer to
  // 「先頭に入ります」 is that this is not the front.
  cover?: boolean;
  onPick: (kind: SectionKind) => void;
  onClose: () => void;
}) {
  return (
    <Modal title={positioned ? 'このページに入れる' : 'ページを足す'} onClose={onClose}>
      {job && (
        <p className="picker m-0 text-[13px] text-muted">
          {job.spare > 0
            ? `${PAPERS[print.paper].label}の${job.sheets}枚目に、あとリフィル${job.spare}${job.unit}ぶん入ります`
            : `いまちょうど${PAPERS[print.paper].label}${job.sheets}枚です。足すと紙が増えます`}
        </p>
      )}

      {/* A cover goes on the front, which is the only place a cover goes, so
          it is said here rather than left as five presses of ↑. */}
      {cover && (
        <Button variant="quiet" className="addcover justify-start" onClick={() => onPick('cover')}>
          <span className="inline-block h-5 w-[15px] rounded-[2px] border border-line-strong bg-white" />
          表紙
          <em className="not-italic text-muted">白紙1ページ・先頭に入ります</em>
        </Button>
      )}

      {SECTION_MENU.filter(g => !positioned || !g.run).map(group => (
        <span key={group.title} className="flex flex-col gap-1">
          <strong className="text-[13px] font-normal text-muted">{group.title}</strong>
          <span className="fillers grid grid-cols-2 gap-1.5">
            {group.kinds.map(kind => (
              <Button key={kind} variant="quiet" className="justify-start" onClick={() => onPick(kind)}>
                <StampIcon kind={kind as PartKind} />
                {SECTION_LABEL(kind)}
              </Button>
            ))}
          </span>
        </span>
      ))}

      <Button variant="quiet" className="makenew justify-start" onClick={() => onPick('blank')}>
        白紙（自分で作る）
      </Button>
      {onImport && (
        <Button variant="quiet" className="fromfile justify-start" onClick={onImport}>
          <FileGlyph />
          ファイルから取り込む
          <em className="not-italic text-muted">画像・PDF</em>
        </Button>
      )}
      <span className="text-[13px] leading-snug text-muted">
        {positioned
          ? '押した1ページに入ります。カレンダーは何ページにもなるので、「並びを整える」の「＋ 足す」から入れてください'
          : '足したものは最後（裏表紙の前）に入ります。表紙だけは先頭です。順番は ↑↓ で変えられます'}
      </span>
    </Modal>
  );
}
