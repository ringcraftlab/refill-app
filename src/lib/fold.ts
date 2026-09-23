import type { SizeSpec } from '../types';

// 蛇腹（アコーディオン）の面の寸法。折った状態がバインダーの1ページで、
// そこから紙が伸びる。面は座標ではなく「何面か」で決まるので、ここは
// 面数と紙から幅を出すだけの純関数でいい。
//
// Reactもimposeも知らない。scripts/*.mts から直接読めるのはそのため。

// A4決め打ち。蛇腹は折って綴じるもので、紙を変えると面の幅が変わる。
// 家庭のプリンタで刷るアプリなので、まずここだけ。
export const FOLD_PAPER = { widthMm: 210, heightMm: 297 };

// 折り畳んだとき、内側の面が1面目の陰に隠れるための余裕。リングの逃げは
// 穴の外縁まで見る。0.5mmは紙で確かめる前提の暫定値で、ここを直せば
// 画面もPDFも検証スクリプトも一緒に動く。
export const FOLD_SLACK_MM = 0.5;

// 面数。4面はやらない -- 折った束が厚くなりすぎ、内側の面が使える幅も
// 残らない。2面と3面が printed refill の実物にある形。
export const FOLD_PANELS = [2, 3] as const;
export type FoldPanels = (typeof FOLD_PANELS)[number];

// リングが紙に食い込む深さ。穴の中心までではなく、穴の外縁まで。
export const ringReachMm = (size: SizeSpec): number =>
  size.ringMarginMm / 2 + size.holes.diameterMm / 2;

// 綴じ辺と直角の向き。面はこちらに伸びる。
export const foldSpanMm = (size: SizeSpec): number =>
  (size.ringsOn ?? 'side') === 'side' ? size.widthMm : size.heightMm;

// 綴じ辺そのものの長さ。帯の幅で、折っても変わらない。
export const bindSpanMm = (size: SizeSpec): number =>
  (size.ringsOn ?? 'side') === 'side' ? size.heightMm : size.widthMm;

// 内側の面がとれる最大幅。これより広いと畳んだときリングに当たる。
export const innerCapMm = (size: SizeSpec): number =>
  foldSpanMm(size) - ringReachMm(size) - FOLD_SLACK_MM;

// 内側の面が1面目に対してこれより狭くなる組み合わせは出さない。狭い面は
// 「もう1ページ」ではなく出っ張りで、折っても使えない。
//
// 線の位置は迷うところがなかった。9サイズ×2面数のうち、この比が0.89を
// 下回るのは A5の3面（74.5/148 = 0.50）ただ1つで、残りは全部0.89以上。
// A5は幅148mmで、3面にすると紙（A4の297mm）が先に尽きて面が半分になる。
export const FOLD_MIN_SHARE = 0.75;

// 折る向き。どちらもリングを避けるが、避け方が違う。
//
//   'out'   折り目が綴じ辺と平行。面は綴じ辺から外へ伸び、内側の面は
//           その向きに短い。帯は長方形。
//   'along' 折り目が綴じ辺と直角。面は綴じ辺に沿って伸び、内側の面は
//           綴じ側をリングぶん削る。帯はL字になる。
//
// 'along' は綴じ辺が短辺のサイズ（＝幅より高さのないリフィル）のための
// 向き。横長ミニ3穴は91×55で綴じ辺が55mm側なので、'out' だと3面で
// 260.5×55mmの細長い帯になる。'along' なら91×164mmで、紙として扱える。
export type FoldGrain = 'out' | 'along';

export interface FoldPlan {
  panels: FoldPanels;
  grain: FoldGrain;
  // 1面目の、折る向きの寸法。ここだけ穴があく。
  headMm: number;
  // 2面目以降の、折る向きの寸法。すべて同じ。
  innerMm: number;
  // 伸ばした帯。alongMm が折る向き、acrossMm がそれと直角。
  alongMm: number;
  acrossMm: number;
  // 'along' のとき、内側の面を綴じ側から削る量。折り返した面が穴の列の
  // 手前で止まるための切り込みで、これがあるから帯はL字になる。
  // 'out' では0。
  insetMm: number;
  // 立てて置いたときの帯の外枠。面付けはこれを並べる。
  sheetWmm: number;
  sheetHmm: number;
  // リングの逃げではなく紙のほうで頭を打ったか。打っていれば内側の面は
  // 上限より狭く、畳むと1面目より引っ込む。
  paperCapped: boolean;
  innerCapMm: number;
}

