import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { ApiModuleContext } from "../types.js";
import { PterodactylDatabasesClient } from "./pterodactyl-client-databases.js";
import { respondPterodactylError } from "./pterodactyl-request.js";

const createBodySchema = z.object({
	database: z.string().trim().min(1),
	remote: z.string().trim().min(1).default("%"),
});

/**
 * サーバー詳細ページの「データベース」タブに対応するAPI。
 * ロジック本体は`pterodactyl-client-databases.ts`の`PterodactylDatabasesClient`に実装する。
 */
const databasesModule: FastifyPluginAsync<{ ctx: ApiModuleContext }> = async (fastify, opts) => {
	const { audit } = opts.ctx;
	const client = new PterodactylDatabasesClient(opts.ctx.env);

	fastify.get<{ Params: { identifier: string } }>("/:identifier", async (request, reply) => {
		try {
			const databases = await client.list(request.params.identifier);
			return { databases };
		} catch (error) {
			return respondPterodactylError(reply, error);
		}
	});

	fastify.post<{ Params: { identifier: string }; Body: z.infer<typeof createBodySchema> }>(
		"/:identifier",
		async (request, reply) => {
			const body = createBodySchema.parse(request.body);
			try {
				const database = await client.create(request.params.identifier, body.database, body.remote);
				await audit.record({
					actor: "session-user",
					action: "game-server.databases.create",
					target: `${request.params.identifier}:${body.database}`,
					severity: "info",
				});
				return { database };
			} catch (error) {
				return respondPterodactylError(reply, error);
			}
		},
	);

	fastify.post<{ Params: { identifier: string; databaseId: string } }>(
		"/:identifier/:databaseId/rotate-password",
		async (request, reply) => {
			try {
				const database = await client.rotatePassword(request.params.identifier, request.params.databaseId);
				return { database };
			} catch (error) {
				return respondPterodactylError(reply, error);
			}
		},
	);

	fastify.delete<{ Params: { identifier: string; databaseId: string } }>(
		"/:identifier/:databaseId",
		async (request, reply) => {
			try {
				await client.remove(request.params.identifier, request.params.databaseId);
			} catch (error) {
				return respondPterodactylError(reply, error);
			}
			await audit.record({
				actor: "session-user",
				action: "game-server.databases.delete",
				target: `${request.params.identifier}:${request.params.databaseId}`,
				severity: "warning",
			});
			return { ok: true };
		},
	);
};

export default databasesModule;
