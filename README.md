# RingCraftLab

システム手帳リフィルをブラウザ上で作成・PDF出力できるWebアプリケーション（MVP）。

## 技術スタック

- Vite + React + TypeScript
- pdf-lib（クライアント側で原寸PDF生成）
- localStorage（レイアウト保存）

Next.js を使わない構成の理由・移行方針は開発時のディスカッションを参照。

## セットアップ

```bash
npm install
npm run dev
```

## MVP実装範囲

- **M6ハビットトラッカー**：日付・曜日自動生成、月またぎ対応（開始日と日数を指定し、月初は黒縦線でマーカー表示）
- **M5マンスリーカレンダー**：見開き2ページ対応（左：月火水／右：木金土日、`spread` ON時）
- **PDF出力**：pdf-lib で mm 単位のページサイズを厳密指定。原寸保証。
- **レイアウト保存・再利用**：localStorage にバージョン付きJSONで保存

## アーキテクチャ

パーツは「描画プラン（mm座標の Primitive 配列）」を返す純関数として実装。
プレビュー用 SVG レンダラと PDF エクスポータが同じプランを消費するため、
画面と印刷が構造的に一致します。

```
src/
  App.tsx                    エディタ画面
  types.ts                   Layout / Part スキーマ（version: 1）
  lib/
    sizes.ts                 リフィル寸法
    dates.ts                 曜日・カレンダー生成
    draw.ts                  描画プリミティブ定義
    parts/
      habitTracker.ts        M6 ハビット
      monthlyCalendar.ts     マンスリー（見開き対応）
      rings.ts               リング・穴ガイド
    render/
      svg.tsx                SVG プレビュー
      pdf.ts                 pdf-lib エクスポート
    storage.ts               保存/読込/移行
```

## 既知の制限（MVPスコープ外・詳細設計フェーズで対応）

- PDF内フォントが Helvetica のため、日本語文字（習慣名等）は現状 PDF に反映されません。`@pdf-lib/fontkit` + Noto Sans JP サブセットで対応予定。
- リング穴位置・穴径は近似値。要件書「6.未確定事項」の各サイズ数値表を作成し次第、`lib/parts/rings.ts` を差し替え。
- ドラッグでの位置調整、両面編集、背景ガイドレイヤーは未実装。
- オフライン対応（Service Worker/PWA）は未組込み。
- 祝日・六曜表示は未実装。

## データ互換性

`Layout.version` を `SCHEMA_VERSION` (現在 1) で保存。将来スキーマを変更した際は
`lib/storage.ts` の `migrate()` に旧→新の変換を追加してください。
