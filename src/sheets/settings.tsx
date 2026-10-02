import { useMemo, useRef, useState } from 'react';
import type { Background, BackgroundKind, Book, DateWords, InkTone, Layout, RuleWeight, SizeSpec } from '../types';
import { buildGeometry, eachOf, photosOf, someEach } from '../lib/layout';
import { BACKGROUND_COLORS } from '../lib/background';
import { paletteOf, RULE_WEIGHT_ORDER, RULE_WEIGHTS, TONE_ORDER, TONES } from '../lib/palette';
import { importPhoto, PHOTO_WARN_BYTES, photoBytes } from '../lib/photo';
import { printedDpi } from '../lib/importfile';
import { sheetCount, sheetLabel } from '../lib/render/pages';
import { Button } from '../ui/Button';
import { Field, Segmented, Stepper } from '../ui/Field';
import { Modal } from '../ui/Overlay';
import { sectionLabel, shortenTo, runText } from '../app/book';
import { WORD_SAMPLE, cssColor } from '../app/look';

// The picture for one photo stamp. The bytes are kept on the surface next to
// the part they belong to, so moving the part moves its picture and taking it
// off takes the picture with it.
// A picture on a run of sheets is two different wishes. One is a band or a
// mark that belongs on every month; the other is this month's photograph, and
// next month's is a different one. Both are real, so the slot says which it is
// -- and the one being looked at is the one being set, because the page on
// screen is the page whose picture this is.
export function PhotoField({ layout, setLayout, size, slot, nth }: {
  layout: Layout; setLayout: (fn: (l: Layout) => Layout) => void; size: SizeSpec;
  slot: number; nth: number;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState('');
  // Which picture has actually finished painting, so the thumbnail can wait
  // for it rather than showing an empty frame.
  const [shown, setShown] = useState('');
  const [failed, setFailed] = useState('');
  const run = sheetCount(layout);
  const mine = layout.surface.photoEach?.[slot] ?? null;
  const src = (mine ? mine[nth] : layout.surface.photos?.[slot]) ?? null;
  const filled = mine ? mine.filter(Boolean).length : 0;
  // The area this stamp actually occupies on the paper, which is what the
  // picture has to be big enough for -- a stamp on a quarter of a Micro5 does
  // not need the pixels a full A5 does.
  const box = useMemo(() => {
    const region = buildGeometry(layout, size).surface.regions[slot];
    return region ? { w: region.w, h: region.h } : { w: size.widthMm, h: size.heightMm };
  }, [layout, size, slot]);

  const set = (next: string | null) => setLayout(l => {
    const runs = eachOf(l.surface);
    if (runs[slot]) {
      const own = [...runs[slot]!];
      own[nth] = next;
      runs[slot] = own;
      return { ...l, surface: { ...l.surface, photoEach: someEach(runs) } };
    }
    const photos = photosOf(l.surface);
    photos[slot] = next;
    return { ...l, surface: { ...l.surface, photos } };
  });

  // Switching does not lose the picture on screen: going per-page keeps it on
  // this page and leaves the rest of the run empty (copying it onto all twelve
  // would be twelve times the bytes to save, for pictures nobody asked for),
  // and coming back keeps the one being looked at.
  const setEach = (on: boolean) => setLayout(l => {
    const runs = eachOf(l.surface);
    const photos = photosOf(l.surface);
    if (on) {
      const own = Array.from({ length: run }, () => null as string | null);
      own[nth] = photos[slot] ?? null;
      runs[slot] = own;
      photos[slot] = null;
    } else {
      photos[slot] = runs[slot]?.[nth] ?? null;
      runs[slot] = null;
    }
    return { ...l, surface: { ...l.surface, photos, photoEach: someEach(runs) } };
  });

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setBusy('読み込み中…');
    setFailed('');
    try {
      set(await importPhoto(f, box));
      setBusy('');
    } catch (e) {
      setBusy('');
      // Said loudly, because the quiet version of this reads as "nothing
      // happened". The usual cause is an iPhone HEIC, which the browser
      // cannot decode at all -- and nothing about the file picker says so.
      setFailed(`${e instanceof Error ? e.message : '読み込めませんでした'}。`
        + 'iPhoneのHEICはブラウザが開けないことがあります。JPEGかPNGでお試しください');
    }
  };

  const bytes = src ? photoBytes(src) : 0;

  return (
    <Field label="写真">
      {run > 1 && (
        <>
          <Segmented
            options={[{ v: 'all', label: '全ページ同じ' }, { v: 'each', label: 'ページごと' }]}
            value={mine ? 'each' : 'all'}
            onPick={v => setEach(v === 'each')}
          />
          <p className="photo-where m-0 text-[13px] leading-snug text-muted">
            {mine
              ? `いま${nth + 1}枚目の写真です（${run}枚中${filled}枚に入っています）`
              : `${run}枚ぜんぶに同じ写真が刷られます`}
          </p>
        </>
      )}
      <input
        ref={file}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => { void pick(e.target.files?.[0]); e.target.value = ''; }}
      />
      <div className="flex items-center gap-2.5">
        <Button variant="quiet" onClick={() => file.current?.click()}>
          {src ? '選び直す' : '写真を選ぶ'}
        </Button>
        {/* A chosen picture is a data URL of a megabyte or so, and the browser
            does not paint it the moment React hands it over -- the first time
            there is nothing cached, so the box sat empty with nothing saying
            why. It says so now, and the picture fades in when it is actually
            there. */}
        {src && (
          <span className="relative block size-12 shrink-0 overflow-hidden rounded-[6px] border border-line-strong bg-bg">
            <img
              key={src}
              src={src}
              alt=""
              onLoad={() => setShown(src)}
              className={`size-full object-cover ${shown === src ? '' : 'opacity-0'}`}
            />
            {shown !== src && <i className="absolute inset-0 animate-pulse bg-line" />}
          </span>
        )}
        {src && <Button variant="quiet" onClick={() => set(null)}>外す</Button>}
      </div>
      {(busy || (src && shown !== src)) && (
        <p className="m-0 text-[13px] text-muted">{busy || '読み込み中…'}</p>
      )}
      {failed && <p className="photo-failed m-0 text-[13px] leading-snug text-danger">{failed}</p>}
      {src ? (
        <p className={`photo-size m-0 text-[13px] ${bytes > PHOTO_WARN_BYTES ? 'text-danger' : 'text-muted'}`}>
          {`${Math.round(bytes / 1024)}KB。刷る大きさ（${Math.round(box.w)}×${Math.round(box.h)}mm）に合わせて縮めてあります`}
          {bytes > PHOTO_WARN_BYTES && '。これより大きいと保存が通らないことがあります'}
        </p>
      ) : (
        <p className="m-0 text-[13px] leading-snug text-muted">
          枠いっぱいに入ります。縦横の比が違うぶんは切り取られるので、
          見せたいところが端にある写真は先に切っておいてください
        </p>
      )}
    </Field>
  );
}

