import type { BackgroundKind, DateWords, RefillSize, SizeSpec } from '../types';
import { SIZES } from '../lib/sizes';

// Not "ja / mix / en" but what each one prints. The name of a parameter tells
// you nothing about what comes out of the printer; the sample is the answer.
export const WORD_SAMPLE: Record<DateWords, string> = {
  ja: '9月 月', mix: '9月 Mon', en: 'Sep Mon',
};

export const cssColor = (c: [number, number, number]) =>
  `rgb(${c.map(v => Math.round(v * 255)).join(',')})`;

export const BACKGROUND_LABEL: Record<BackgroundKind, string> = {
  none: '背景なし', tint: '背景：色', grid: '背景：方眼',
  dot: '背景：ドット', lines: '背景：罫線', image: '背景：画像',
};

// The picker's two groups. Four sizes are what almost everyone has; the rest
// exist and have to be reachable, but putting them in the same run makes the
// first choice harder than it is. Rows inside a group are pairs, and a size
// with no partner leaves the rest of its row empty.
export const SIZE_GROUPS: { title: string; rows: RefillSize[][] }[] = [
  { title: '定番サイズ', rows: [['M5', 'M6'], ['BIBLE', 'A5']] },
  { title: 'そのほかのサイズ', rows: [['MINI3', 'CARD3'], ['M5SQ', 'NARROW'], ['A5SLIM']] },
];

// Pixels per millimetre. One number for all nine, which is the whole trick:
// what lets the eye compare is not the drawing on any one card but the fact
// that every card is the same box and only the paper inside it changes. Two
// numbers, one per group, was worse than the bug it replaced -- A5 slim is
// 210mm and came out shorter than Bible's 170mm, and M5 and M5 square are
// both 105mm tall and were drawn 8px apart. A drawing that contradicts the
// millimetres printed under it is worth less than no drawing.
export const SHEET_SCALE = 0.34;

// Every sheet sits in a box the size of the largest, on every card and on the
// screen after it. That box is the ruler: a sheet filling it is A5, one
// filling a third of it is a third of A5, and that reads without moving the
// eye off the card.
// How far a ring stands out past the paper it grips. Drawn only inside the
// sheet it is a tab, not a ring: what says "ring" is that it goes round the
// edge -- and on a spread, that the one coming off the left page and the one
// off the right page are the same ring, seen between them.
export const ringOut = (size: SizeSpec) => size.ringMarginMm * 0.55;

export const SHEET_SLOT = {
  width: Math.max(...Object.values(SIZES).map(s => s.widthMm + ringOut(s))) * SHEET_SCALE,
  height: Math.max(...Object.values(SIZES).map(s => s.heightMm)) * SHEET_SCALE,
};

// The nine colours of the sizes, each named: コケモモ, マスタード, フィヨルド
// ブルー, ヘザー, スプルース, モス, ティール, ローズ, スレート. Toned down
// and brought to one lightness, the way Nordic textiles carry many colours
// without shouting -- nine full-strength hues side by side were the loudest
// thing in the app. Their places on the wheel are unchanged, with two
// exceptions: M5スクエア was orange, the accent's own colour, and A5スリム
// was a yellow too pale to see on white.
//
// The line is the size's badge -- bars, outlines, rings, the border of the
// chosen card. The fill is the same colour mixed 92% into white, which is to
// say paper: a sheet is white, and a sheet flooded with its own label colour
// stops being paper and becomes a swatch. The colour belongs on the rings,
// where it is the binder holding the paper.
export const SIZE_COLOR: Record<RefillSize, string> = {
  M5: '#B4474C',
  M6: '#C38A2C',
  BIBLE: '#4F86B2',
  A5: '#86679E',
  MINI3: '#4C8A64',
  CARD3: '#879A45',
  M5SQ: '#3B8C92',
  NARROW: '#BC5F80',
  A5SLIM: '#6A7888',
};

// Paper is white. It was drawn in a wash of the size's own colour, which made
// every sheet on the picker a swatch of its label rather than a sheet -- and
// the app prints on white, so a tinted sheet on screen was a promise the
// paper cannot keep. The colour goes on the rings, the outline and the bar,
// where it stands for the binder and the badge rather than the paper.
export const PAPER = '#fff';

// The same colour, dark enough to be read as words on white. A colour can be
// a bar, an outline or a fill at any lightness, but 「6穴」 set in サンイエロー
// is 1.5 times the lightness of the paper behind it and simply is not there;
// ライムグリーン and スカイブルー are not much better. So the label darkens the
// hue until it reads, and nothing else does -- the badge colour stays the
// colour that was chosen. Computed rather than listed, so a new size's colour
// cannot arrive without its readable form.
export const srgb = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

export const luminance = (c: number[]) =>
  0.2126 * srgb(c[0] / 255) + 0.7152 * srgb(c[1] / 255) + 0.0722 * srgb(c[2] / 255);

