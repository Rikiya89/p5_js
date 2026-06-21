# Lissajous Simulator — 開発ログ

## 概要

p5.jsを使ったリサジュー曲線のビジュアルシミュレーター。
公式表示・アニメーション・MP4録画対応。

---

## やり取りの流れ

### 1. 要件定義

- p5.jsでmath visual simulatorを作りたい
- キャンバスサイズとテーマカラーは統一
- キャンバスの上に公式テキスト（font-size 30px）を表示
- キャンバスの下にビジュアルシミュレーターを表示

### 2. パラメトリック曲線を選択

候補から **パラメトリック曲線（Lissajous図形）** を選択。

**数式：**
```
dx/dt = sin(at + δ)
dy/dt = sin(bt)
```

周波数比 `a:b` を 1:1 → 1:2 → 2:3 → 3:4 → 3:5 → 5:6 と自動サイクル。
`δ`（位相差）が 0 → 2π をアニメーション。

---

### 3. 初期実装（`~/.Trash/20260604`）

既存の`sketch.js`にリサジューシミュレーターが実装済みだった。

**構成：**
- キャンバス：1080 × 1920px（9:16縦型）
- 上部680px：公式ゾーン（canvas内に描画）
- 下部1240px：シミュレーター（フォスファートレイル・グロー・グレイン）

---

### 4. DOM分離へのリファクタリング

公式テキストをDOMに移動（`index.html`の`<p>`要素）。

**理由：**
- DOMテキストはCSS `font-size: 30px` で常にシャープ
- canvasテキストはcanvasの縮小率に引きずられてボケる

**実装：**
- `index.html`に`#formula-block`を追加（canvasの上に配置）
- `sketch.js`から`drawFormulaZone()`・`drawDivider()`を削除
- `updateFormulaDOM()`で毎フレームDOM要素を更新（a, b, δ, progressbar, dots）
- `SIM_Y=0`, `SIM_H=H`, `SIM_CY=H/2`に変更してsimがcanvas全体を使用

---

### 5. ERR_ACCESS_DENIED エラー

**エラー：**
```
GET file:///Users/okawa_rikiya/.Trash/20260604/sketch.js net::ERR_ACCESS_DENIED
Uncaught ReferenceError: startRecording is not defined
```

**原因：**
macOSが`~/.Trash`フォルダへのブラウザからのスクリプト読み込みをセキュリティ上ブロックする。
`sketch.js`が実行されないため`startRecording`が未定義になる。

**対処：**
プロジェクトを`~/Desktop/lissajous`にコピーして解決。

---

### 6. 本番プロジェクトの場所を確認

```
/Users/okawa_rikiya/Documents/PracTice/p5js/20260604/
```

ここに`index.html`と`sketch.js`を新規作成。

---

### 7. 公式を録画に含めたい

**問題：**
DOM要素（`#formula-block`）は`VideoFrame(canvasEl)`に含まれない。
canvasのピクセルバッファしか録画されない。

**解決策：**
`drawFormulaZone()`をcanvas描画に戻す（`sketch.js`内で`draw()`から呼ぶ）。

**レイアウト：**
- 上部960px：公式ゾーン（canvas内描画）
- 下部960px：シミュレーター

---

### 8. フォントサイズが小さい問題

**原因：**
canvasは1080pxだがCSSで`width: min(540px, 100vw)`に縮小表示されている。
つまり表示倍率は **0.5倍**。

```
textSize(90) → 画面上では 90 × (540/1080) = 45px
```

DOMの`font-size: 30px`は常に30pxだが、canvasテキストは縮小率に引きずられる。

**対処：**
目標サイズの2倍を指定する。
```
画面上55px → textSize(110)
画面上40px → textSize(80)
```

---

### 9. p5.js `textSize()` が効かない問題

**症状：**
`textSize(88)`を設定しても実際には小さく表示される。

**原因：**
p5.jsの`textFont()`・`textSize()`はフォントの解決タイミングが不安定で、
特にWebフォント（STIX Two Text等）が未ロードの場合にフォールバックのサイズで計算される。

**解決策：**
`drawingContext`（生のCanvas 2D API）を直接使用してフォントを設定する。

```javascript
const ctx = drawingContext;
ctx.font      = `italic 88px "Times New Roman", serif`;
ctx.fillStyle = 'rgba(255,200,60,0.85)';
ctx.textAlign = 'center';
ctx.textBaseline = 'top';
ctx.fillText('δ = ' + delta.toFixed(3) + ' rad', W / 2, dY);
```

p5のラッパーを経由しないので確実にサイズが反映される。

---

## 最終的なファイル構成

```
/Users/okawa_rikiya/Documents/PracTice/p5js/20260604/
├── index.html   # HTML wrapper + controls UI
└── sketch.js    # p5.js メインスケッチ
```

## 技術スタック

| 項目 | 内容 |
|------|------|
| フレームワーク | p5.js 1.9.4 |
| 録画 | WebCodecs API + mp4-muxer |
| キャンバスサイズ | 1080 × 1920px（9:16） |
| FPS | 60fps |
| 最大録画時間 | 30秒 |
| フォント | Times New Roman（drawingContext直接指定） |

## 学んだこと

1. **`~/.Trash`はブラウザからscriptをロードできない** — セキュリティ制限
2. **DOMテキスト vs canvasテキスト** — 録画に含めるにはcanvasで描く必要がある
3. **canvasの論理ピクセルとCSS表示サイズは別物** — `textSize`は論理ピクセルで指定
4. **p5の`textSize()`より`drawingContext.font`が確実** — Webフォント未ロード時の挙動が安定する