// How the refill is set: the words it prints, and the ink it prints them in.
// One thing decided once for the whole refill, like the background -- if this
// lived in the part sheets, every one of the twelve parts would grow the same
// three rows, which is what makes a settings screen unreadable.
//
// It is deliberately NOT a gear: a gear says "the settings are somewhere in
// here", and everything added later ends up inside it. The chip that opens
// this says what it is set to.
// A taken-in page has one thing to choose: how its picture meets this paper.
export function ImportedSheet({ layout, setLayout, size }: {
  layout: Layout; setLayout: (fn: (l: Layout) => Layout) => void; size: SizeSpec;
}) {
  const im = layout.imported!;
  const paper = { w: size.widthMm, h: size.heightMm };
  const dpi = printedDpi(im, paper, im.fit);
  const shrink = im.wMm && im.hMm ? Math.min(paper.w / im.wMm, paper.h / im.hMm) : null;
  return (
    <>
      <Field label="入れ方">
        <Segmented
          options={[{ v: 'contain', label: '全体を入れる' }, { v: 'cover', label: 'いっぱいに広げる' }]}
          value={im.fit}
          onPick={v => setLayout(l => ({ ...l, imported: { ...l.imported!, fit: v as 'contain' | 'cover' } }))}
        />
      </Field>
      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px] leading-relaxed text-muted">
        <li>{im.file}{im.of > 1 ? `の${im.page}ページ目` : ''}</li>
        {shrink !== null && shrink < 0.95 && <li>元の大きさから約{Math.round(shrink * 100)}%に縮んでいます</li>}
        <li className={dpi < 200 ? 'text-danger' : ''}>刷ったときの細かさ 約{dpi}dpi</li>
      </ul>
    </>
  );
}

