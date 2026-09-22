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

export interface FoldPlan {
  panels: FoldPanels;
  // 1面目の幅。リフィルそのものの寸法で、ここだけ穴があく。
  headMm: number;
  // 2面目以降の幅。すべて同じ。
  innerMm: number;
  // 伸ばした帯。alongMm が折る向き、acrossMm が綴じ辺の向き。
  alongMm: number;
  acrossMm: number;
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

// 面は「リングに当たらない最大」を狙い、紙に入らなければそこで頭を打つ。
// 幅を広くとるほど書ける面積は増えるが、面数と紙は動かせないので、
// 削るのは内側の面の幅だけ。
export function foldPlan(size: SizeSpec, panels: FoldPanels, paper = FOLD_PAPER): FoldPlan | null {
  const headMm = foldSpanMm(size);
  const acrossMm = bindSpanMm(size);
  const cap = innerCapMm(size);
  const room = maxAlongMm(acrossMm, paper);
  if (cap <= 0 || room <= headMm) return null;

  const byPaper = (room - headMm) / (panels - 1);
  const innerMm = Math.min(cap, Math.floor(byPaper * 100) / 100);
  // 面が1面目の半分も残らないなら、それは蛇腹として使える形ではない。
  if (innerMm < headMm * 0.5) return null;

  return {
    panels, headMm, innerMm,
    alongMm: headMm + innerMm * (panels - 1),
    acrossMm,
    paperCapped: byPaper < cap,
    innerCapMm: cap,
  };
}

// 各面の左端（折る向きの座標）と幅。先頭だけが綴じ側。
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
