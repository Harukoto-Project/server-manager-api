import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { ApiModuleContext } from "../types.js";
import { PterodactylBackupsClient } from "./pterodactyl-client-backups.js";
import { respondPterodactylError } from "./pterodactyl-request.js";

const createBodySchema = z.object({
	name: z.string().trim().min(1).optional(),
	ignoredFiles: z.string().optional().default(""),
});
const restoreBodySchema = z.object({ truncate: z.boolean().optional().default(false) });

/**
 * サーバー詳細ページの「バックアップ」タブに対応するAPI。
 * ロジック本体は`pterodactyl-client-backups.ts`の`PterodactylBackupsClient`に実装する。
 */
const backupsModule: FastifyPluginAsync<{ ctx: ApiModuleContext }> = async (fastify, opts) => {
	const { audit } = opts.ctx;
	const client = new PterodactylBackupsClient(opts.ctx.env);

	fastify.get<{ Params: { identifier: string } }>("/:identifier", async (request, reply) => {
		try {
			const backups = await client.list(request.params.identifier);
			return { backups };
		} catch (error) {
			return respondPterodactylError(reply, error);
		}
	});

	fastify.post<{ Params: { identifier: string }; Body: z.infer<typeof createBodySchema> }>(
		"/:identifier",
		async (request, reply) => {
			const body = createBodySchema.parse(request.body);
			try {
				const backup = await client.create(request.params.identifier, body.name ?? "", body.ignoredFiles);
				await audit.record({
					actor: "session-user",
					action: "game-server.backups.create",
					target: request.params.identifier,
					severity: "info",
				});
				return { backup };
			} catch (error) {
				return respondPterodactylError(reply, error);
			}
		},
	);

	fastify.get<{ Params: { identifier: string; backupUuid: string } }>(
		"/:identifier/:backupUuid/download",
		async (request, reply) => {
			try {
				const url = await client.getDownloadUrl(request.params.identifier, request.params.backupUuid);
				return { url };
			} catch (error) {
				return respondPterodactylError(reply, error);
			}
		},
	);

	fastify.post<{
		Params: { identifier: string; backupUuid: string };
		Body: z.infer<typeof restoreBodySchema>;
	}>("/:identifier/:backupUuid/restore", async (request, reply) => {
		const body = restoreBodySchema.parse(request.body);
		try {
			await client.restore(request.params.identifier, request.params.backupUuid, body.truncate);
		} catch (error) {
			return respondPterodactylError(reply, error);
		}
		await audit.record({
			actor: "session-user",
			action: "game-server.backups.restore",
			target: `${request.params.identifier}:${request.params.backupUuid}`,
			severity: "warning",
		});
		return { ok: true };
	});

	fastify.post<{ Params: { identifier: string; backupUuid: string } }>(
		"/:identifier/:backupUuid/lock",
		async (request, reply) => {
			try {
				const backup = await client.toggleLock(request.params.identifier, request.params.backupUuid);
				return { backup };
			} catch (error) {
				return respondPterodactylError(reply, error);
			}
		},
	);

	fastify.delete<{ Params: { identifier: string; backupUuid: string } }>(
		"/:identifier/:backupUuid",
		async (request, reply) => {
			try {
				await client.remove(request.params.identifier, request.params.backupUuid);
			} catch (error) {
				return respondPterodactylError(reply, error);
			}
			await audit.record({
				actor: "session-user",
				action: "game-server.backups.delete",
				target: `${request.params.identifier}:${request.params.backupUuid}`,
				severity: "warning",
			});
			return { ok: true };
		},
	);
};

export default backupsModule;
