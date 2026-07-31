import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { ApiModuleContext } from "../types.js";
import { PterodactylClient } from "./pterodactyl-client.js";

const powerActionSchema = z.object({
	signal: z.enum(["start", "stop", "restart", "kill"]),
});

/**
 * Minecraft/ゲームサーバー管理モジュール。
 * バックエンドとして既存Pterodactylパネルの API を流用しつつ、
 * GUIは自前のダッシュボードデザインで統一する(Notion設計に対応)。
 */
const gameServersModule: FastifyPluginAsync<{ ctx: ApiModuleContext }> = async (fastify, opts) => {
	const { audit } = opts.ctx;
	const client = new PterodactylClient(opts.ctx.env);

	fastify.get("/servers", async (request, reply) => {
		try {
			return { servers: await client.listServers() };
		} catch (error) {
			return reply.code(502).send({ error: (error as Error).message });
		}
	});

	fastify.post<{ Params: { identifier: string }; Body: z.infer<typeof powerActionSchema> }>(
		"/servers/:identifier/power",
		async (request, reply) => {
			const { signal } = powerActionSchema.parse(request.body);
			try {
				await client.sendPowerAction(request.params.identifier, signal);
			} catch (error) {
				return reply.code(502).send({ error: (error as Error).message });
			}

			await audit.record({
				actor: "session-user",
				action: `game-server.power.${signal}`,
				target: request.params.identifier,
				severity: signal === "kill" || signal === "stop" ? "warning" : "info",
			});

			return { ok: true };
		},
	);

	fastify.get<{ Params: { identifier: string } }>("/servers/:identifier/console", async (request, reply) => {
		try {
			return await client.getConsoleCredentials(request.params.identifier);
		} catch (error) {
			return reply.code(502).send({ error: (error as Error).message });
		}
	});
};

export default gameServersModule;
