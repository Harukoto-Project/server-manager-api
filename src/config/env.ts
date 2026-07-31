import { z } from "zod";

const envSchema = z.object({
	HOST: z.string().default("0.0.0.0"),
	PORT: z.coerce.number().int().positive().default(8443),
	NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
	LOG_LEVEL: z.string().default("info"),

	JWT_SECRET: z.string().min(1).default("change-me-in-production"),
	SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(30),

	WEBAUTHN_RP_ID: z.string().default("localhost"),
	WEBAUTHN_RP_NAME: z.string().default("Harukoto Server Manager"),
	WEBAUTHN_ORIGIN: z.string().default("https://localhost:8443"),

	DOCKER_SOCKET_PATH: z.string().default("/var/run/docker.sock"),

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
