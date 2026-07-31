import { z } from "zod";

const envSchema = z.object({
	HOST: z.string().default("0.0.0.0"),
	PORT: z.coerce.number().int().positive().default(8443),
	NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
	LOG_LEVEL: z.string().default("info"),

	JWT_SECRET: z.string().min(1).default("change-me-in-production"),
	SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(30),

	/**
	 * クライアント⇔ノード間の暫定認証(V1)に使う共有アクセストークン。
	 * 未設定の場合は初回起動時に自動生成し `data/access-token.txt` に保存する(access-token.ts参照)。
	 * TODO: 将来的にはパスキー(WebAuthn)によるノード個別登録に置き換える(auth/index.ts参照)。
	 */
	API_ACCESS_TOKEN: z.string().min(16).optional(),

	WEBAUTHN_RP_ID: z.string().default("localhost"),
	WEBAUTHN_RP_NAME: z.string().default("Harukoto Server Manager"),
	WEBAUTHN_ORIGIN: z.string().default("https://localhost:8443"),

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

	PTERODACTYL_PANEL_URL: z.string().optional(),
	PTERODACTYL_APPLICATION_API_KEY: z.string().optional(),
	PTERODACTYL_CLIENT_API_KEY: z.string().optional(),

	DISCORD_WEBHOOK_URL: z.string().optional(),
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
