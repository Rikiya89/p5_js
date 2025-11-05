# p5.js へようこそ

p5.js ライブラリ一式の ZIP ファイルをダウンロードしていただきありがとうございます！

# p5 フォルダの内容

* p5.js ファイル
* p5.min.js ファイル
* addons フォルダ
  * p5.sound.js
  * p5.sound.min.js
* empty-example フォルダ
  * index.html
  * p5.js
  * p5.sound.js
  * sketch.js

## p5.js

このファイルには完全な p5.js ライブラリが含まれます。人間にも読みやすい構成なので、内容を自由に閲覧できます。一般的なミスをサポートする親切なエラー表示も備えています。

## p5.min.js

このファイルは p5.js を縮小（ミニファイ）したバージョンです。同じ機能をより小さなファイルサイズで提供しますが、人間には読みづらく、親切なエラー表示は含まれません。

## addons フォルダ

addons フォルダには p5.js 関連の追加ライブラリが、オリジナル版と縮小版の両方で収録されています。

### p5.sound.js, p5.sound.min.js

p5.sound は音声入力・再生・解析・合成などの Web Audio 機能を p5.js に追加します。

## empty-example フォルダ

empty-example はウェブサイトの空テンプレートです。フォルダにはウェブサイト用の index.html、p5.js ライブラリ、その他の関連ライブラリ、そしてコードを書き始めるためのテンプレート `sketch.js` が含まれています。

### index.html

index.html は HTML ファイルのテンプレートです。このファイルではフォルダ内のライブラリ（p5.js、p5.sound.js）を読み込んだ後、`sketch.js` を実行して自分のコードを動かします。

### sketch.js

sketch.js は p5.js スケッチのテンプレートです。`setup()` と `draw()` 関数の骨組みが用意されており、自由に書き加えることができます。

## README.txt

この README は Markdown 形式で記述されています。

# 次のステップ

より詳しい情報が必要な場合は、公式サイトをご覧ください。  
https://p5js.org/tutorials/get-started/ および https://p5js.org/tutorials/

p5.js ライブラリのオンラインリファレンスはこちらです。  
https://p5js.org/reference/

empty-example を含むウェブサイトを動かすには、ローカルサーバーを有効にする必要があります。こちらのチュートリアルをご参照ください。  
https://github.com/processing/p5.js/wiki/Local-server

p5.js はコミュニティによって作られ、支えられています。私たちについてもっと知りたい場合は、以下をご覧ください。  
https://p5js.org/community/

# ライセンス

p5.js ライブラリはフリーソフトウェアです。フリーソフトウェア財団が定める GNU Lesser General Public License（バージョン 2.1）のもとで再配布および改変することができます。
