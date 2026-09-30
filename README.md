# 読み上げ板（Yomiage Ita）

原稿を大きく表示して自動スクロールするテレプロンプター PWA。**無料・広告なし・ログイン不要・オフライン。** 音声合成ではなく、自分で読むための板です。

## できること

- 原稿を貼り付けて保存（本文のみ IndexedDB）
- 大きな文字、サイズ調整、暗い背景
- 速度スライダーで自動スクロール。画面をタップで一時停止／再開
- 開始前に 3・2・1 のカウントダウン
- 反転モード（鏡越しに読むとき）
- 表示言語：日本語 / English

## English

**Yomiage Ita** is a teleprompter. Paste a script, read it in big type on a dark background, and let it auto-scroll. Adjust size and speed, tap to pause, and optionally mirror the text for a reflection setup. A 3-2-1 countdown plays before scrolling starts. Scripts (text only) stay in IndexedDB on this device. It does not speak the script aloud. Japanese by default, with an English toggle. Free, no ads, no login, offline.

## 開発 / Development

```bash
npm install
npm run dev
npm run build
npm run preview
```

Vite + vanilla TypeScript + vite-plugin-pwa（`registerType: 'autoUpdate'`, `base: './'`）。
