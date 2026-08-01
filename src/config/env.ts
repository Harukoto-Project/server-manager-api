import { z } from "zod";

const envSchema = z.object({
	HOST: z.string().default("0.0.0.0"),
	PORT: z.coerce.number().int().positive().default(8443),
	NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
	LOG_LEVEL: z.string().default("info"),

	JWT_SECRET: z.string().min(1).default("change-me-in-production"),
	SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(480),

	/**
	 * クライアント⇔ノード間の後方互換認証(V1)に使う共有アクセストークン。
	 * LEGACY_TOKEN_AUTH=true のときのみ使用する。
	 * 未設定の場合は初回起動時に自動生成し `data/access-token.txt` に保存する(access-token.ts参照)。
	 */
	API_ACCESS_TOKEN: z.string().min(16).optional(),

	/**
	 * true にすると共有アクセストークン認証(V1)を使う後方互換モードで起動する。
	 * false(デフォルト)ではパスキー(WebAuthn)+JWTセッション認証を使う。
	 */
	LEGACY_TOKEN_AUTH: z.coerce.boolean().default(false),

	/**
	 * true にするとパスキー登録エンドポイント(/auth/register/*)を有効化する。
	 * ノードの初回セットアップ時のみ true にし、登録完了後は false に戻すこと。
	 */
	SETUP_MODE: z.coerce.boolean().default(false),

	WEBAUTHN_RP_ID: z.string().default("server-manager"),
	WEBAUTHN_RP_NAME: z.string().default("Harukoto Server Manager"),
	WEBAUTHN_ORIGIN: z.string().default("app://server-manager"),

	DOCKER_SOCKET_PATH: z.string().default("/var/run/docker.sock"),

	/**
	 * Webターミナルモジュールが接続するSSHサーバー(通常はノード自身のsshd)。
	 * ユーザー名/パスワードはクライアントのログイン画面から都度送信され、サーバー側には保存しない。
	 */
	TERMINAL_SSH_HOST: z.string().default("127.0.0.1"),
	TERMINAL_SSH_PORT: z.coerce.number().int().positive().default(22),

	/** モニタリング履歴(SQLite)のサンプリング間隔(ms)。クライアントのポーリング間隔とは独立して動作する */
	MONITORING_SAMPLE_INTERVAL_MS: z.coerce.number().int().positive().default(15000),
	/** モニタリング履歴の保持日数。これを超えた古いサンプルは定期的に削除する */
	MONITORING_HISTORY_RETENTION_DAYS: z.coerce.number().int().positive().default(14),

	/** ストレージI/O履歴(SQLite)のサンプリング間隔(ms)。モニタリング履歴と同様、クライアントの接続有無とは独立して動作する */
	STORAGE_IO_SAMPLE_INTERVAL_MS: z.coerce.number().int().positive().default(15000),
	/** ストレージI/O履歴の保持日数。これを超えた古いサンプルは定期的に削除する */
	STORAGE_IO_HISTORY_RETENTION_DAYS: z.coerce.number().int().positive().default(14),

	/**
	 * true にすると Fastify を HTTPS/WSS モードで起動する。
	 * false(デフォルト)では HTTP/WS で起動し、開発環境でも TLS なしで使用できる。
	 */
	TLS_ENABLED: z.coerce.boolean().default(false),

	/**
	 * TLS_ENABLED=true のときに使用する証明書ファイルのパス(PEM形式)。
	 * setup-tls.sh で生成した自己署名証明書を指定する。
	 */
	TLS_CERT_PATH: z.string().optional(),

	/**
	 * TLS_ENABLED=true のときに使用する秘密鍵ファイルのパス(PEM形式)。
	 */
	TLS_KEY_PATH: z.string().optional(),

	PTERODACTYL_PANEL_URL: z.string().optional(),
	PTERODACTYL_APPLICATION_API_KEY: z.string().optional(),
	PTERODACTYL_CLIENT_API_KEY: z.string().optional(),

	DISCORD_WEBHOOK_URL: z.string().optional(),

	/**
	 * ファイルマネージャーモジュールがブラウズを許可するルートディレクトリ。
	 * デフォルトは "/" (サーバー全体)。
	 * `/proc`, `/sys`, `/dev` などカーネル仮想FSへのアクセスは FILE_MANAGER_ROOT の値に関わらず常にブロックする。
	 */
	FILE_MANAGER_ROOT: z.string().default("/"),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
	const parsed = envSchema.safeParse(source);
	if (!parsed.success) {
		// eslint-disable-next-line no-console
		console.error("環境変数の検証に失敗しました:", parsed.error.flatten().fieldErrors);
		process.exit(1);
	}
	return parsed.data;
}