// 4.5 is where a word stops being a shape: the contrast the WCAG asks of body
// text, and the number this app was failing on every one of its greys and on
// its own orange. Measured against the ground the app is actually drawn on.
export const readable = (hex: string, ratio = 4.5): string => {
  let c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  for (let i = 0; i < 40 && 1.05 / (luminance(c) + 0.05) < ratio; i++) c = c.map(v => v * 0.94);
  return `#${c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
};

export const SIZE_WORD: Record<string, string> = Object.fromEntries(
  Object.entries(SIZE_COLOR).map(([id, c]) => [id, readable(c)]),
);

// One name per size: the one people say. Three of these used to be a code
// with its reading underneath -- M5 over マイクロ5 -- which spent a line of
// the card saying the same size twice and left the reader to work out that
// they were one thing, not two.
export const SIZE_NAME: Record<RefillSize, string> = {
  M5: 'Micro5',
  M6: 'Mini6',
  BIBLE: 'バイブル',
  A5: 'A5',
  MINI3: '縦長ミニ3穴',
  CARD3: '横長ミニ3穴',
  M5SQ: 'M5スクエア',
  NARROW: 'ナロー',
  A5SLIM: 'A5スリム',
};

// Under the name, and on every card. Between them they settle it when the
// name is unfamiliar -- and which binder a sheet fits is the hole count, not
// the millimetres: 縦長ミニ3穴 and Micro5 are both small sheets and will not
// go on each other's rings. Both are read off the size itself, so neither can
// drift from what gets punched.
export const sizeMm = (s: SizeSpec) => `${s.widthMm}×${s.heightMm}mm`;

export const sizeHoles = (s: SizeSpec) => `${s.holes.count}穴`;

// Truncating a Japanese name to 「縦長ミ…」 throws away the one word that
// tells the two three-hole sizes apart, so the wide names shrink instead of
// being cut -- and shrink once more on a 320px phone, where two columns and a
// sheet drawn to scale leave them 60px and they want 62. One pixel off six
// characters buys it; taking it out of the sheet instead would cost every
// size on the screen 6% to fit two names.
//
// Wide, not long: a kana or a kanji is a full em and a Latin letter about
// half, so counting characters says little. 「縦長ミニ3穴」 and 'Micro5' are
// both six characters and one is two thirds wider on screen.
export const emWidth = (name: string) =>
  [...name].reduce((w, c) => w + (/[^\u0020-\u00ff]/.test(c) ? 1 : 0.55), 0);

export const nameSize = (name: string) =>
  (emWidth(name) > 4.5 ? 'text-[13px] min-[360px]:text-[13px]' : 'text-[14px]');

// Selection is the size's own colour, drawn as an outline and a glow around
// the card, and nothing at all inside it. The card was once washed with that
// colour, which took contrast off everything standing on it at the one moment
// it mattered most -- the millimetres fell from 2.11 to 1.8, the colour bar
// from 3.5 to 2.4, and the sheet, being that same colour at full strength,
// was left with nothing but its outline to be seen by. Outside the border the
// colour can be as strong as it likes, because nothing has to be read
// through it.
//
// The border is the only hard edge; everything outside it is blur. A second
// crisp ring around the first read as a stroke rather than as light, so there
// is one soft shadow in the colour and then the card's own, which stays so a
// selected card still sits on the page rather than floating off it.
//
// It was 22px of blur spread 6px wide at 36% -- weather around the card
// rather than a mark on it, and on the picker, where the chosen card sits
// among others, the haze reached them too. Enough to see, not enough to be
// the loudest thing on the screen.
export const CARD_SHADOW = '0 1px 3px rgba(38,36,31,0.07)';

// Chosen has to be visible from arm's length. A 1.5px border in the size's own
// colour is nothing at all on the pale ones -- Bible's blue against white is a
// hairline, and on the recording of a real phone you cannot tell which card is
// picked. A ring outside the border says it in a band three times as wide,
// without moving anything by a pixel.
export const cardSkin = (on: boolean, line: string) =>
  ({
    borderColor: on ? line : 'var(--color-line)',
    background: '#fff',
    boxShadow: on ? `0 0 0 3px ${line}33, ${CARD_SHADOW}` : CARD_SHADOW,
    transition: 'box-shadow 140ms ease-out, border-color 140ms ease-out',
  }) as const;

// The paper is in millimetres and scaled as a whole to fit the box -- that is
// what makes this read as a sheet rather than as a box with dots on it -- but
// the pen that draws it is not. A 0.8mm line is 0.46px wide on M5 and 0.21px
// on A5, so the bigger the sheet the fainter its own outline, and A5 came out
// as a wash with no edge and no visible punch at all. `pen` turns a thickness
// on screen back into millimetres, which gives all nine sheets one line.
// 0.8 was a hairline: on the pale sizes -- Bible's blue, A5 slim's yellow --
// the sheet read as a smudge rather than as a drawn thing. 1.2 is where it
// becomes a line without becoming an icon (1.6 made the outline the subject
// and the paper the gap inside it).
export const OUTLINE_PX = 1.2;

// The ring around a punch does NOT follow the outline up. The hole is about a
// pixel across on the small sizes, and a 1.2px ring on each side of a 1px
// white centre closes it: the holes came out as beads with no hole in them.
// The ring stays thin and the centre is what grew instead.
export const HOLE_RING_PX = 0.9;

// The punch shrinks the same way: 5.5mm on A5 is a 0.7px dot. A hole keeps
// its true size wherever that still reads, and stops shrinking below a dot
// that does -- never past three quarters of the margin it sits in, or it
// would break out through the edge of the paper it is punched in. 1.4, not 1:
// with the outline at 1.2 a 1px hole is smaller than the line beside it, and
// reads as a dot rather than as something the ring passes through.
export const HOLE_MIN_PX = 1.4;
