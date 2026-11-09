# ブラウザ内 yt-dlp

yt-dlp を、このブラウザの中で動かす静的ページです。配信の仕方は二つあります。

- 手元の静的サーバ（`python3 -m http.server` など）。中継はありません。通信はブラウザが相手へ直接出します。相手が `Access-Control-Allow-Origin` を返さない応答は読めません。
- Cloudflare Workers。同じ Worker が静的ファイルと、`/proxy?url=` の中継を出します。ページは、中継が応答したときだけ、許可した YouTube 系ホストへの `fetch` をこの中継へ乗せます。jsDelivr や PyPI、MDN のような許可リスト外の通信は、どちらの配信でもブラウザが直接出します。

中継は `Access-Control-Allow-Origin` を付けません。ページと中継が同じオリジンなので、このページからは読めます。別のサイトの JavaScript からは読めません。

## 開き方

`file://` では動きません。モジュールと Pyodide を HTTP で配信してください。

```bash
scripts/fetch-ffmpeg.sh
python3 -m http.server 8766
```

ブラウザで `http://127.0.0.1:8766/` を開きます。このオリジンには `/proxy` が無いので、ページは `fetch` を包みません。YouTube はこれまでどおり CORS で失敗します。MDN の webm は相手が CORS を開けているので、中継なしで mp3 と mp4 の保存まで通ります。このサーバは COOP / COEP を出さないので、`crossOriginIsolated` は false です。変換は単一スレッド版なので、そのままで動きます。

1. URL を入れ、mp4 か mp3 を選んで「実行」を押す。
2. 画面にはチェックポイントだけが出ます。`読み込み pass`、`情報取得 pass`、`ダウンロード pass`、`変換 pass`。失敗した段は `失敗` と出ます。スタックトレースは画面に出さず、ブラウザのコンソールだけです。
3. 変換まで通ったときだけ「保存」が出ます。押すとブラウザのダウンロードになります。

入力は YouTube の単体動画だけを受け付けます（`normalize-url.mjs`）。ホストは `youtube.com` とそのサブドメイン、`youtube-nocookie.com`、`youtubekids.com`、`youtu.be`、`youtube.googleapis.com`。パスは `watch?v=`、`?v=`、`v/`、`e/`、`embed/`、`shorts/`、`live/`、`youtu.be/動画ID`。動画 ID は 11 文字の `[A-Za-z0-9_-]` です。

形は yt-dlp 2026.10.26 の `YoutubeIE._VALID_URL` から採り、そこが併せて受けている第三者ミラー（invidious、pwnyoutube、deturl、hooktube、yourepeat、vid.plus、zwearz、cleanvideosearch）と、裸の動画 ID は外しました。ミラーは YouTube ではなく、中継の許可リストにも入っていません。

https://github.com/yt-dlp/yt-dlp/blob/2026.10.26/yt_dlp/extractor/youtube/_video.py

受けた URL は `https://youtu.be/動画ID` に揃えます。`list`、`start_radio`、`si` などのパラメータは捨て、`t` と `start` が秒だけのときだけ `?t=` として残します。再生リストとして取りに行くのを避けるためです。画面には揃え後の URL を出しません。

それ以外は実行前に止めます。チャンネル、再生リスト、`live/live_stream`、`embed/videoseries`、ユーザー情報やポートの付いた URL、`javascript:`、YouTube に似せた別ドメイン、ほかのサイトは、入力欄の検証メッセージで戻します。yt-dlp にも中継にも渡しません。

Workers で開いているときは、ページが先に `GET /proxy` を見ます。応答ヘッダ `x-yt-relay: 1` があるときだけ `fetch` と `XMLHttpRequest` を包み、許可したホストへの通信を `/proxy?url=` へ変えます。ヘッダが無い（静的サーバの 404 など）ときは包みません。

## 中継

実装は `worker/index.mjs` です。`GET /proxy` に `url` が無いときは上流へ取りに行かず、400 と `x-yt-relay: 1` を返します。ページの検出はこれを使います。

