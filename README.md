# server-manager-api

Harukoto Project Server Manager のノードエージェント(バックエンド)。各Ubuntuサーバーに個別常駐し、REST + WebSocketでAPIを提供する。設計の全体像は Notion の [Ubuntuサーバー管理ダッシュボード 機能計画](https://app.notion.com/p/3ae8a2263d6881d69879fc449a20f8be) を参照。

## 技術スタック

- Node.js (TypeScript) + Fastify
- WebSocket: `@fastify/websocket`
- Docker操作: `dockerode`
- システム情報: `systeminformation`
- 認証: `@simplewebauthn/server` (パスキー/WebAuthn) + JWT セッション
- Pterodactylパネルの Application/Client API 連携(Minecraft/ゲームサーバー管理)

## モジュール構成

`src/modules/<feature>/index.ts` が1つの機能モジュール(Fastifyプラグイン)に対応し、`src/modules/registry.ts` に1エントリ追加するだけで新機能を追加できるテンプレート構成になっている(クライアント側の `ModuleDefinition`/`registry` パターンと対称)。

| モジュール | プレフィックス | 内容 |
| --- | --- | --- |
| health | `/health` | ヘルスチェック |
| auth | `/auth` | パスキー登録・ログイン・セッション(スキャフォールド) |
| monitoring | `/monitoring` | CPU/メモリ/ディスク/ネットワークのリアルタイム表示・SQLiteへの履歴記録 |
| docker | `/docker` | コンテナ/イメージ/ボリューム/ネットワーク管理 |
| systemd | `/systemd` | systemdサービス管理・journalログ閲覧 |
| network | `/network` | ネットワークインターフェース/ルーティング/DNS/コネクション閲覧 |
| storage | `/storage` | ファイルシステム/物理ディスク/ブロックデバイス閲覧、ディスクI/Oのリアルタイム表示・SQLiteへの履歴記録 |
| system-settings | `/system-settings` | apt更新・UFW・ホスト名/タイムゾーン等 |
| game-servers | `/game-servers` | Pterodactyl連携によるMinecraft/ゲームサーバー管理 |
| process-manager | `/process-manager` | Node.js/Pythonプロジェクトのプロセス管理・WebSocketコンソール |
| terminal | `/terminal` | Webターミナル。WebSocket接続後、クライアントから送られたユーザー名/パスワードでノード自身のsshdにSSH接続し、PTYの入出力を中継する |

## モニタリング/ストレージI/O履歴(SQLite)

`monitoring`・`storage`モジュールは、クライアントの接続有無に関わらずサーバー自身が一定間隔でスナップショットをSQLite(`data/monitoring-history.db` / `data/storage-io-history.db`)に記録し続けており、`GET /monitoring/history` / `GET /storage/io/history`(クエリパラメータ`rangeMinutes`・`maxPoints`)で過去の推移を取得できる。サンプリング間隔・保持日数は`.env`の`MONITORING_SAMPLE_INTERVAL_MS`/`MONITORING_HISTORY_RETENTION_DAYS`、`STORAGE_IO_SAMPLE_INTERVAL_MS`/`STORAGE_IO_HISTORY_RETENTION_DAYS`でそれぞれ設定できる(保持日数を超えた古いサンプルは1時間おきに削除される)。

## セットアップ

```bash
npm install
cp .env.example .env
npm run dev
```

## 認証(V1: 暫定アクセストークン)

現在は `/health` を除く全ルートで共有アクセストークンによるBearer認証を要求します(`src/server.ts`)。

- `.env` の `API_ACCESS_TOKEN` を設定するか、未設定のまま起動すると自動生成され、ログと `data/access-token.txt` に出力されます。
- クライアントの「ノードを追加」画面でこのトークンを入力すると、Electronの`safeStorage`で暗号化されて保存されます。
- WebSocket接続はブラウザ側で独自ヘッダーを送れないため、`?token=` クエリパラメータでの認証にも対応しています。

`auth`モジュール(WebAuthn/パスキー)はコードとしては残していますが、まだ上記の暫定トークン認証からは呼び出されていません。将来的にはこちらのモジュールに置き換える予定です。

## Webターミナル(`terminal`モジュール)

`ssh2`クライアントとしてノード自身のsshd(デフォルト`127.0.0.1:22`、`.env`の`TERMINAL_SSH_HOST`/`TERMINAL_SSH_PORT`で変更可)に接続することで、Linuxユーザー名/パスワードによるログイン画面をそのまま実現している。

- クライアントは`/terminal/session`にWebSocket接続後、最初のメッセージとして`{ type: "auth", username, password, cols, rows }`を送る。
- サーバーはその資格情報でsshdへ接続し、認証(PAM等)自体はLinux/sshdに委ねる。成功すると`{ type: "auth-success" }`を返し、以後シェルの出力を`{ type: "data", data }`で継続送信する。失敗時は`{ type: "auth-error", message }`を返して切断する。
- クライアントからの入力は`{ type: "input", data }`、リサイズは`{ type: "resize", cols, rows }`で送る。
- パスワードはメモリ上でssh2に渡すのみで、ディスク・ログ・監査ログのいずれにも保存しない。ログイン成功/失敗/切断のイベントのみ`audit`に記録する(`src/modules/terminal/session.ts`)。
- この認証は共有アクセストークン(V1認証)とは別階層。WebSocket自体への到達には`?token=`が必要で、その上でLinuxユーザー認証を行う2段階構成になる。

### 前提条件: sshdが127.0.0.1からの接続を許可していること

`server-manager-api`プロセス自身が`127.0.0.1`から`sshd`へ接続するため、TCP Wrappers(`/etc/hosts.allow` / `/etc/hosts.deny`)で接続元を制限している場合は`127.0.0.1`を許可リストに追加する必要がある。特に外部公開サーバーで`/etc/hosts.deny`に`sshd: ALL`を設定し`/etc/hosts.allow`で許可IPを絞っている構成では、localhostが明示的に許可されていないとログイン試行がすべて`refused connect from 127.0.0.1`として拒否される。

```bash
# /etc/hosts.allow に以下を追記(既存の許可設定は残したままでよい)
sshd: 127.0.0.1
```

設定変更は`sshd`の再起動不要で即時反映される(TCP Wrappersは接続ごとにファイルを読む)。

## 注意事項(スキャフォールド段階)

- `auth`モジュールはWebAuthnのフロー骨格のみを実装しており、リカバリーコードや予備パスキー登録などNotion設計の全項目は未実装(TODOコメントを参照)。
- Docker/systemd/apt等の操作はUbuntu上でのroot相当権限を前提としている。Windows開発環境ではエラーになる点に注意。
- `game-servers`は環境変数 `PTERODACTYL_PANEL_URL` / `PTERODACTYL_APPLICATION_API_KEY` / `PTERODACTYL_CLIENT_API_KEY` が未設定の場合は502を返す。
- `terminal`はノード自身にsshdが稼働していることが前提。sshdが無効なノードでは常にログインに失敗する。
