# RingCraftLab

システム手帳用のリフィルを作って家庭のプリンタで刷るWebアプリ。

## 作業を始める前に

**`docs/要求仕様.md` を読むこと。** 会話履歴ではなくそのファイルが仕様の
正本で、実装と食い違っていたら仕様のほうが正しい。

特に4章「絶対にやってはいけないこと」と10章「技術方針」は、過去に却下
された形と、その理由が書いてある。

## この設計で外してはいけない点

- **パーツはmm座標の図形配列を返す純関数。** 同じ配列を画面のSVGとPDFの
  両方が描く。**印刷経路にCSSを通さない**（画面と紙がズレるため）
- **自由配置ではなく面の分割。** 座標ではなく比率をユーザーに触らせる
- 境界ドラッグがこのアプリ唯一の差別化。壊さない
- **押せるものは `src/ui/` から取る。** JSXに直接ボタンのスタイルを書かない
  （ボタンが揃わなくなるのを構造で防いでいる）。色は `@theme` のトークン

## 確認のしかた

**コードを読んで「直った」と結論しない。実際に動かして見る。**

```bash
npm run build
npx vite preview --port 4173 --strictPort &
CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
  node scripts/shoot.mjs out   # 主要12場面
```

| スクリプト | 何を見るか |
|---|---|
| `shoot.mjs` | 配置・境界ドラッグ・横向きなど主要12場面 |
| `uxcheck.mjs` | ×の数、確認ダイアログ、潰したときに×が消えること |
| `multidrop.mjs` | まとめてドラッグが拒否されないか |
| `printpreview.mjs` | 刷り上がりプレビューと拡大 |
| `pdfcheck.mjs` | PDFを書き出して用紙サイズと中身を見る |
| `uidiff.mjs` | 2つのビルドで同じ要素の座標と大きさを比べる |
| `pixdiff.py` | 2つのスクショ群を突き合わせて、どれがどれだけ動いたか |
| `koyomicheck.mjs` | 六曜と祝日を外部の実装と突き合わせる（暦を触ったとき） |
| `buildfont.mjs` | 印刷用フォントのサブセット再生成（文字を足したとき） |

## 構成

| | |
|---|---|
| `src/App.tsx` | 画面のすべて（3画面＋設定シート＋プレビュー） |
| `src/ui/` | 共通部品。Button / Field / Segmented / Stepper / Sheet / Dialog / Toast |
| `src/styles.css` | Tailwindの読み込み、`@theme` の色、base のみ |
| `src/lib/render/svg.tsx` | mmの図形をSVGに（画面用） |
| `src/lib/astro.ts` | 朔の時刻・太陽黄経・ΔT。六曜と春分秋分の土台 |
| `src/lib/kyureki.ts` | 旧暦と六曜 |
| `src/lib/holidays.ts` | 祝日（法律の条文どおりに計算する。表ではない） |
| `src/lib/**` | **Reactを知らない。** 幾何・パーツ描画・面付け・PDF |
| `scripts/*.mjs` | 検証用。アプリには含まれない |

## 見た目を変えずに直すとき

リファクタのように「見た目は変わらないはず」の変更は、そう思っただけで
済ませない。前後でスクショを撮って突き合わせる。

```bash
# 変更前のコミットを別ポートで建てて、要素の座標を直接比べる
git worktree add /tmp/old <変更前のコミット>
ln -s $PWD/node_modules /tmp/old/node_modules
(cd /tmp/old && npx vite build && npx vite preview --port 4174 &)
node scripts/uidiff.mjs http://localhost:4174 http://localhost:4173
```

Tailwindに移したときは、これで4つのズレが見つかった。preflight の
`line-height: 1.5`、`text-xs`/`text-sm` が持つ行間、`p` の既定マージン、
そして `.note` の衝突。目視では気づけない1〜2pxだった。
