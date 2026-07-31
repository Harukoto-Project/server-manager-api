# server-manager-api

管理したいUbuntuサーバー1台につき1つ常駐させる「エージェント」プログラムです。デスクトップアプリ **server-manager-client** から接続すると、そのサーバーのCPU/メモリ/ディスク使用状況の確認、サービスの起動・停止、ターミナル操作、システム設定の変更などをリモートで行えるようになります。

- サーバーを何十台も管理している方でも、各サーバーに`server-manager-api`を入れておけば、クライアントアプリの画面上からまとめて操作できます。
- サーバー側での作業はほぼ「導入時の1回だけ」で、以降はクライアントアプリからの操作が中心になります。

## 主な機能

- **監視**: CPU/メモリ/ディスク/ネットワークの使用状況をリアルタイム表示し、過去の推移も記録(SQLiteに保存され、サーバーを再起動しても残ります)
- **サービス管理**: systemdサービス(アプリやミドルウェアなど)の一覧表示、起動・停止・再起動、ログ確認
- **ストレージ**: ディスク使用量やディスクI/Oの状況確認、履歴の記録
- **ネットワーク**: ネットワークインターフェースの状態確認
- **ゲームサーバー管理**: Pterodactylパネルと連携したMinecraft等のゲームサーバー管理
- **プロセスマネージャー**: 登録した自作プロジェクト(Node.js/Pythonなど)の起動・停止・ログ確認
- **Webターミナル**: ブラウザ/クライアントアプリの画面から、SSHでサーバーにログインして操作できる端末機能
- **システム設定**: ホスト名変更、日時設定、ユーザー・グループ管理、SSH鍵管理、ファイアウォール、自動セキュリティ更新など、サーバー管理でよく使う設定項目をまとめて操作可能
- **自己アップデート**: クライアントアプリからの操作で、このAPI自身を最新版に更新できる

## 導入手順

以下はUbuntuサーバー上での作業を想定しています。すべてSSHなどでサーバーにログインした状態で実行してください。

### 1. Node.jsのインストール

Node.js 20以上が必要です。未インストールの場合は以下の例でインストールできます(バージョンは適宜読み替えてください)。

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # v20系であることを確認
```

### 2. リポジトリの取得

任意の設置場所(例: `/opt/server-manager-api`)にリポジトリを取得します。

```bash
sudo git clone https://github.com/Harukoto-Project/server-manager-api.git /opt/server-manager-api
cd /opt/server-manager-api
```

### 3. 依存パッケージのインストールとビルド

```bash
npm install
npm run build
```

### 4. `.env`ファイルの作成

`.env.example`をコピーして`.env`を作成し、必要な項目を編集します(各項目の説明は次の章を参照)。

```bash
cp .env.example .env
nano .env   # 任意のエディタで編集
```

### 5. 動作確認(一時起動)

```bash
npm start
```

`http://サーバーのIPアドレス:8443/health` にアクセス(または`curl`)して、`{"status":"ok", ...}`のような応答が返ってくれば正常に起動しています。確認できたら`Ctrl+C`で停止します。

### 6. systemdサービスとして常時起動させる

サーバー再起動時にも自動で立ち上がるよう、systemdサービスとして登録します。以下の内容で`/etc/systemd/system/server-manager.service`を作成してください。

```ini
[Unit]
Description=Server Manager API
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/server-manager-api
ExecStart=/usr/bin/node /opt/server-manager-api/dist/index.js
Restart=on-failure
User=root

[Install]
WantedBy=multi-user.target
```

> **補足**: Docker操作やシステム設定変更など、root権限が必要な操作を行うため`User=root`としています。運用ポリシーに応じて調整してください。

