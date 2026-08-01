import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { ApiModuleContext } from "../types.js";
import { PterodactylStartupClient } from "./pterodactyl-client-startup.js";
import { respondPterodactylError } from "./pterodactyl-request.js";

const updateVariableBodySchema = z.object({
	key: z.string().trim().min(1),
	value: z.string().default(""),
});

/**
 * サーバー詳細ページの「起動設定」タブに対応するAPI。
 * ロジック本体は`pterodactyl-client-startup.ts`の`PterodactylStartupClient`に実装する。
 * ドッカーイメージ/スタートアップコマンド自体の変更は`server-admin.ts`側を参照。
 */
const startupModule: FastifyPluginAsync<{ ctx: ApiModuleContext }> = async (fastify, opts) => {
	const { audit } = opts.ctx;
	const client = new PterodactylStartupClient(opts.ctx.env);

	fastify.get<{ Params: { identifier: string } }>("/:identifier", async (request, reply) => {
		try {
			const startup = await client.get(request.params.identifier);
			return { startup };
		} catch (error) {
			return respondPterodactylError(reply, error);
		}
	});

	fastify.put<{ Params: { identifier: string }; Body: z.infer<typeof updateVariableBodySchema> }>(
		"/:identifier/variable",
		async (request, reply) => {
			const body = updateVariableBodySchema.parse(request.body);
			try {
				const variable = await client.updateVariable(request.params.identifier, body.key, body.value);
				await audit.record({
					actor: "session-user",
					action: "game-server.startup.updateVariable",
					target: `${request.params.identifier}:${body.key}`,
					severity: "info",
				});
				return { variable };
			} catch (error) {
				return respondPterodactylError(reply, error);
			}
		},
	);
};

export default startupModule;