- 宛先は `https` だけです。ポートは 443 だけです。ユーザー情報の付いた URL は拒否します。
- ホストは次のサフィックスと、その本当のサブドメインだけです。`youtube.com`、`youtu.be`、`googlevideo.com`、`ytimg.com`、`youtubei.googleapis.com`。比較の前に末尾のドットを一つ外します。`evil-youtube.com` や `notyoutube.com` や `youtube.com.evil.com` は、ラベルの区切りがドットではないので通りません。IP アドレスも拒否します。
- `Sec-Fetch-Site` が `same-origin` 以外（`cross-site`、`same-site`、`none`）のときは 403 です。よそのページからの利用と、`/proxy?url=` への直接のナビゲーションを止めます。ヘッダを送らないクライアントは通します。ブラウザの外からは偽装できるので、これは踏み台利用の抑止であって認証ではありません。
- 応答には `X-Content-Type-Options: nosniff` と `Content-Security-Policy: sandbox` を付けます。中継は上流の `Content-Type` をそのまま返すので、`text/html` がこのオリジンの文書になる道を閉じます。`*.workers.dev` は公開接尾辞リストに載っていて他のサイトと混ざりませんでしたが、自分のゾーンのサブドメインではそうなりません。
- メソッドは `GET`、`HEAD`、`POST` だけです。`POST` は YouTube の innertube（`/youtubei/v1/...`）用で、本文は 1 MiB までです。それより大きい本文は 413 で、上流へ送りません。
- 上流へ転送するリクエストヘッダは `Accept`、`Accept-Language`、`Content-Type`、`Origin`、`Range`、`Referer`、`User-Agent`、`X-Goog-Visitor-Id`、`X-YouTube-Client-Name`、`X-YouTube-Client-Version` だけです。`Cookie` と `Authorization` は転送しません。ログインセッションは載りません。
- 応答の本文はバッファせず、上流のストリームをそのまま返します。`Set-Cookie` は返しません。`Content-Encoding` が付いているときは、展開後の長さと食い違うので `Content-Length` も外します。
- リダイレクトは Worker の中で追います。各ホップを同じ規則で見て、許可しない宛先へは進みません。最大 5 回です。ブラウザへ 302 を返すと、ブラウザが YouTube へ直接行って CORS で落ちるためです。

yt-dlp 2026.10.26 の web クライアントは `www.youtube.com` の innertube を使います。`youtubei.googleapis.com` は抽出器の `innertube_host` で選ばれることがあるので、サフィックスに入れてあります。動画本体は `googlevideo.com`、画像とプレイヤー周辺の一部は `ytimg.com` です。

この中継は PO Token を作りません。Cookie も渡しません。YouTube がデータセンターの IP を拒否したり、PO Token を要求したりすると、中継があっても取得は失敗します。署名用の JS ランタイム（deno / node）が Pyodide の中で動くかも、ここでは未測定です。

## 実測でできたこと

以下は中継が無い状態で、ブラウザが直接通信した記録です。Chrome 156.0.8078.47（headless）、2026-11-06。事前調査のオリジンは `http://127.0.0.1:8765`、画面の保存とエラー表示のオリジンは `http://127.0.0.1:8766`。

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

いずれも yt-dlp は起動したうえで、ブラウザが応答を拒否した。保存ボタンは出ない。中継は使っていません。

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

Internet Archive は中継の許可リストにありません。Workers で開いても、この失敗は変わりません。

## Workers へのデプロイ

本番の Worker（スクリプト、静的アセット、`workers.dev` サブドメイン）は Terraform が作ります。プロバイダ 5.11.0 から `cloudflare_worker_version` の `assets.directory` が、Wrangler と同じ手順で静的ファイルを上げます。

https://developers.cloudflare.com/changelog/post/2025-10-09-assets-terraform/

そのため main への適用に `wrangler deploy` は入れていません。Terraform と Wrangler の両方で同じ Worker を更新すると、後から走った方がバージョンを上書きします。

`wrangler.toml` は手元の `wrangler dev` と `wrangler deploy --dry-run` 用です。Worker 名、`ASSETS` バインディング、`run_worker_first = true` は Terraform と揃えてあります。静的ファイルも中継も一度 Worker を通ります。Worker が応答へ `Cross-Origin-Opener-Policy: same-origin` と `Cross-Origin-Embedder-Policy: require-corp` を付け、`/proxy` は静的ファイルに隠れません。

