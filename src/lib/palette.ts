// 紙に乗るインクの色。リフィル全体で1つ。
//
// パーツはこの表から色を受け取る。定数を直に読まないのは、体裁を変えたとき
// 画面のSVGとPDFが同じ色で描かれる必要があるため——どちらも同じ図形配列を
// 描くので、色がここ1か所で決まっていれば、ズレようがない。
//
// **土日祝の色は表に含めない。** 日曜が赤・土曜が青なのは色の好みではなく
// 約束事で、色みを変えたら「休みの日」という意味そのものが消える。
import type { Color } from './draw';
import { INK, INK_FAINT, INK_SOFT, RULE, RULE_LIGHT, SATURDAY, SUNDAY } from './draw';
import type { InkTone, RuleWeight } from '../types';

export interface Palette {
  ink: Color;
  inkSoft: Color;
  inkFaint: Color;
  rule: Color;
  ruleLight: Color;
  // 表には入っているが、体裁では変わらない。パーツが1か所から色を取れる
  // ようにするためだけに置いてある。
  sunday: Color;
  saturday: Color;
}

interface Tone {
  label: string;
  ink: Color;
  inkSoft: Color;
  inkFaint: Color;
  rule: Color;
  ruleLight: Color;
}

// セピアは今まで刷ってきた色そのもの。既定を変えると、同じレイアウトを
// 読み込んだ人の紙が黙って変わる。
export const TONES: Record<InkTone, Tone> = {
  sepia: {
    label: 'セピア',
    ink: INK, inkSoft: INK_SOFT, inkFaint: INK_FAINT, rule: RULE, ruleLight: RULE_LIGHT,
  },
  grey: {
    label: 'グレー',
    ink: [0.208, 0.208, 0.216],
    inkSoft: [0.420, 0.420, 0.435],
    inkFaint: [0.604, 0.604, 0.620],
    rule: [0.871, 0.871, 0.882],
    ruleLight: [0.925, 0.925, 0.933],
  },
  indigo: {
    label: '藍',
    ink: [0.161, 0.200, 0.290],
    inkSoft: [0.341, 0.388, 0.486],
    inkFaint: [0.553, 0.592, 0.667],
    rule: [0.839, 0.859, 0.898],
    ruleLight: [0.902, 0.918, 0.949],
  },
  green: {
    label: '若草',
    ink: [0.180, 0.239, 0.192],
    inkSoft: [0.361, 0.427, 0.365],
    inkFaint: [0.569, 0.616, 0.561],
    rule: [0.847, 0.878, 0.839],
    ruleLight: [0.910, 0.929, 0.902],
  },
};

export const TONE_ORDER: InkTone[] = ['sepia', 'grey', 'indigo', 'green'];

// 白からの距離を伸び縮みさせる。1を超えると濃く、下回ると薄くなる。
// 色みは変えずにインクの量だけを変えたいので、白へ寄せる／離す形にする。
const weigh = (c: Color, k: number): Color =>
  c.map(v => Math.min(1, Math.max(0, 1 - (1 - v) * k))) as Color;

export const RULE_WEIGHTS: Record<RuleWeight, { label: string; k: number }> = {
  // 家庭のインクジェットだと、これより薄くすると刷るたびに出たり出なかったり
  // する。0.6はその手前。
  light: { label: 'うすい', k: 0.6 },
  normal: { label: 'ふつう', k: 1 },
  dark: { label: 'こい', k: 1.7 },
};

export const RULE_WEIGHT_ORDER: RuleWeight[] = ['light', 'normal', 'dark'];

// 省略された体裁は、これまで刷ってきた色。保存済みのレイアウトが全部そう。
export function paletteOf(
  layout: { tone?: InkTone; ruleWeight?: RuleWeight } = {},
): Palette {
  const tone = TONES[layout.tone ?? 'sepia'];
  const k = RULE_WEIGHTS[layout.ruleWeight ?? 'normal'].k;
  return {
    ink: tone.ink,
    inkSoft: tone.inkSoft,
    inkFaint: tone.inkFaint,
    rule: weigh(tone.rule, k),
    ruleLight: weigh(tone.ruleLight, k),
    sunday: SUNDAY,
    saturday: SATURDAY,
  };
}
