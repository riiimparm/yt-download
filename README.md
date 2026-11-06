# ブラウザ内 yt-dlp

yt-dlp を、このブラウザの中だけで動かす静的ページです。サーバ、バックエンド、CORS プロキシは置いていません。入力した URL をどこかのアプリ用サーバへ送る処理はありません。

通信そのものはブラウザが相手のサイトへ直接出します。相手が `Access-Control-Allow-Origin` を返さない場合、ブラウザが応答を捨てるので yt-dlp は中身を読めません。

## 開き方

`file://` では動きません。モジュールと Pyodide を HTTP で配信してください。

```bash
python3 -m http.server 8766
```

ブラウザで `http://127.0.0.1:8766/` を開きます。

1. URL を入れて「実行」を押す。
2. 初回は jsDelivr から Pyodide 314.0.7、PyPI から `yt-dlp==2026.10.26` を読み込む。
3. ファイルがメモリに載ったときだけ「ファイルを保存」が出る。押すとブラウザのダウンロードになる。

「動作確認用の URL を入れる」は、下の検証で保存まで通った MDN の CC0 動画です。成功のふりはしません。

YouTube の視聴 URL、Shorts、`youtu.be` は、実行前に単体動画の `https://youtu.be/動画ID` へ揃えます。`list`、`start_radio`、`si` などのパラメータは捨てます。`t` と `start` が秒だけのときだけ `?t=` として残します。それ以外の URL はそのままです。入力欄の下に、実際に渡す URL を出します。この揃えは再生リストとして取りに行くのを避けるだけで、YouTube の取得が CORS を通るようにはなりません。

## 実測でできたこと

Chrome 156.0.8078.47（headless）、2026-11-06。事前調査のオリジンは `http://127.0.0.1:8765`、画面の保存とエラー表示のオリジンは `http://127.0.0.1:8766`。

| 段階 | 結果 |
| --- | --- |
| 実行 | Pyodide 314.0.7（Python 3.14.2）が起動し、`can_run_sync()` は `runPythonAsync` の中で True。`WebAssembly.Suspending` もある |
| 依存 | Pyodide 同梱の requests 2.33.1 と urllib3 2.6.3（Emscripten の fetch）経由で yt-dlp が HTTP する |
| 情報抽出 | generic 抽出器が下の webm を `video/webm` と判定。タイトル `flower`、id `flower` |
| ダウンロード | 仮想ファイル `/downloads/flower.webm` に `Download completed`。事前調査では進捗フックが 1024 バイトから 554058 バイトまで出た。画面は完了時に 541.1 KB / 541.1 KB を表示する |
| 保存 | 画面の保存ボタンから Chrome が `flower.webm` を書いた。サイズ 554058。先頭バイト `1a 45 df a3`（WebM / EBML） |

成功した URL:

`https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm`

応答は HTTP 200、`Access-Control-Allow-Origin: *`、`Content-Type: video/webm`、`Content-Length: 554058`。

同期 XHR で `responseType = "arraybuffer"` にすると、ドキュメント上では `InvalidAccessError` になる。このページはその方式を使っていない。

## 実測でできなかったこと

いずれも yt-dlp は起動したうえで、ブラウザが応答を拒否した。保存ボタンは出ない。

### YouTube

`https://www.youtube.com/watch?v=jNQXAC9IVRw`

- 視聴ページ（`&bpctr=9999999999&has_verified=1` 付きで再要求）に `Access-Control-Allow-Origin` がない。コンソールは `net::ERR_FAILED` と CORS 拒否。
- その後の `POST https://www.youtube.com/youtubei/v1/next?prettyPrint=false` は preflight が落ちる。応答に `Access-Control-Allow-Origin` がない。
- 画面のエラー: `ERROR: [youtube] jNQXAC9IVRw: Unable to download API page: ('Connection aborted.', HTTPException('Failed to fetch'))`
- `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=jNQXAC9IVRw&format=json` は、事前調査のオリジン `http://127.0.0.1:8765` をそのまま返した `Access-Control-Allow-Origin` で JSON（タイトル "Me at the zoo"）が読める。yt-dlp の抽出はこの oEmbed だけでは進まない。

### Internet Archive

`https://archive.org/details/BigBuckBunny_328`

- 抽出器は先に `https://archive.org/embed/BigBuckBunny_328` を取る。`Access-Control-Allow-Origin` がなく `Failed to fetch`。
- 画面のエラー: `ERROR: [archive.org] BigBuckBunny_328: Unable to download webpage`
- `https://archive.org/metadata/BigBuckBunny_328` は `Access-Control-Allow-Origin: *` で JSON が読める（約 15 KB）。抽出器は埋め込みページで止まるので、この API には到達しない。
- 動画ファイル `https://archive.org/download/BigBuckBunny_328/BigBuckBunny_512kb.mp4` にも `Access-Control-Allow-Origin` がない。メタデータが取れたとしても、このファイルは同じ理由で読めない。

## 同梱していない回避策

次の二つは、ブラウザの CORS を越えるための既知の道です。このリポジトリには実装していません。

- ブラウザ拡張のホスト権限。拡張のリクエストはページの CORS に縛られない。公開プロジェクト dlPro は、この形で Pyodide 上の yt-dlp を動かしている。
- 利用者が自分のマシンで動かす転送役。ブラウザの `fetch` は yt-dlp の `--proxy`（HTTP プロキシ）を使えない。転送役が応答に `Access-Control-Allow-Origin` を付け、ページがその転送役へ読みに行ける必要がある。公開の第三者プロキシは置いていない。

YouTube の署名用 JS ランタイム（deno / node など）は、今回はページ取得の CORS で止まっているため未到達です。CORS を越えても、そこで別の失敗があり得ます。ここまでは測っていません。

ffmpeg はありません。映像と音声の結合や再エンコードはしません。プレイリストの一括取得もしません。応答はブラウザのメモリに載せてから保存します。
