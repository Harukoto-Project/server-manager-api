import type { FastifyPluginAsync } from "fastify";
import type { ApiModuleContext } from "../types.js";
import { PterodactylNodesClient } from "./pterodactyl-client-nodes.js";
import { respondPterodactylError } from "./pterodactyl-request.js";

/**
 * 管理者機能ハブの「ノード管理」カテゴリに対応するAPI。
 * ロジック本体は`pterodactyl-client-nodes.ts`の`PterodactylNodesClient`に実装する。
 */
const nodesModule: FastifyPluginAsync<{ ctx: ApiModuleContext }> = async (fastify, opts) => {
	const client = new PterodactylNodesClient(opts.ctx.env);

	fastify.get("/", async (_request, reply) => {
		try {
			const nodes = await client.list();
			return { nodes };
		} catch (error) {
			return respondPterodactylError(reply, error);
		}
	});

	fastify.get<{ Params: { nodeId: string } }>("/:nodeId", async (request, reply) => {
		try {
			const node = await client.getDetails(Number(request.params.nodeId));
			return { node };
		} catch (error) {
			return respondPterodactylError(reply, error);
		}
	});

	fastify.get<{ Params: { nodeId: string } }>("/:nodeId/configuration", async (request, reply) => {
		try {
			const configuration = await client.getConfiguration(Number(request.params.nodeId));
			return { configuration };
		} catch (error) {
			return respondPterodactylError(reply, error);
		}
	});
};

export default nodesModule;