https://developers.cloudflare.com/workers/static-assets/binding/

静的ファイルのディレクトリは、どちらも `dist/assets` です。`scripts/stage-assets.sh` が、ページの読み込むファイルだけをそこへコピーします。Terraform プロバイダ 5.28.1 の `assets.directory` は `filepath.WalkDir` でディレクトリを全部歩き、`.assetsignore` を読みません。リポジトリ直下を渡すと `.git` まで上がります。

https://github.com/cloudflare/terraform-provider-cloudflare/blob/v5.28.1/internal/services/worker_version/assets.go

`wrangler dev` と `terraform plan` の前に、次を実行します。

```bash
scripts/stage-assets.sh
```

### カスタムドメインと DNS

`hostname` が空の間、Worker は `workers.dev` だけに出ます。`hostname` にホスト名を、`zone_id` にそのホスト名を持つゾーンの ID を入れると、`cloudflare_workers_custom_domain` がカスタムドメインを作ります。DNS レコードと証明書は Cloudflare が作るので、`cloudflare_dns_record` は置いていません。レコードは Worker を直接指します。

https://developers.cloudflare.com/workers/configuration/routing/custom-domains/

ゾーンは Cloudflare で有効になっていること、そのホスト名に CNAME レコードが残っていないことが要ります。残っていれば先に消します。ワイルドカードは使えません。ホスト名に完全一致したリクエストだけが Worker へ行きます。

`hostname` を空に戻すと、カスタムドメインごと DNS レコードも消えます。`zone_id` は `hostname` を入れたときだけ必須で、変数のバリデーションが抜けを止めます。

このリポジトリでは `hostname` を空のままにしています。カスタムドメインは未検証です。

### state は R2

Terraform の state は Cloudflare R2 を S3 互換バックエンドにして置きます。公式の手順は Remote R2 backend です。

https://developers.cloudflare.com/terraform/advanced-topics/remote-backend/

バックエンドの種類そのものは Terraform の S3 バックエンドです。

https://developer.hashicorp.com/terraform/language/backend/s3

`infra/backend.tf` にはバケット名もエンドポイントもアクセスキーも書いていません。バケット名と `endpoints.s3` は `-backend-config`（例は `infra/backend.hcl.example`）で渡します。アクセスキーは環境変数 `AWS_ACCESS_KEY_ID` と `AWS_SECRET_ACCESS_KEY` です。S3 バックエンドがこの環境変数を読みます。`region = "auto"`、`use_path_style`、`skip_credentials_validation`、`skip_metadata_api_check`、`skip_region_validation`、`skip_requesting_account_id`、`skip_s3_checksum` は、上の Cloudflare の例に合わせています。

バケットはこの Terraform では作りません。state の置き場を、その state を初めて書く設定の中で作ると、最初の `init` が回りません。先にバケットだけ作ります。名前の例は `yt-download-tfstate` です。Remote R2 backend の手順どおり、ダッシュボード、API、または `wrangler r2 bucket create yt-download-tfstate` です。`wrangler r2 bucket create` には R2 を作れる権限が要ります。デプロイ用の Workers トークンとは別です。

バケットロックは付けないでください。ロック規則は上書きと削除を拒みます。state の更新と、ロックファイルの削除が止まります。

https://developers.cloudflare.com/r2/buckets/bucket-locks/

HashiCorp は誤削除からの復旧にバケットのバージョニングを勧めています。R2 の S3 API 互換表では `PutBucketVersioning` は未実装です。このバケットに S3 のバージョニングは設定しません。

https://developers.cloudflare.com/r2/api/s3/api/

### ロック

`use_lockfile = true` です。S3 バックエンドは state のキーに `.tflock` を付けたオブジェクトでロックします。ロックファイルには `s3:GetObject`、`s3:PutObject`、`s3:DeleteObject` が要ります。

https://developer.hashicorp.com/terraform/language/backend/s3#use_lockfile

R2 の `PutObject` は `If-None-Match: *` を、書き込みと同じタイミングで原子的に評価します。既にあるキーへの同時書き込みは、一つだけ成功し、残りは 412 です。create-once のロックが使う操作です。

