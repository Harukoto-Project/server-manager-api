import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { ApiModuleContext } from "../types.js";
import { PterodactylSubusersClient } from "./pterodactyl-client-subusers.js";
import { respondPterodactylError } from "./pterodactyl-request.js";

const inviteBodySchema = z.object({
	email: z.string().trim().email(),
	permissions: z.array(z.string()).default([]),
});
const updatePermissionsBodySchema = z.object({ permissions: z.array(z.string()) });

/**
 * サーバー詳細ページの「サブユーザー(共同管理者)」タブに対応するAPI。
 * ロジック本体は`pterodactyl-client-subusers.ts`の`PterodactylSubusersClient`に実装する。
 */
const subusersModule: FastifyPluginAsync<{ ctx: ApiModuleContext }> = async (fastify, opts) => {
	const { audit } = opts.ctx;
	const client = new PterodactylSubusersClient(opts.ctx.env);

	fastify.get<{ Params: { identifier: string } }>("/:identifier", async (request, reply) => {
		try {
			const subusers = await client.list(request.params.identifier);
			return { subusers };
		} catch (error) {
			return respondPterodactylError(reply, error);
		}
	});

	fastify.post<{ Params: { identifier: string }; Body: z.infer<typeof inviteBodySchema> }>(
		"/:identifier",
		async (request, reply) => {
			const body = inviteBodySchema.parse(request.body);
			try {
				const subuser = await client.invite(request.params.identifier, body.email, body.permissions);
				await audit.record({
					actor: "session-user",
					action: "game-server.subusers.invite",
					target: `${request.params.identifier}:${body.email}`,
					severity: "warning",
				});
				return { subuser };
			} catch (error) {
				return respondPterodactylError(reply, error);
			}
		},
	);

	fastify.patch<{
		Params: { identifier: string; subuserUuid: string };
		Body: z.infer<typeof updatePermissionsBodySchema>;
	}>("/:identifier/:subuserUuid", async (request, reply) => {
		const body = updatePermissionsBodySchema.parse(request.body);
		try {
			const subuser = await client.updatePermissions(
				request.params.identifier,
				request.params.subuserUuid,
				body.permissions,
			);
			return { subuser };
		} catch (error) {
			return respondPterodactylError(reply, error);
		}
	});

	fastify.delete<{ Params: { identifier: string; subuserUuid: string } }>(
		"/:identifier/:subuserUuid",
		async (request, reply) => {
			try {
				await client.remove(request.params.identifier, request.params.subuserUuid);
			} catch (error) {
				return respondPterodactylError(reply, error);
			}
			await audit.record({
				actor: "session-user",
				action: "game-server.subusers.remove",
				target: `${request.params.identifier}:${request.params.subuserUuid}`,
				severity: "warning",
			});
			return { ok: true };
		},
	);
};

export default subusersModule;
