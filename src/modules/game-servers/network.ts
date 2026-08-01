import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { ApiModuleContext } from "../types.js";
import { PterodactylServerNetworkClient } from "./pterodactyl-client-network.js";
import { respondPterodactylError } from "./pterodactyl-request.js";

const notesBodySchema = z.object({ notes: z.string().max(200).default("") });

/**
 * サーバー詳細ページの「ネットワーク(アロケーション)」タブに対応するAPI。
 * ロジック本体は`pterodactyl-client-network.ts`の`PterodactylServerNetworkClient`に実装する。
 */
const networkModule: FastifyPluginAsync<{ ctx: ApiModuleContext }> = async (fastify, opts) => {
	const { audit } = opts.ctx;
	const client = new PterodactylServerNetworkClient(opts.ctx.env);

	fastify.get<{ Params: { identifier: string } }>("/:identifier", async (request, reply) => {
		try {
			const allocations = await client.list(request.params.identifier);
			return { allocations };
		} catch (error) {
			return respondPterodactylError(reply, error);
		}
	});

	fastify.post<{ Params: { identifier: string } }>("/:identifier", async (request, reply) => {
		try {
			const allocation = await client.assign(request.params.identifier);
			return { allocation };
		} catch (error) {
			return respondPterodactylError(reply, error);
		}
	});

	fastify.patch<{
		Params: { identifier: string; allocationId: string };
		Body: z.infer<typeof notesBodySchema>;
	}>("/:identifier/:allocationId", async (request, reply) => {
		const body = notesBodySchema.parse(request.body);
		try {
			const allocation = await client.setNotes(request.params.identifier, Number(request.params.allocationId), body.notes);
			return { allocation };
		} catch (error) {
			return respondPterodactylError(reply, error);
		}
	});

	fastify.post<{ Params: { identifier: string; allocationId: string } }>(
		"/:identifier/:allocationId/primary",
		async (request, reply) => {
			try {
				await client.setPrimary(request.params.identifier, Number(request.params.allocationId));
			} catch (error) {
				return respondPterodactylError(reply, error);
			}
			return { ok: true };
		},
	);

	fastify.delete<{ Params: { identifier: string; allocationId: string } }>(
		"/:identifier/:allocationId",
		async (request, reply) => {
			try {
				await client.unassign(request.params.identifier, Number(request.params.allocationId));
			} catch (error) {
				return respondPterodactylError(reply, error);
			}
			await audit.record({
				actor: "session-user",
				action: "game-server.network.unassign",
				target: `${request.params.identifier}:${request.params.allocationId}`,
				severity: "warning",
			});
			return { ok: true };
		},
	);
};

export default networkModule;