https://developers.cloudflare.com/r2/api/s3/extensions/

https://developers.cloudflare.com/r2/reference/consistency/

Cloudflare の Remote R2 backend の例には `use_lockfile` がありません。例は 2026-04-21 更新で、アクセスキーをファイルに書いています。このリポジトリはキーをファイルに置かず、ロックだけ足しています。R2 に対して `terraform apply` はしていないので、ロック取得そのものは未検証です。

GitHub Actions の `concurrency` グループ `yt-download-infra` は、このワークフロー同士の重なりを止めます。手元の `terraform apply` と CI が同時に走ることは止めません。そこはロックファイルの役目です。

### 手元での plan / apply

値はコミットしません。`infra/terraform.tfvars.example` と `infra/backend.hcl.example` をコピーして作ります。

```bash
scripts/fetch-ffmpeg.sh
scripts/stage-assets.sh
cd infra
cp terraform.tfvars.example terraform.tfvars
cp backend.hcl.example backend.hcl
export CLOUDFLARE_API_TOKEN
export AWS_ACCESS_KEY_ID
export AWS_SECRET_ACCESS_KEY
terraform init -input=false -backend-config=backend.hcl
terraform plan
terraform apply
```

`CLOUDFLARE_API_TOKEN` はシェルの履歴に残さないでください。`terraform.tfvars` の代わりに `TF_VAR_account_id` でも渡します。`terraform.tfvars.example` と `backend.hcl.example` のアカウント ID は置き場所を示すだけのダミーです。実物はコミットしません。

バックエンドなしの検査は次です。資格情報は要りません。

```bash
terraform fmt -check -recursive
terraform -chdir=infra init -backend=false -input=false
terraform -chdir=infra validate
```

手元の Worker プレビューは、`scripts/fetch-ffmpeg.sh` と `scripts/stage-assets.sh` のあと `npx wrangler dev` です。`npx wrangler deploy --dry-run` は送信せずに、上げるファイルを出します。本番への `wrangler deploy` は、上のとおり Terraform と衝突するので使いません。

`wrangler dev` の上流 `fetch` は、そのマシンの出口 IP から出ます。Cloudflare のエッジ IP ではありません。

## API トークン

Workers 用の Cloudflare API トークンと、R2 の S3 アクセスキーは分けます。

### Workers（`CLOUDFLARE_API_TOKEN`）

この Terraform は Worker を作成し、バージョンと静的アセットを公開し、`workers.dev` を有効にします。破棄すれば Worker を消します。

現行のロールでは、Worker の作成と削除は Workers プロダクトスコープの Admin です。Editor は既存 Worker のデプロイはできますが、作成と削除はできません。プロダクトスコープの Admin が最小です。

https://developers.cloudflare.com/workers/authorization/workers/

`hostname` を空にしておく間は、Zone の Workers Routes Write は要りません。同じ文書が、ルートを変えないデプロイに Workers Routes Write は不要だと書いています。

`hostname` を入れると、カスタムドメインを作るので、そのゾーンに Zone の Workers Routes Write が要ります。同じ文書は、ルートとカスタムドメインの変更には、影響するゾーンごとに絞ったこの権限が要る、と書いています。DNS の権限は付けません。レコードと証明書は、カスタムドメインの作成の中で Cloudflare が作ります。

`/accounts/{account_id}/workers/domains` の Accepted Permissions は `Workers Scripts Write` だけです。プロバイダの `cloudflare_workers_custom_domain` は `Workers Scripts Read` と `Workers Scripts Write` です。Cloudflare のトークンテンプレート `Edit Cloudflare Workers` も、Zone の Workers Routes Write と Account 側の Workers 権限などで、DNS は入っていません。DNS は別のテンプレートです。Zone の DNS Write が要るのは、レコードを自分で足したり消したりする場合です。この Terraform は `cloudflare_dns_record` を持ちません。

https://developers.cloudflare.com/api/resources/workers/subresources/domains/methods/update/

https://developers.cloudflare.com/fundamentals/api/reference/template/

https://registry.terraform.io/providers/cloudflare/cloudflare/latest/docs/resources/workers_custom_domain

