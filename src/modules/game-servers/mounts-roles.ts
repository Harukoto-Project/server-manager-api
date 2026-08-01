import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { ApiModuleContext } from "../types.js";
import { PterodactylMountsRolesClient } from "./pterodactyl-client-mounts-roles.js";
import { respondPterodactylError } from "./pterodactyl-request.js";

const createMountBodySchema = z.object({
	name: z.string().trim().min(1),
	description: z.string().default(""),
	source: z.string().trim().min(1),
	target: z.string().trim().min(1),
	readOnly: z.boolean().default(false),
});

/**
 * 管理者機能ハブの「マウント・ロール管理」カテゴリに対応するAPI。
 * ロジック本体は`pterodactyl-client-mounts-roles.ts`の`PterodactylMountsRolesClient`に実装する。
 */
const mountsRolesModule: FastifyPluginAsync<{ ctx: ApiModuleContext }> = async (fastify, opts) => {
	const { audit } = opts.ctx;
	const client = new PterodactylMountsRolesClient(opts.ctx.env);

	fastify.get("/mounts", async (_request, reply) => {
		try {
			const mounts = await client.listMounts();
			return { mounts };
		} catch (error) {
			return respondPterodactylError(reply, error);
		}
	});

	fastify.post<{ Body: z.infer<typeof createMountBodySchema> }>("/mounts", async (request, reply) => {
		const body = createMountBodySchema.parse(request.body);
		try {
			const mount = await client.createMount(body);
			await audit.record({
				actor: "session-user",
				action: "game-server.mounts.create",
				target: body.name,
				severity: "info",
			});
			return { mount };
		} catch (error) {
			return respondPterodactylError(reply, error);
		}
	});

	fastify.delete<{ Params: { mountId: string } }>("/mounts/:mountId", async (request, reply) => {
		try {
			await client.removeMount(Number(request.params.mountId));
		} catch (error) {
			return respondPterodactylError(reply, error);
		}
		await audit.record({
			actor: "session-user",
			action: "game-server.mounts.remove",
			target: request.params.mountId,
			severity: "warning",
		});
		return { ok: true };
	});

	fastify.get("/roles", async (_request, reply) => {
		try {
			const roles = await client.listRoles();
			return { roles };
		} catch (error) {
			return respondPterodactylError(reply, error);
		}
	});
};

export default mountsRolesModule;
