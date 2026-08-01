import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyBaseLogger } from "fastify";
import jwt from "jsonwebtoken";
import type { ServerOptions } from "node:https";
import type { Env } from "./config/env.js";
import { resolveAccessToken } from "./lib/access-token.js";
import { AuditLogger } from "./lib/audit.js";
import { createLogger } from "./lib/logger.js";
import { moduleRegistry } from "./modules/registry.js";

const PUBLIC_PATH_PREFIXES = ["/health", "/auth/"];

export async function buildServer(env: Env, httpsOptions?: ServerOptions) {
	const logger = createLogger(env);
	const audit = new AuditLogger(env, logger);

	const fastify = Fastify({
		loggerInstance: logger as unknown as FastifyBaseLogger,
		https: httpsOptions ?? null,
	});

	await fastify.register(sensible);
	await fastify.register(cors, { origin: true });
	await fastify.register(websocket);

	if (env.LEGACY_TOKEN_AUTH) {
		const accessToken = await resolveAccessToken(env, logger);
		logger.warn(
			"LEGACY_TOKEN_AUTH モードで起動しています。共有アクセストークン認証を使用します。パスキー認証への移行を推奨します。",
		);

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
	} else {
		fastify.addHook("onRequest", async (request, reply) => {
			if (PUBLIC_PATH_PREFIXES.some((prefix) => request.url.startsWith(prefix))) return;

			const header = request.headers.authorization;
			const headerToken = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
			const queryToken = (request.query as Record<string, string | undefined> | undefined)?.token;
			const token = headerToken ?? queryToken;

			if (!token) {
				return reply.code(401).send({ error: "認証が必要です" });
			}
			try {
				jwt.verify(token, env.JWT_SECRET);
			} catch {
				await audit.record({
					actor: request.ip,
					action: "auth.jwt.rejected",
					target: request.url,
					severity: "warning",
				});
				return reply.code(401).send({ error: "セッションが無効または期限切れです" });
			}
		});
	}

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