Workers Tail Read も付けません。`wrangler tail` は使いません。R2、KV、D1 の権限も付けません。同じ文書の Bindings は、バインディング付き Worker をデプロイするだけなら、束ねた先の権限は要らないと書いています。ここでの `ASSETS` は静的アセットで、R2 ではありません。

トークン作成画面に古い名前だけ出る場合、同じページの Legacy 表では `Workers Scripts Edit` は Editor に相当し、新規作成には足りません。`Workers Platform Admin` は Developer Platform スコープの Admin に相当し、Workers プロダクトの Admin より広いです。画面が新しいロールを出せるなら、広い方ではなく Workers プロダクトの Admin を選びます。

権限名の一覧は API token permissions にあります。`Workers Scripts Edit` は Workers スクリプトへの書き込みです。

https://developers.cloudflare.com/fundamentals/api/reference/permissions/

Terraform リソースが受け付ける権限名は、各リソースの Accepted Permissions に `Workers Scripts Read`、`Workers Scripts Write`、`Workers Tail Read` とあります。デプロイに Tail Read は使いません。

https://registry.terraform.io/providers/cloudflare/cloudflare/latest/docs/resources/worker

https://registry.terraform.io/providers/cloudflare/cloudflare/latest/docs/resources/worker_version

トークンは Cloudflare の API Tokens 画面で作ります。

https://developers.cloudflare.com/fundamentals/api/get-started/create-token/

### R2 の S3 キー（`R2_ACCESS_KEY_ID` と `R2_SECRET_ACCESS_KEY`）

Remote R2 backend の手順で、state バケットだけに絞った R2 API トークンを作り、権限は Object Read & Write にします。Admin Read & Write にはしません。バケットの作成や削除は要らないからです。

https://developers.cloudflare.com/terraform/advanced-topics/remote-backend/

これは Cloudflare API トークンとは別の、R2 の Access Key ID と Secret Access Key です。Account Home の R2、Manage R2 API tokens で作ります。

## GitHub Actions

`.github/workflows/infra.yml` です。

- pull request では、フォークを含め、`terraform fmt -check`、`terraform init -backend=false`、`terraform validate` を資格情報なしで走らせます。
- `terraform plan` は pull request では走らせません。apply の直前、`main` への push でだけ走らせます。pull request から起きるジョブに `CLOUDFLARE_API_TOKEN` も R2 のキーも渡らないので、push 権限のある人が `infra/*.tf` を書き換えて plan の時点でトークンを持ち出す経路がありません。`pull_request_target` も使いません。
- `main` への push だけ `terraform plan -out=tfplan` と `terraform apply tfplan` を走らせます。apply は plan したファイルをそのまま当てます。静的アセットもこの apply に含まれます。`wrangler deploy` は呼びません。
- `TF_STATE_BUCKET` が未設定のうちは plan も apply も走りません。資格情報を入れていないこのリポジトリで、pull request が毎回赤くならないようにしています。変数を入れれば走ります。バケット名の形を見るステップの検査は残してあります。
- `concurrency` は `yt-download-infra` の一つです。`cancel-in-progress` は false なので、走っている apply を次の push が途中で殺しません。
- `permissions` は `contents: read` だけです。pull request にコメントしないので `pull-requests: write` は要りません。

資格情報はワークフローの中に書いていません。

| 名前 | 種類 | 中身 |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | Secret | 上の Workers プロダクト Admin トークン |
| `R2_ACCESS_KEY_ID` | Secret | state バケットに絞った R2 S3 アクセスキーの ID |
| `R2_SECRET_ACCESS_KEY` | Secret | そのシークレット |
| `CLOUDFLARE_ACCOUNT_ID` | Variable | Cloudflare のアカウント ID。`TF_VAR_account_id` と、R2 エンドポイントのホストに使う |
| `TF_STATE_BUCKET` | Variable | state 用 R2 バケット名。例は `yt-download-tfstate` |
| `CLOUDFLARE_ZONE_ID` | Variable | カスタムドメインを置くゾーンの ID。`TF_VAR_zone_id`。未設定なら空 |
| `APP_HOSTNAME` | Variable | カスタムドメインのホスト名。`TF_VAR_hostname`。未設定なら `workers.dev` だけ |

