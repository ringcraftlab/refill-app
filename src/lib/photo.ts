// 取り込んだ写真を、刷る寸法まで縮めてデータURLにする。
//
// 縮めるのは容量のため。レイアウトは localStorage に入るので、元の写真を
// そのまま持つと1枚で保存が埋まる。刷る大きさ以上の画素は紙の上では
// 見えないので、捨てても失うものがない。
//
// ブラウザの canvas を使うので、ここだけは DOM を知っている。描画の
// ライブラリ（draw / parts / background）からは呼ばない。

// 紙に出す解像度。300dpiより上は家庭のプリンタでは差が出ない。
export const PRINT_DPI = 300;
// それでも大きすぎるときの上限。A5全面でも1800pxあれば足りる。
export const MAX_SIDE_PX = 1800;
// これを超えたら、保存が通らない可能性を画面に出す。
export const PHOTO_WARN_BYTES = 1_200_000;

const MM_PER_INCH = 25.4;

// data URL のおおよそのバイト数。base64は4/3になる。
export const photoBytes = (src: string): number =>
  Math.round((src.length - (src.indexOf(',') + 1)) * 0.75);

function load(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('読めない画像です')); };
    img.src = url;
  });
}

// `mm` は紙の上でこの写真が占める大きさ。そこを埋めるのに要る画素まで
// 縮める。元より大きくはしない——引き伸ばしても情報は増えない。
export async function importPhoto(file: File, mm: { w: number; h: number }): Promise<string> {
  const img = await load(file);
  const px = (v: number) => (v / MM_PER_INCH) * PRINT_DPI;
  const target = { w: Math.min(px(mm.w), MAX_SIDE_PX), h: Math.min(px(mm.h), MAX_SIDE_PX) };
  // 枠は切り取って埋める（fit: cover）ので、短いほうが足りる倍率で足りる。
  const k = Math.min(1, Math.max(target.w / img.naturalWidth, target.h / img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * k));
  const h = Math.max(1, Math.round(img.naturalHeight * k));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('画像を縮められません');
  // 透過は白で埋める。JPEGは透過を持てないし、紙は白い。
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', 0.82);
}
