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
| monitoring | `/monitoring` | CPU/メモリ/ディスク/ネットワークのリアルタイム表示 |
| docker | `/docker` | コンテナ/イメージ/ボリューム/ネットワーク管理 |
| systemd | `/systemd` | systemdサービス管理・journalログ閲覧 |
| system-settings | `/system-settings` | apt更新・UFW・ホスト名/タイムゾーン等 |
| game-servers | `/game-servers` | Pterodactyl連携によるMinecraft/ゲームサーバー管理 |
| process-manager | `/process-manager` | Node.js/Pythonプロジェクトのプロセス管理・WebSocketコンソール |

## セットアップ

```bash
npm install
cp .env.example .env
npm run dev
```

## 注意事項(スキャフォールド段階)

- `auth`モジュールはWebAuthnのフロー骨格のみを実装しており、リカバリーコードや予備パスキー登録などNotion設計の全項目は未実装(TODOコメントを参照)。
- Docker/systemd/apt等の操作はUbuntu上でのroot相当権限を前提としている。Windows開発環境ではエラーになる点に注意。
- `game-servers`は環境変数 `PTERODACTYL_PANEL_URL` / `PTERODACTYL_APPLICATION_API_KEY` / `PTERODACTYL_CLIENT_API_KEY` が未設定の場合は502を返す。
