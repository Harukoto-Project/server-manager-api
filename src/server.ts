import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyBaseLogger } from "fastify";
import type { Env } from "./config/env.js";
import { resolveAccessToken } from "./lib/access-token.js";
import { AuditLogger } from "./lib/audit.js";
import { createLogger } from "./lib/logger.js";
import { moduleRegistry } from "./modules/registry.js";

/** 認証チェックを行わない公開ルート(疎通確認用) */
const PUBLIC_PATH_PREFIXES = ["/health"];

export async function buildServer(env: Env) {
	const logger = createLogger(env);
	const audit = new AuditLogger(env, logger);
	const accessToken = await resolveAccessToken(env, logger);

	const fastify = Fastify({ loggerInstance: logger as unknown as FastifyBaseLogger });

	await fastify.register(sensible);
	await fastify.register(cors, { origin: true });
	await fastify.register(websocket);

	// V1の暫定認証: クライアントの「ノードを追加」で入力する共有アクセストークンを
	// 全ルートに要求する(/health を除く)。
	// ブラウザのWebSocket APIはハンドシェイクに独自ヘッダーを付けられないため、
	// REST呼び出しは Authorization: Bearer、WebSocket接続は ?token= クエリを許可する。
	// TODO: パスキー(WebAuthn)によるノード個別登録(auth/index.ts)に置き換える。
	fastify.addHook("onRequest", async (request, reply) => {
		if (PUBLIC_PATH_PREFIXES.some((prefix) => request.url.startsWith(prefix))) return;

		const header = request.headers.authorization;
		const headerToken = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
		const queryToken = (request.query as Record<string, string | undefined> | undefined)?.token;
		const token = headerToken ?? queryToken;
		if (token !== accessToken) {
			await audit.record({
				actor: request.ip,
				action: "auth.access-token.rejected",
				target: request.url,
				severity: "warning",
			});
			return reply.code(401).send({ error: "アクセストークンが不正です" });
		}
	});

	for (const module of moduleRegistry) {
		await fastify.register(
			async (instance) => {
				await module.plugin(instance, { ctx: { env, audit } });
			},
			{ prefix: module.prefix },
		);
		logger.info(`モジュール登録: ${module.id} -> ${module.prefix}`);
	}

	return fastify;
}