値はコマンドラインに書かず、標準入力で渡します。

```bash
gh secret set CLOUDFLARE_API_TOKEN --repo riiimparm/yt-download
gh secret set R2_ACCESS_KEY_ID --repo riiimparm/yt-download
gh secret set R2_SECRET_ACCESS_KEY --repo riiimparm/yt-download
gh variable set CLOUDFLARE_ACCOUNT_ID --repo riiimparm/yt-download
gh variable set TF_STATE_BUCKET --repo riiimparm/yt-download
gh variable set CLOUDFLARE_ZONE_ID --repo riiimparm/yt-download
gh variable set APP_HOSTNAME --repo riiimparm/yt-download
```

このリポジトリでは、トークンの作成、Secret の登録、`terraform apply`、本番へのデプロイはしていません。

## そのほか

ブラウザ拡張のホスト権限は実装していません。yt-dlp の `--proxy`（HTTP プロキシ）も使いません。ブラウザの `fetch` はそれを通れないため、同じオリジンの URL 中継にしています。

プレイリストの一括取得はしません。応答はブラウザのメモリに載せてから保存します。

## 変換

mp3 への変換と、映像と音声を一つの mp4 にまとめる処理は、ブラウザの中で行います。Worker では変換しません。

使うコアは単一スレッドの `@ffmpeg/core` 0.12.10 です。npm の `license` は `GPL-2.0-or-later` です。配布 wasm には `libmp3lame` と `libx264` と `--enable-gpl` の文字列が入っています。libx264 は GPL、libmp3lame は LGPL なので、この wasm は GPL です。ラッパの `@ffmpeg/ffmpeg` 0.12.15 と、FFmpeg 本体のライセンス説明は次です。

- https://www.npmjs.com/package/@ffmpeg/core/v/0.12.10
- https://github.com/ffmpegwasm/ffmpeg.wasm/blob/main/Dockerfile
- https://github.com/ffmpegwasm/ffmpeg.wasm/blob/main/apps/website/docs/faq.md
- https://www.ffmpeg.org/legal.html

ラッパの ESM（`@ffmpeg/ffmpeg@0.12.15`）は `scripts/fetch-ffmpeg.sh` が npm の tarball から取り、gitignore した `vendor/ffmpeg/` に置きます。`scripts/stage-assets.sh` がそれを `dist/assets/vendor/ffmpeg/` にコピーします。ページは同じオリジンのその `index.js` を読み、そこから同じオリジンの `worker.js` を起動します。

コアの `ffmpeg-core.js` と `ffmpeg-core.wasm`（約 31 MiB）は jsDelivr から取り、blob URL にしてワーカーへ渡します。Workers の静的アセットは 1 ファイル 25 MiB までで、この wasm は載りません。`wrangler dev` は `dist/assets` に置くと `Asset too large` で止まりました。jsDelivr は `Access-Control-Allow-Origin: *` と `Cross-Origin-Resource-Policy: cross-origin` を返します。それでも Chrome は、COEP `require-corp` のページから jsDelivr の `worker.js` を `new Worker` すると `SecurityError` で拒みました。ワーカー本体を同じオリジンにし、コアだけを CORS で読んで blob にすると、この拒否を避けられます。Pyodide のスクリプトは jsDelivr のままです。`crossorigin="anonymous"` を付け、応答の CORS と CORP で通ります。

マルチスレッド版 `@ffmpeg/core-mt` は SharedArrayBuffer が要り、ページが cross-origin isolated である必要があります。Worker は静的ファイルと中継の両方に COOP と COEP を付けます。手元の `python3 -m http.server` はそのヘッダを出せません。単一スレッド版は SharedArrayBuffer を使わないので、どちらの配信でも変換できます。`python3 -m http.server` で変換するときも、先に `scripts/fetch-ffmpeg.sh` を実行します。

Google Fonts は外しました。スタイルシートとフォントファイルは別オリジンの no-cors になり、`require-corp` で落ちるためです。見出しは Iowan Old Style / Yu Mincho、本文は Hiragino Sans / Noto Sans JP です。

Pyodide のスクリプトには `crossorigin="anonymous"` を付けます。これも COEP で no-cors のスクリプトが止まるのを避けるためです。
