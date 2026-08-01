import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { ApiModuleContext } from "../types.js";
import { PterodactylPanelUsersClient } from "./pterodactyl-client-panel-users.js";
import { respondPterodactylError } from "./pterodactyl-request.js";

const createBodySchema = z.object({
	email: z.string().trim().email(),
	username: z.string().trim().min(1),
	firstName: z.string().trim().min(1),
	lastName: z.string().trim().min(1),
	password: z.string().min(8).optional(),
});
const updateBodySchema = createBodySchema.partial();

/**
 * 管理者機能ハブの「パネルユーザー管理」カテゴリに対応するAPI。
 * ロジック本体は`pterodactyl-client-panel-users.ts`の`PterodactylPanelUsersClient`に実装する。
 */
const panelUsersModule: FastifyPluginAsync<{ ctx: ApiModuleContext }> = async (fastify, opts) => {
	const { audit } = opts.ctx;
	const client = new PterodactylPanelUsersClient(opts.ctx.env);

	fastify.get("/", async (_request, reply) => {
		try {
			const users = await client.list();
			return { users };
		} catch (error) {
			return respondPterodactylError(reply, error);
		}
	});

	fastify.get<{ Params: { userId: string } }>("/:userId", async (request, reply) => {
		try {
			const user = await client.getDetails(Number(request.params.userId));
			return { user };
		} catch (error) {
			return respondPterodactylError(reply, error);
		}
	});

	fastify.post<{ Body: z.infer<typeof createBodySchema> }>("/", async (request, reply) => {
		const body = createBodySchema.parse(request.body);
		try {
			const user = await client.create(body);
			await audit.record({
				actor: "session-user",
				action: "game-server.panelUsers.create",
				target: body.email,
				severity: "warning",
			});
			return { user };
		} catch (error) {
			return respondPterodactylError(reply, error);
		}
	});

	fastify.patch<{ Params: { userId: string }; Body: z.infer<typeof updateBodySchema> }>(
		"/:userId",
		async (request, reply) => {
			const body = updateBodySchema.parse(request.body);
			try {
				const user = await client.update(Number(request.params.userId), body);
				return { user };
			} catch (error) {
				return respondPterodactylError(reply, error);
			}
		},
	);

	fastify.delete<{ Params: { userId: string } }>("/:userId", async (request, reply) => {
		try {
			await client.remove(Number(request.params.userId));
		} catch (error) {
			return respondPterodactylError(reply, error);
		}
		await audit.record({
			actor: "session-user",
			action: "game-server.panelUsers.remove",
			target: request.params.userId,
			severity: "critical",
		});
		return { ok: true };
	});
};

export default panelUsersModule;
