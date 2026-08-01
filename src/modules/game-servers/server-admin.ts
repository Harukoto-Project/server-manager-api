import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { ApiModuleContext } from "../types.js";
import { PterodactylServerAdminClient } from "./pterodactyl-client-server-admin.js";
import { respondPterodactylError } from "./pterodactyl-request.js";

const detailsBodySchema = z.object({
	name: z.string().trim().min(1).optional(),
	description: z.string().optional(),
	userId: z.number().int().positive().optional(),
});
const buildBodySchema = z.object({
	memory: z.number().int().min(0).optional(),
	swap: z.number().int().min(-1).optional(),
	disk: z.number().int().min(0).optional(),
	io: z.number().int().min(10).max(1000).optional(),
	cpu: z.number().int().min(0).optional(),
	databases: z.number().int().min(0).optional(),
	allocations: z.number().int().min(0).optional(),
	backups: z.number().int().min(0).optional(),
});

/**
 * サーバー詳細ページの「サーバー管理」タブに対応するAPI(パネル管理者向け・破壊的操作を含む)。
 * ロジック本体は`pterodactyl-client-server-admin.ts`の`PterodactylServerAdminClient`に実装する。
 * 削除・再インストール・凍結はクライアント側で`ConfirmDestructiveDialog`等による確認を必須にすること。
 */
const serverAdminModule: FastifyPluginAsync<{ ctx: ApiModuleContext }> = async (fastify, opts) => {
	const { audit } = opts.ctx;
	const client = new PterodactylServerAdminClient(opts.ctx.env);

	fastify.get<{ Params: { identifier: string } }>("/:identifier", async (request, reply) => {
		try {
			const server = await client.getDetails(request.params.identifier);
			return { server };
		} catch (error) {
			return respondPterodactylError(reply, error);
		}
	});

	fastify.patch<{ Params: { identifier: string }; Body: z.infer<typeof detailsBodySchema> }>(
		"/:identifier/details",
		async (request, reply) => {
			const body = detailsBodySchema.parse(request.body);
			try {
				const server = await client.updateDetails(request.params.identifier, body);
				await audit.record({
					actor: "session-user",
					action: "game-server.admin.updateDetails",
					target: request.params.identifier,
					severity: "info",
				});
				return { server };
			} catch (error) {
				return respondPterodactylError(reply, error);
			}
		},
	);

	fastify.patch<{ Params: { identifier: string }; Body: z.infer<typeof buildBodySchema> }>(
		"/:identifier/build",
		async (request, reply) => {
			const body = buildBodySchema.parse(request.body);
			try {
				const server = await client.updateBuild(request.params.identifier, body);
				await audit.record({
					actor: "session-user",
					action: "game-server.admin.updateBuild",
					target: request.params.identifier,
					severity: "warning",
				});
				return { server };
			} catch (error) {
				return respondPterodactylError(reply, error);
			}
		},
	);

	fastify.post<{ Params: { identifier: string } }>("/:identifier/reinstall", async (request, reply) => {
		try {
			await client.reinstall(request.params.identifier);
		} catch (error) {
			return respondPterodactylError(reply, error);
		}
		await audit.record({
			actor: "session-user",
			action: "game-server.admin.reinstall",
			target: request.params.identifier,
			severity: "warning",
		});
		return { ok: true };
	});

	fastify.post<{ Params: { identifier: string } }>("/:identifier/suspend", async (request, reply) => {
		try {
			await client.suspend(request.params.identifier);
		} catch (error) {
			return respondPterodactylError(reply, error);
		}
		await audit.record({
			actor: "session-user",
			action: "game-server.admin.suspend",
			target: request.params.identifier,
			severity: "warning",
		});
		return { ok: true };
	});

	fastify.post<{ Params: { identifier: string } }>("/:identifier/unsuspend", async (request, reply) => {
		try {
			await client.unsuspend(request.params.identifier);
		} catch (error) {
			return respondPterodactylError(reply, error);
		}
		await audit.record({
			actor: "session-user",
			action: "game-server.admin.unsuspend",
			target: request.params.identifier,
			severity: "info",
		});
		return { ok: true };
	});

	fastify.delete<{ Params: { identifier: string }; Querystring: { force?: string } }>(
		"/:identifier",
		async (request, reply) => {
			try {
				await client.remove(request.params.identifier, request.query.force === "true");
			} catch (error) {
				return respondPterodactylError(reply, error);
			}
			await audit.record({
				actor: "session-user",
				action: "game-server.admin.delete",
				target: request.params.identifier,
				severity: "critical",
			});
			return { ok: true };
		},
	);
};

export default serverAdminModule;
