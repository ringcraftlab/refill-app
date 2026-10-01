// ファイルから取り込む（段1：画像と、画像だけのPDF）。
//
// 写真の取り込み（photo.ts）と同じく、ブラウザの canvas と Image を使うので
// DOM を知っている。描画のライブラリからは呼ばない。ファイルは端末の中で
// 読むだけで、どこにも送らない。
//
// 読んだものは「1ページ＝1枚の絵」にして返す。線と文字でできたPDFの
// ページは、ここではまだ読まない（段5。仕様「ファイルから取り込む」）。

const MM_PER_INCH = 25.4;
const PT_PER_MM = 72 / MM_PER_INCH;
// 刷るのに要る細かさ。写真と同じ300dpi。
const PRINT_DPI = 300;
// A5全面を300dpiで持つと 1748×2480。それより大きい絵は捨てても見えない。
const MAX_SIDE_PX = 2600;

export interface ImportPage {
  // 刷る大きさまで縮めた JPEG の data URL。
  src: string;
  // 縮める前の画素。刷ったときの細かさは、これと紙の上の大きさで決まる。
  pxW: number;
  pxH: number;
  // 元のページの大きさ。PDFなら分かる。画像には大きさがない。
  wMm?: number;
  hMm?: number;
  // Which page of a spread it was drawn as, read from the margins: a left
  // page leaves its right side free for the punch, a right page its left.
  side?: 'L' | 'R';
}

export interface ImportRead {
  name: string;
  kind: 'image' | 'pdf';
  pages: ImportPage[];
  // 読めなかったページの数（線と文字のPDFのページ）。
  skipped: number;
}

export const IMPORT_ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf,.pdf';

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('読めない画像です')); };
    img.src = url;
  });
}

// どちら側を穴のために空けてあるか。左右の端から、何も描いていない列が
// どれだけ続くかを比べる。差が紙の幅の3%に満たなければ、どちらでもない。
function sideOf(ctx: CanvasRenderingContext2D, w: number, h: number): 'L' | 'R' | undefined {
  const { data } = ctx.getImageData(0, 0, w, h);
  const step = Math.max(1, Math.floor(h / 400));
  const inked = (x: number) => {
    for (let y = 0; y < h; y += step) {
      const i = (y * w + x) * 4;
      if (data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11 < 235) return true;
    }
    return false;
  };
  let left = 0;
  while (left < w && !inked(left)) left++;
  let right = 0;
  while (right < w - left && !inked(w - 1 - right)) right++;
  if (left >= w) return undefined;
  const d = (right - left) / w;
  return d > 0.03 ? 'L' : d < -0.03 ? 'R' : undefined;
}

// 紙（`mm`）をはみ出すほど広げても足りる画素まで縮める。全体を入れるか
// いっぱいに広げるかは後から変えられるので、広げるほうに合わせておく。
async function shrink(blob: Blob, mm: { w: number; h: number }): Promise<ImportPage> {
  const img = await loadImage(blob);
  const px = (v: number) => (v / MM_PER_INCH) * PRINT_DPI;
  const want = Math.max(px(mm.w) / img.naturalWidth, px(mm.h) / img.naturalHeight);
  const cap = MAX_SIDE_PX / Math.max(img.naturalWidth, img.naturalHeight);
  const k = Math.min(1, want, cap);
  const w = Math.max(1, Math.round(img.naturalWidth * k));
  const h = Math.max(1, Math.round(img.naturalHeight * k));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('画像を縮められません');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return { src: canvas.toDataURL('image/jpeg', 0.86), pxW: img.naturalWidth, pxH: img.naturalHeight, side: sideOf(ctx, w, h) };
}

// 画像だけのPDF：各ページに JPEG が1枚だけ貼ってあるもの。Photoshop や
// スキャナが書き出す形で、配布されているリフィルにも多い。それ以外の
// ページ（線と文字、PNGのような生の画素）はまだ読まない。
async function readPdf(file: File, mm: { w: number; h: number }): Promise<ImportRead> {
  const { PDFDocument, PDFName, PDFRawStream } = await import('pdf-lib');
  const doc = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
  const pages: ImportPage[] = [];
  let skipped = 0;
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    const xobjects = page.node.Resources()?.lookup(PDFName.of('XObject'));
    // An empty font list is what some writers leave on every page; only a
    // page that names a font has text on it.
    const fontDict = page.node.Resources()?.lookup(PDFName.of('Font'));
    const fonts = fontDict && 'keys' in fontDict && (fontDict as { keys(): unknown[] }).keys().length > 0;
    const images: Uint8Array[] = [];
    if (xobjects && 'entries' in xobjects) {
      for (const [, ref] of (xobjects as { entries(): [unknown, unknown][] }).entries()) {
        const obj = doc.context.lookup(ref as never);
        if (!(obj instanceof PDFRawStream)) continue;
        const subtype = obj.dict.get(PDFName.of('Subtype'))?.toString();
        const filter = obj.dict.get(PDFName.of('Filter'))?.toString();
        if (subtype === '/Image' && filter === '/DCTDecode') images.push(obj.contents);
      }
    }
    if (images.length !== 1 || fonts) { skipped++; continue; }
    const read = await shrink(new Blob([images[0] as BlobPart], { type: 'image/jpeg' }), mm);
    pages.push({ ...read, wMm: width / PT_PER_MM, hMm: height / PT_PER_MM });
  }
  return { name: file.name, kind: 'pdf', pages, skipped };
}

// `mm` は取り込み先の紙の大きさ。そこに刷るのに要る画素まで縮める。
export async function readImportFile(file: File, mm: { w: number; h: number }): Promise<ImportRead> {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (isPdf) return readPdf(file, mm);
  const page = await shrink(file, mm);
  return { name: file.name, kind: 'image', pages: [page], skipped: 0 };
}

// 刷ったときの細かさ。紙の上で絵が占める幅と、元の画素から。
export function printedDpi(page: ImportPage, paper: { w: number; h: number }, fit: 'contain' | 'cover'): number {
  const k = fit === 'contain'
    ? Math.min(paper.w / page.pxW, paper.h / page.pxH)
    : Math.max(paper.w / page.pxW, paper.h / page.pxH);
  // k は 1画素あたりの mm。
  return Math.round(MM_PER_INCH / k);
}