export function LookSheet({ layout, setLayout }: {
  layout: Layout; setLayout: (fn: (l: Layout) => Layout) => void;
}) {
  const words = layout.words ?? 'mix';
  const tone = layout.tone ?? 'sepia';
  const weight = layout.ruleWeight ?? 'normal';
  const pal = paletteOf(layout);
  const plain = words === 'mix' && tone === 'sepia' && weight === 'normal' && !layout.hideRokuyo;

  return (
    <>
      <Field label="月と曜日の書き方">
        <Segmented
          options={(['ja', 'mix', 'en'] as DateWords[]).map(v => ({ v, label: WORD_SAMPLE[v] }))}
          value={words}
          onPick={v => setLayout(l => ({ ...l, words: v as DateWords }))}
        />
      </Field>

      <Field label="六曜">
        <Segmented
          options={[{ v: 'show', label: '表示する' }, { v: 'hide', label: '表示しない' }]}
          value={layout.hideRokuyo ? 'hide' : 'show'}
          onPick={v => setLayout(l => ({ ...l, hideRokuyo: v === 'hide' || undefined }))}
        />
      </Field>

      {/* Swatches rather than names: the colour is the thing being chosen, and
          a word for a colour is a worse description of it than the colour. */}
      <Field label="線と文字">
        <div className="tones flex gap-2">
          {TONE_ORDER.map(t => {
            const on = tone === t;
            return (
              <button
                key={t}
                aria-label={TONES[t].label}
                aria-pressed={on}
                onClick={() => setLayout(l => ({ ...l, tone: t as InkTone }))}
                className={`flex flex-1 flex-col items-center gap-1 rounded-[9px] border-2 bg-white py-2 text-[13px] ${
                  on ? 'border-ink' : 'border-line-strong'
                }`}
              >
                <span className="flex items-end gap-[3px]">
                  <i className="block size-3.5 rounded-full" style={{ background: cssColor(TONES[t].ink) }} />
                  <i className="block h-3.5 w-1.5 rounded-sm" style={{ background: cssColor(TONES[t].rule) }} />
                </span>
                <span style={{ color: cssColor(TONES[t].ink) }}>{TONES[t].label}</span>
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="罫線の濃さ">
        <Segmented
          options={RULE_WEIGHT_ORDER.map(v => ({ v, label: RULE_WEIGHTS[v].label }))}
          value={weight}
          onPick={v => setLayout(l => ({ ...l, ruleWeight: v as RuleWeight }))}
        />
      </Field>

      {/* Drawn, not described: a frame rule and three writing rules at the
          weight that is actually set. The difference between うすい and ふつう
          is a fraction of a percent of ink, and no word carries that. */}
      <div className="rules flex flex-col gap-[7px] rounded-[9px] border border-line-strong bg-white px-3 py-3">
        <i className="block h-[2px] rounded-sm" style={{ background: cssColor(pal.rule) }} />
        {[0, 1, 2].map(i => (
          <i key={i} className="block h-px" style={{ background: cssColor(pal.ruleLight) }} />
        ))}
      </div>

      {/* Always there, only unpressable while nothing has been changed: a
          button that appeared with the first change made the sheet taller
          under the finger, and everything in it jumped. */}
      <Button
        variant="quiet"
        className="self-start disabled:opacity-40"
        disabled={plain}
        onClick={() => setLayout(l => ({ ...l, words: undefined, hideRokuyo: undefined, tone: undefined, ruleWeight: undefined }))}
      >
        はじめの書体と色に戻す
      </Button>
    </>
  );
}

// The ground the sheet prints on. Not a part -- it is under all of them, so it
// belongs to the refill rather than to a slot, and it is set from the chip
// above the paper rather than by dropping something.
export function BackgroundSheet({ layout, setLayout, size }: {
  layout: Layout; setLayout: (fn: (l: Layout) => Layout) => void; size: SizeSpec;
}) {
  const bg = layout.background ?? { kind: 'none' as BackgroundKind };
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState('');
  const set = (next: Partial<Background>) =>
    setLayout(l => ({ ...l, background: { ...bg, ...next } as Background }));

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setBusy('読み込み中…');
    try {
      // Sized to the paper it will print on, at print resolution. A phone
      // photo is twenty times that and would fill the browser's whole store
      // on its own.
      const src = await importPhoto(f, { w: size.widthMm, h: size.heightMm });
      set({ kind: 'image', src });
      setBusy('');
    } catch (e) {
      setBusy(e instanceof Error ? e.message : '読み込めませんでした');
    }
  };

  const bytes = bg.src ? photoBytes(bg.src) : 0;

  return (
    <>
      {/* Six choices are one choice, not two: they are laid out on two rows
          because six will not fit across a phone, and exactly one of the six
          is ever lit. The rows do not each carry their own "none". */}
      <Field label="背景の種類">
        <div className="flex flex-col gap-2">
          <Segmented
            options={[{ v: 'none', label: 'なし' }, { v: 'tint', label: '色' }, { v: 'image', label: '画像' }]}
            value={bg.kind}
            onPick={v => set({ kind: v as BackgroundKind })}
          />
          <Segmented
            options={[{ v: 'grid', label: '方眼' }, { v: 'dot', label: 'ドット' }, { v: 'lines', label: '罫線' }]}
            value={bg.kind}
            onPick={v => set({ kind: v as BackgroundKind })}
          />
        </div>
      </Field>

      {bg.kind !== 'none' && bg.kind !== 'image' && (
        <Field label="色">
          <div className="flex gap-2">
            {BACKGROUND_COLORS.map(c => (
              <button
                key={c}
                aria-label={`色 ${c}`}
                aria-pressed={(bg.color ?? BACKGROUND_COLORS[0]) === c}
                onClick={() => set({ color: c })}
                className={`h-9 flex-1 rounded-[9px] border-2 ${
                  (bg.color ?? BACKGROUND_COLORS[0]) === c ? 'border-ink' : 'border-line-strong'
                }`}
                style={{ background: c }}
              />
            ))}
          </div>
        </Field>
      )}

      {bg.kind === 'image' && (
        <Field label="画像">
          <input
            ref={file}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={e => { void pick(e.target.files?.[0]); e.target.value = ''; }}
          />
          <div className="flex items-center gap-2.5">
            <Button variant="quiet" onClick={() => file.current?.click()}>
              {bg.src ? '選び直す' : '写真を選ぶ'}
            </Button>
            {bg.src && (
              <img src={bg.src} alt="" className="h-12 w-12 rounded-[6px] border border-line-strong object-cover" />
            )}
            {bg.src && <Button variant="quiet" onClick={() => set({ src: undefined })}>外す</Button>}
          </div>
          {busy && <p className="m-0 text-[13px] text-muted">{busy}</p>}
          {bg.src && (
            <p className={`photo-size m-0 text-[13px] ${bytes > PHOTO_WARN_BYTES ? 'text-danger' : 'text-muted'}`}>
              {`${Math.round(bytes / 1024)}KB。刷る大きさに合わせて縮めてあります`}
              {bytes > PHOTO_WARN_BYTES && '。これより大きいと保存が通らないことがあります'}
            </p>
          )}
        </Field>
      )}

      {bg.kind !== 'none' && (
        <Field label="濃さ">
          <Stepper
            value={`${Math.round((bg.opacity ?? 1) * 100)}%`}
            onStep={n => set({ opacity: Math.min(1, Math.max(0.1, +((bg.opacity ?? 1) + n * 0.1).toFixed(2))) })}
            canDown={(bg.opacity ?? 1) > 0.1}
            canUp={(bg.opacity ?? 1) < 1}
          />
        </Field>
      )}

      <p className="m-0 text-[13px] leading-snug text-muted">
        紙の端まで刷ります。プリンタが端まで出せないぶんは欠けます
      </p>
    </>
  );
}

// What one place on the printed sheet is, and what can be done about it.
// "Too many weeklies" is noticed while looking at the paper, and the page
// being looked at is the one it should stop at -- so that is the button.
export function PageSheet({ book, at, nth, onShorten, onDrop, onClose }: {
  book: Book;
  at: number;
  nth: number;
  onShorten: (i: number, to: Layout) => void;
  onDrop: (i: number) => void;
  onClose: () => void;
}) {
  const sec = book.sections[at];
  const cut = shortenTo(sec, nth + 1);
  return (
    <Modal title={sectionLabel(sec)} onClose={onClose}>
      <p className="pagewhat m-0 text-[13px] text-muted">
        このページは「{sectionLabel(sec)}」の{nth + 1}枚目・{sheetLabel(sec, nth)}
        （ぜんぶで{runText(sec)}）
      </p>
      {cut ? (
        <Button variant="quiet" className="cuthere" onClick={() => onShorten(at, cut)}>
          ここまでにする（{runText(sec)} → {runText(cut)}）
        </Button>
      ) : (
        <p className="m-0 text-[13px] leading-snug text-muted">
          これが最後の1枚です。短くするなら期間を変えてください
        </p>
      )}
      {book.sections.length > 1 && (
        <Button variant="quiet" className="dropsec" onClick={() => onDrop(at)}>
          このリフィルを外す
        </Button>
      )}
      <span className="text-[13px] leading-snug text-muted">
        日付のあるものは月の単位で短くなります（週の途中では終われないため）
      </span>
    </Modal>
  );
}