サービスを有効化して起動します。

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now server-manager.service
sudo systemctl status server-manager.service   # 稼働状況を確認
```

### 7. クライアントアプリからの接続

`server-manager-client`の「ノードを追加」画面で、サーバーのIPアドレス(またはホスト名)・ポート番号(デフォルト`8443`)・アクセストークン(`.env`の`API_ACCESS_TOKEN`、または初回起動時に自動生成されたもの)を入力して接続します。

## `.env`の主要な設定項目

| 項目 | 説明 |
| --- | --- |
| `HOST` | APIが待ち受けるアドレス。通常は`0.0.0.0`のままで問題ありません。 |
| `PORT` | APIが使用するポート番号(デフォルト`8443`)。他のサービスと衝突する場合は変更してください。 |
| `API_ACCESS_TOKEN` | クライアントアプリとの通信に使う合言葉(アクセストークン)。**必ず設定することを推奨**します。空のままにすると初回起動時に自動生成され、ログと`data/access-token.txt`に出力されるので、そこから確認してクライアントに入力してください。 |
| `TERMINAL_SSH_HOST` / `TERMINAL_SSH_PORT` | Webターミナル機能が接続先とするSSHサーバー(通常はこのサーバー自身のsshd)のアドレスとポート。特別な事情がなければデフォルト(`127.0.0.1` / `22`)のままで問題ありません。 |
| `MONITORING_SAMPLE_INTERVAL_MS` / `MONITORING_HISTORY_RETENTION_DAYS` | CPU/メモリ等の監視履歴を記録する間隔(ミリ秒)と、保存しておく日数。 |
| `STORAGE_IO_SAMPLE_INTERVAL_MS` / `STORAGE_IO_HISTORY_RETENTION_DAYS` | ディスクI/O履歴を記録する間隔(ミリ秒)と、保存しておく日数。 |
| `PTERODACTYL_PANEL_URL` / `PTERODACTYL_APPLICATION_API_KEY` / `PTERODACTYL_CLIENT_API_KEY` | ゲームサーバー管理機能を使う場合のみ設定。Pterodactylパネルの管理画面から取得したURLとAPIキーを入力します。使わない場合は空のままで構いません。 |
| `DISCORD_WEBHOOK_URL` | 各種通知をDiscordに送りたい場合に設定します(任意)。 |
| `JWT_SECRET` / `WEBAUTHN_*` | 将来の認証機能強化のために予約されている項目です。現時点では特に設定を意識する必要はありません。 |

## Webターミナル機能を使う場合の注意点

Webターミナルは、このAPIが自分自身のサーバーの`sshd`(SSHサーバー)にログインを試み、その画面をクライアントアプリに中継する仕組みです。そのため、**このサーバー自身へのSSH接続がそもそも許可されている必要があります**。

特に、セキュリティ対策として`/etc/hosts.allow`・`/etc/hosts.deny`(TCP Wrappers)でSSH接続元を制限している場合、`127.0.0.1`(サーバー自身)からの接続が許可されていないと、Webターミナルへのログインが常に失敗します。

例えば`/etc/hosts.deny`に`sshd: ALL`と設定して外部からの接続を絞っている構成では、`/etc/hosts.allow`に以下の1行を追記してください。

```bash
sshd: 127.0.0.1
```

この設定は`sshd`の再起動をしなくても即座に反映されます。ログイン画面で「接続が拒否されました」といったエラーが出る場合は、まずこの設定を確認してください。

## セキュリティに関する注意事項

現在の認証方式は、クライアントとサーバーで同じ「アクセストークン」を共有して確認するだけの簡易的な方式です(将来的にはより強固な認証方式に置き換える予定の、いわば試験運用版の仕組みです)。この方式には以下のような制約があるため、運用にあたってはご注意ください。

- **信頼できるネットワーク内での利用を推奨します。** インターネットに直接公開するのではなく、VPNや社内・自宅ネットワークなど、限られた範囲からのみアクセスできる環境で使うことを想定しています。
- **アクセストークンは第三者に知られないよう管理してください。** トークンを知っていれば誰でもこのAPIを操作できてしまいます(サーバーの再起動、サービスの停止、ファイル操作なども含みます)。
- どうしても外部からアクセスする必要がある場合は、ファイアウォールでのIP制限やVPN経由での接続など、追加の対策を併用することを強く推奨します。
- Webターミナル機能は、あくまでLinuxのユーザー名・パスワードによるログインをそのまま中継するものです。ユーザー名・パスワードはサーバー側のディスクやログに保存されませんが、通信経路の安全性(信頼できるネットワークかどうか)は利用者側で確保する必要があります。

## APIの自己アップデート機能について

クライアントアプリの操作から、このAPI自身を最新版に更新できます。実行すると、サーバー側で以下の処理が自動的に行われます。

1. リポジトリの最新版を取得(`git pull`)
2. 依存パッケージの更新(`npm install`)
3. アプリケーションの再ビルド(`npm run build`)
4. systemdサービスの再起動

更新中にネットワークエラーやビルドエラーが発生した場合はその時点で処理が停止し、結果がクライアントアプリに表示されます。更新前に重要な設定は`.env`ファイルとして別途保管しておくと安心です(このファイルは`git pull`の対象外です)。

## よくあるトラブルシューティング

**クライアントアプリから接続できない**

- サーバー側でサービスが起動しているか確認してください: `sudo systemctl status server-manager.service`
- 設定したポート番号(デフォルト`8443`)がファイアウォールで許可されているか確認してください。UFWを使っている場合の例: `sudo ufw allow 8443/tcp`
- クライアントアプリに入力したアクセストークンが、サーバーの`.env`の`API_ACCESS_TOKEN`(または`data/access-token.txt`に出力された値)と一致しているか確認してください。

**`GET /health`にアクセスしても応答がない**

- サービスが起動していない、またはポート番号が違う可能性があります。`sudo systemctl status server-manager.service`と`.env`の`PORT`を確認してください。

**Webターミナルでログインに失敗する(「接続が拒否されました」等)**

- 上記「Webターミナル機能を使う場合の注意点」を参照し、`/etc/hosts.allow`にサーバー自身(`127.0.0.1`)からの接続を許可する設定を追加してください。
- サーバー自身に`sshd`(SSHサーバー)がインストールされ、起動しているか確認してください: `sudo systemctl status ssh`
- 入力したLinuxのユーザー名・パスワードが正しいか確認してください(このAPIは認証自体をLinux本体に委ねているため、パスワードが間違っている場合はLinux側のログイン失敗として扱われます)。

**ゲームサーバー管理機能が使えない(エラーが返る)**

- `.env`の`PTERODACTYL_PANEL_URL`・`PTERODACTYL_APPLICATION_API_KEY`・`PTERODACTYL_CLIENT_API_KEY`が正しく設定されているか確認してください。この機能はPterodactylパネルの導入が前提です。

**自己アップデートが失敗する**

- サーバーが外部(GitHub)にネットワーク接続できるか確認してください。
- ディスク容量が不足していないか確認してください(`npm install`・ビルド時にまとまった空き容量が必要です)。
- クライアントアプリに表示されるエラー内容(`git pull`/`npm install`/`npm run build`のどの段階で失敗したか)を確認し、該当のコマンドをサーバー上で手動実行してエラー内容を確認してください。

---

## 開発者向け情報

以降は、このAPIのコードを改修・拡張する開発者向けの技術情報です。運用のみを行う場合は読む必要はありません。

### 技術スタック

- Node.js (TypeScript) + Fastify
- WebSocket: `@fastify/websocket`
- Docker操作: `dockerode`
- システム情報: `systeminformation`
- 認証: `@simplewebauthn/server` (パスキー/WebAuthn、現状はスキャフォールドのみ) + JWT セッション
- Pterodactylパネルの Application/Client API 連携(Minecraft/ゲームサーバー管理)

### モジュール構成

`src/modules/<feature>/index.ts` が1つの機能モジュール(Fastifyプラグイン)に対応し、`src/modules/registry.ts` に1エントリ追加するだけで新機能を追加できるテンプレート構成になっている(クライアント側の `ModuleDefinition`/`registry` パターンと対称)。

| モジュール | プレフィックス | 内容 |
| --- | --- | --- |
| health | `/health` | ヘルスチェック(バージョン情報を返す・認証不要) |
| auth | `/auth` | パスキー登録・ログイン・セッション(スキャフォールド、未使用) |
| monitoring | `/monitoring` | CPU/メモリ/ディスク/ネットワークのリアルタイム表示・SQLiteへの履歴記録 |
| docker | `/docker` | コンテナ/イメージ/ボリューム/ネットワーク管理 |
| systemd | `/systemd` | systemdサービス管理・journalログ閲覧 |
| network | `/network` | ネットワークインターフェース/ルーティング/DNS/コネクション閲覧 |
| storage | `/storage` | ファイルシステム/物理ディスク/ブロックデバイス閲覧、ディスクI/Oのリアルタイム表示・SQLiteへの履歴記録 |
| system-settings | `/system-settings` | ホスト名/タイムゾーン、ユーザー・グループ、SSH鍵、ファイアウォール、自動セキュリティ更新等の設定操作(19カテゴリ) |
| game-servers | `/game-servers` | Pterodactyl連携によるMinecraft/ゲームサーバー管理 |
| process-manager | `/process-manager` | Node.js/Pythonプロジェクトのプロセス管理・WebSocketコンソール |
| terminal | `/terminal` | Webターミナル。WebSocket接続後、クライアントから送られたユーザー名/パスワードでノード自身のsshdにSSH接続し、PTYの入出力を中継する |
| update | `/update` | API自身の自己アップデート(`git pull` → `npm install` → `npm run build` → `systemctl restart`) |

### モニタリング/ストレージI/O履歴(SQLite)

`monitoring`・`storage`モジュールは、クライアントの接続有無に関わらずサーバー自身が一定間隔でスナップショットをSQLite(`data/monitoring-history.db` / `data/storage-io-history.db`)に記録し続けており、`GET /monitoring/history` / `GET /storage/io/history`(クエリパラメータ`rangeMinutes`・`maxPoints`)で過去の推移を取得できる。サンプリング間隔・保持日数は`.env`の`MONITORING_SAMPLE_INTERVAL_MS`/`MONITORING_HISTORY_RETENTION_DAYS`、`STORAGE_IO_SAMPLE_INTERVAL_MS`/`STORAGE_IO_HISTORY_RETENTION_DAYS`でそれぞれ設定できる(保持日数を超えた古いサンプルは1時間おきに削除される)。

### 開発時のセットアップ

```bash
npm install
cp .env.example .env
npm run dev
```

### 認証の実装(V1: 暫定アクセストークン)

現在は `/health` を除く全ルートで共有アクセストークンによるBearer認証を要求します(`src/server.ts`)。

- `.env` の `API_ACCESS_TOKEN` を設定するか、未設定のまま起動すると自動生成され、ログと `data/access-token.txt` に出力されます。
- クライアントの「ノードを追加」画面でこのトークンを入力すると、Electronの`safeStorage`で暗号化されて保存されます。
- WebSocket接続はブラウザ側で独自ヘッダーを送れないため、`?token=` クエリパラメータでの認証にも対応しています。

`auth`モジュール(WebAuthn/パスキー)はコードとしては残していますが、まだ上記の暫定トークン認証からは呼び出されていません。将来的にはこちらのモジュールに置き換える予定です。

### Webターミナル(`terminal`モジュール)の実装

`ssh2`クライアントとしてノード自身のsshd(デフォルト`127.0.0.1:22`、`.env`の`TERMINAL_SSH_HOST`/`TERMINAL_SSH_PORT`で変更可)に接続することで、Linuxユーザー名/パスワードによるログイン画面をそのまま実現している。

- クライアントは`/terminal/session`にWebSocket接続後、最初のメッセージとして`{ type: "auth", username, password, cols, rows }`を送る。
- サーバーはその資格情報でsshdへ接続し、認証(PAM等)自体はLinux/sshdに委ねる。成功すると`{ type: "auth-success" }`を返し、以後シェルの出力を`{ type: "data", data }`で継続送信する。失敗時は`{ type: "auth-error", message }`を返して切断する。
- クライアントからの入力は`{ type: "input", data }`、リサイズは`{ type: "resize", cols, rows }`で送る。
- パスワードはメモリ上でssh2に渡すのみで、ディスク・ログ・監査ログのいずれにも保存しない。ログイン成功/失敗/切断のイベントのみ`audit`に記録する(`src/modules/terminal/session.ts`)。
- この認証は共有アクセストークン(V1認証)とは別階層。WebSocket自体への到達には`?token=`が必要で、その上でLinuxユーザー認証を行う2段階構成になる。

### 注意事項(スキャフォールド段階)

- `auth`モジュールはWebAuthnのフロー骨格のみを実装しており、リカバリーコードや予備パスキー登録などNotion設計の全項目は未実装(TODOコメントを参照)。
- Docker/systemd/apt等の操作はUbuntu上でのroot相当権限を前提としている。Windows開発環境ではエラーになる点に注意。
- `game-servers`は環境変数 `PTERODACTYL_PANEL_URL` / `PTERODACTYL_APPLICATION_API_KEY` / `PTERODACTYL_CLIENT_API_KEY` が未設定の場合は502を返す。
- `terminal`はノード自身にsshdが稼働していることが前提。sshdが無効なノードでは常にログインに失敗する。
