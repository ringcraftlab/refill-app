import { useMemo, useState } from 'react';
import type { Book, Layout, RefillSize } from '../types';
import { SIZES } from '../lib/sizes';
import { placeParts, buildGeometry } from '../lib/layout';
import { buildPages } from '../lib/render/pages';
import { PageSvg } from '../lib/render/svg';
import { listBooks } from '../lib/storage';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Overlay';
import { createLayout, sectionLabel } from '../app/book';
import { LogoMark, SheetGlyph } from '../app/icons';
import { SIZE_GROUPS, SIZE_NAME, SIZE_WORD, sizeMm, sizeHoles } from '../app/look';
import { Thumb } from '../app/bits';

// The first thing anyone sees: what this is, one real spread it made, and the
// way in. Everything said here is something the app does -- the paper is
// drawn by the same code that prints it, the sizes and punches come from the
// table the holes are drawn from.
export function HomeScreen({ onStart, onOpen }: { onStart: () => void; onOpen: (b: Book) => void }) {
  const [opening, setOpening] = useState(false);
  const [tips, setTips] = useState(false);

  // A Mini 6 spread with this month's calendar and a memo beside it, placed
  // the way someone would place them.
  const spread = useMemo(() => {
    const size = SIZES.M6;
    const base: Layout = { ...createLayout(), size: 'M6', spread: true };
    const m = placeParts(base, size, ['monthly'], null)?.layout ?? base;
    const w = buildGeometry(m, size).surface.widthMm;
    const mm = placeParts(m, size, ['memo'], { sx: w * 0.78, sy: 4, band: 0.05 })?.layout ?? m;
    return buildPages(mm, size);
  }, []);
  const saved = useMemo(() => (opening ? listBooks() : []), [opening]);

  const reasons = [
    { t: '面を分けるだけで組める', d: 'パーツを置くと紙が分かれ、境目の仕切りをドラッグすれば広さが変わります。細かいレイアウトの操作はいりません。' },
    { t: 'A4に並べて、両面で刷れる', d: 'リフィルをA4に並べたPDFを作ります。両面印刷のとじ方や、最後の紙に残る空きも数えて知らせます。' },
    { t: '9つのサイズ、規格どおりの穴', d: 'マイクロ5からA5まで。穴は、それぞれのサイズの規格の位置と径で描きます。' },
  ];

  return (
    <div className="homescreen relative mx-auto flex h-full max-w-[680px] flex-col overflow-y-auto bg-bg">
      <div className="flex flex-col gap-6 px-5 pb-8 pt-5">
        <div className="brand flex items-center gap-2.5 text-[13px] font-semibold tracking-[0.22em] text-label">
          <LogoMark className="h-[28px] w-auto" />
          RING CRAFT LAB
        </div>

        <section className="flex flex-col gap-3">
          <span className="self-start rounded-full bg-white px-3 py-1 text-[12px] font-semibold text-accent-text shadow-[0_0_0_1px_var(--color-line)]">
            システム手帳のリフィルづくり
          </span>
          <h1 className="m-0 font-serif text-[24px] font-semibold leading-snug [text-wrap:balance]">
            市販にない理想のリフィルを、<br />手軽に自作・自宅で印刷。
          </h1>
          <p className="m-0 text-[14px] leading-relaxed text-muted">
            パーツを置いて、仕切りで広さを決めるだけ。家庭のプリンタで刷れるPDFまで、スマホひとつで作れます。
          </p>
        </section>

        {/* The paper is the app's own drawing, not an illustration of it. */}
        <figure className="m-0 flex flex-col items-center gap-2 rounded-xl bg-white px-3 pb-3 pt-4 shadow-[0_0_0_1px_var(--color-line)]">
          <span className="flex gap-[2px] drop-shadow-[0_1px_2px_rgba(0,0,0,0.15)]">
            {spread.map((p, i) => <PageSvg key={i} page={p} scale={1.9} />)}
          </span>
          <figcaption className="text-[12px] text-muted">ミニ6の見開き：マンスリーとメモ</figcaption>
        </figure>

        <div className="flex flex-col gap-2">
          <Button variant="cta" className="homestart" onClick={onStart}>リフィル作りをはじめる</Button>
          <p className="m-0 text-center text-[12px] text-muted">無料・登録なし。作ったものはこの端末の中だけに保存されます</p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button variant="quiet" className="homeopen text-left text-ink" onClick={() => setOpening(true)}>
            <span className="block text-[14px] font-semibold">保存したものを開く</span>
            <span className="block text-[12px] text-muted">続きから作る</span>
          </Button>
          <Button variant="quiet" className="hometips text-left text-ink" onClick={() => setTips(true)}>
            <span className="block text-[14px] font-semibold">印刷のコツ</span>
            <span className="block text-[12px] text-muted">両面で失敗しない</span>
          </Button>
        </div>

        <section className="flex flex-col gap-2">
          <h2 className="sect m-0 flex items-center gap-2 text-[15px] font-bold">できること</h2>
          {reasons.map(r => (
            <div key={r.t} className="rounded-xl bg-white px-4 py-3 shadow-[0_0_0_1px_var(--color-line)]">
              <h3 className="m-0 text-[15px] font-semibold">{r.t}</h3>
              <p className="m-0 mt-1 text-[13px] leading-relaxed text-muted">{r.d}</p>
            </div>
          ))}
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="sect m-0 flex items-center gap-2 text-[15px] font-bold">対応サイズ</h2>
          {SIZE_GROUPS.map(g => (
            <div key={g.title} className="flex flex-col gap-1.5">
              <span className="text-[12px] text-muted">{g.title}</span>
              <div className={`grid gap-1.5 ${g.rows.flat().length === 4 ? 'grid-cols-4' : 'grid-cols-3'}`}>
                {g.rows.flat().map((id: RefillSize) => (
                  <div key={id} className="flex flex-col items-center gap-1 rounded-lg bg-white px-1 py-2 text-center shadow-[0_0_0_1px_var(--color-line)]">
                    <SheetGlyph size={SIZES[id]} box={{ w: 22, h: 28 }} />
                    <span className="text-[13px] font-semibold leading-tight">{SIZE_NAME[id]}</span>
                    <span className="text-[11px] leading-tight text-muted tabular-nums">{sizeMm(SIZES[id])}</span>
                    <span className="text-[11px] font-bold leading-tight" style={{ color: SIZE_WORD[id] }}>{sizeHoles(SIZES[id])}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>

        <p className="m-0 text-center text-[11px] text-faint">© RingCraftLab</p>
      </div>

      {opening && (
        <Modal title="保存したリフィル" onClose={() => setOpening(false)}>
          {saved.length === 0
            ? <p className="m-0 text-[14px] text-muted">まだ保存されていません。作ったものは編集画面の「保存」で、この端末に残せます</p>
            : (
              <ul className="m-0 flex max-h-[22rem] list-none flex-col gap-1.5 overflow-y-auto p-0">
                {saved.map(b => (
                  <li key={b.id} className="flex items-center gap-2.5 rounded-[9px] border border-line-strong bg-white p-2">
                    <Thumb layout={b.sections[0]} size={SIZES[b.sections[0].size]} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px]">{b.name}</span>
                      <span className="block truncate text-[13px] text-muted">{b.sections.map(sectionLabel).join(' → ')}</span>
                    </span>
                    <Button variant="quiet" onClick={() => { setOpening(false); onOpen(b); }}>開く</Button>
                  </li>
                ))}
              </ul>
            )}
        </Modal>
      )}

      {tips && (
        <Modal title="印刷のコツ" onClose={() => setTips(false)}>
          <ol className="m-0 flex flex-col gap-2 pl-5 text-[13px] leading-relaxed">
            <li>PDFは<strong>拡大・縮小しないで</strong>印刷します。プリンタの設定の「実際のサイズ」や「100%」を選んでください。用紙に合わせて縮むと、穴の位置がずれます。</li>
            <li>両面印刷は、刷り上がりプレビューに出る<strong>とじ方（長辺とじ・短辺とじ）</strong>に合わせます。A4に並べる向きで決まるので、出たとおりに設定してください。同じことが紙の隅にも刷ってあります。</li>
            <li>刷ったら、リフィルの境目の<strong>切り取り線（点線）</strong>に沿って切り分け、番号の順に重ねます。</li>
            <li>穴は、描いてある穴の位置に合わせて、お使いのサイズのパンチで開けます。</li>
            <li>はじめての紙は、1枚だけ刷って、表と裏の向きを確かめてから全部を刷ると安心です。</li>
          </ol>
        </Modal>
      )}
    </div>
  );
}