// 紙に入る最大の帯の長さ。綴じ辺の長さは動かせないので、紙をどちらに
// 向けられるかがそのまま帯の長さの上限になる。
function maxAlongMm(acrossMm: number, paper = FOLD_PAPER): number {
  const long = Math.max(paper.widthMm, paper.heightMm);
  const short = Math.min(paper.widthMm, paper.heightMm);
  return Math.max(
    acrossMm <= long ? short : 0,
    acrossMm <= short ? long : 0,
  );
}

// 折る向きは選ばせない。綴じ辺が短辺のサイズだけ 'along' で、それ以外は
// 'out'。9サイズのうち幅が高さを上回るのは横長ミニ3穴だけなので、実質は
// そのためのもの。選択肢にしないのは、どちらが良いかが紙の形で決まって
// しまっていて、ユーザーに選ばせるところがないため。
export const foldGrainOf = (size: SizeSpec): FoldGrain =>
  foldSpanMm(size) > bindSpanMm(size) ? 'along' : 'out';

// 面は「リングに当たらない最大」を狙い、紙に入らなければそこで頭を打つ。
// 幅を広くとるほど書ける面積は増えるが、面数と紙は動かせないので、
// 削るのは内側の面の寸法だけ。
export function foldPlan(size: SizeSpec, panels: FoldPanels, paper = FOLD_PAPER): FoldPlan | null {
  const grain = foldGrainOf(size);
  const along = grain === 'along';
  // 折る向きに1面目がどれだけあるか。'out' は綴じ辺と直角の寸法、
  // 'along' は綴じ辺そのものの長さ。
  const headMm = along ? bindSpanMm(size) : foldSpanMm(size);
  const acrossMm = along ? foldSpanMm(size) : bindSpanMm(size);
  // 内側の面の上限。'out' はリングの逃げぶん短く、'along' は1面目の陰に
  // 収まればよいので余裕だけ引く（逃げは幅のほうで削る）。
  const cap = along ? headMm - FOLD_SLACK_MM : innerCapMm(size);
  const room = maxAlongMm(acrossMm, paper);
  if (cap <= 0 || room <= headMm) return null;

  const byPaper = (room - headMm) / (panels - 1);
  const innerMm = Math.min(cap, Math.floor(byPaper * 100) / 100);
  if (innerMm < headMm * FOLD_MIN_SHARE) return null;

  const alongMm = headMm + innerMm * (panels - 1);
  return {
    panels, grain, headMm, innerMm, alongMm, acrossMm,
    insetMm: along ? ringReachMm(size) + FOLD_SLACK_MM : 0,
    sheetWmm: along ? acrossMm : alongMm,
    sheetHmm: along ? alongMm : acrossMm,
    paperCapped: byPaper < cap,
    innerCapMm: cap,
  };
}

// 面をパーツで分け合う。1つなら全面、面数と同じ数なら1面ずつ、その間は
// 先のパーツから多めに取る。折り目が動かせない以上、分け方は数で決まる。
export function foldGroups(panels: number, parts: number): [number, number][] {
  const n = Math.max(1, Math.min(parts, panels));
  const base = Math.floor(panels / n);
  const extra = panels % n;
  const out: [number, number][] = [];
  let at = 0;
  for (let i = 0; i < n; i++) {
    const take = base + (i < extra ? 1 : 0);
    out.push([at, at + take - 1]);
    at += take;
  }
  return out;
}

// 各面の、折る向きの開始位置と寸法。先頭だけが綴じ側。
export function foldPanels(plan: FoldPlan): { atMm: number; widthMm: number; head: boolean }[] {
  const out: { atMm: number; widthMm: number; head: boolean }[] = [];
  let at = 0;
  for (let i = 0; i < plan.panels; i++) {
    const widthMm = i === 0 ? plan.headMm : plan.innerMm;
    out.push({ atMm: at, widthMm, head: i === 0 });
    at += widthMm;
  }
  return out;
}
