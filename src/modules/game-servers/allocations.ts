import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { ApiModuleContext } from "../types.js";
import { PterodactylAllocationsClient } from "./pterodactyl-client-allocations.js";
import { respondPterodactylError } from "./pterodactyl-request.js";

const createBodySchema = z.object({
	ip: z.string().trim().min(1),
	ports: z.array(z.string().trim().min(1)).min(1),
	alias: z.string().trim().optional(),
});

/**
 * 管理者機能ハブの「アロケーション(IP/ポート割り当て)管理」カテゴリに対応するAPI。
 * ロジック本体は`pterodactyl-client-allocations.ts`の`PterodactylAllocationsClient`に実装する。
 */
const allocationsModule: FastifyPluginAsync<{ ctx: ApiModuleContext }> = async (fastify, opts) => {
	const { audit } = opts.ctx;
	const client = new PterodactylAllocationsClient(opts.ctx.env);

	fastify.get<{ Params: { nodeId: string } }>("/:nodeId", async (request, reply) => {
		try {
			const allocations = await client.list(Number(request.params.nodeId));
			return { allocations };
		} catch (error) {
			return respondPterodactylError(reply, error);
		}
	});

	fastify.post<{ Params: { nodeId: string }; Body: z.infer<typeof createBodySchema> }>(
		"/:nodeId",
		async (request, reply) => {
			const body = createBodySchema.parse(request.body);
			try {
				const allocations = await client.create(Number(request.params.nodeId), body.ip, body.ports, body.alias);
				await audit.record({
					actor: "session-user",
					action: "game-server.allocations.create",
					target: `${request.params.nodeId}:${body.ip}`,
					severity: "info",
				});
				return { allocations };
			} catch (error) {
				return respondPterodactylError(reply, error);
			}
		},
	);

	fastify.delete<{ Params: { nodeId: string; allocationId: string } }>(
		"/:nodeId/:allocationId",
		async (request, reply) => {
			try {
				await client.remove(Number(request.params.nodeId), Number(request.params.allocationId));
			} catch (error) {
				return respondPterodactylError(reply, error);
			}
			await audit.record({
				actor: "session-user",
				action: "game-server.allocations.remove",
				target: `${request.params.nodeId}:${request.params.allocationId}`,
				severity: "warning",
			});
			return { ok: true };
		},
	);
};

export default allocationsModule;
