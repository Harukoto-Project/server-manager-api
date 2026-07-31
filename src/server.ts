import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyBaseLogger } from "fastify";
import type { Env } from "./config/env.js";
import { AuditLogger } from "./lib/audit.js";
import { createLogger } from "./lib/logger.js";
import { moduleRegistry } from "./modules/registry.js";

export async function buildServer(env: Env) {
	const logger = createLogger(env);
	const audit = new AuditLogger(env, logger);

	const fastify = Fastify({ loggerInstance: logger as unknown as FastifyBaseLogger });

	await fastify.register(sensible);
	await fastify.register(cors, { origin: true });
	await fastify.register(websocket);

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
