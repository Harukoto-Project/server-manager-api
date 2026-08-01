import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { ApiModuleContext } from "../types.js";
import { PterodactylNestsEggsClient } from "./pterodactyl-client-nests-eggs.js";
import { respondPterodactylError } from "./pterodactyl-request.js";

const importBodySchema = z.object({ eggJson: z.string().min(1) });
const updateVariableBodySchema = z.object({ defaultValue: z.string() });

/**
 * 管理者機能ハブの「Egg・Nestライブラリ管理」カテゴリに対応するAPI。
 * ロジック本体は`pterodactyl-client-nests-eggs.ts`の`PterodactylNestsEggsClient`に実装する。
 */
const nestsEggsModule: FastifyPluginAsync<{ ctx: ApiModuleContext }> = async (fastify, opts) => {
	const { audit } = opts.ctx;
	const client = new PterodactylNestsEggsClient(opts.ctx.env);

	fastify.get("/nests", async (_request, reply) => {
		try {
			const nests = await client.listNests();
			return { nests };
		} catch (error) {
			return respondPterodactylError(reply, error);
		}
	});

	fastify.get<{ Params: { nestId: string } }>("/nests/:nestId/eggs", async (request, reply) => {
		try {
			const eggs = await client.listEggs(Number(request.params.nestId));
			return { eggs };
		} catch (error) {
			return respondPterodactylError(reply, error);
		}
	});

	fastify.get<{ Params: { nestId: string; eggId: string } }>(
		"/nests/:nestId/eggs/:eggId",
		async (request, reply) => {
			try {
				const egg = await client.getEgg(Number(request.params.nestId), Number(request.params.eggId));
				return { egg };
			} catch (error) {
				return respondPterodactylError(reply, error);
			}
		},
	);

	fastify.patch<{
		Params: { nestId: string; eggId: string; variableId: string };
		Body: z.infer<typeof updateVariableBodySchema>;
	}>("/nests/:nestId/eggs/:eggId/variables/:variableId", async (request, reply) => {
		const body = updateVariableBodySchema.parse(request.body);
		try {
			const variable = await client.updateEggVariable(
				Number(request.params.nestId),
				Number(request.params.eggId),
				Number(request.params.variableId),
				body.defaultValue,
			);
			return { variable };
		} catch (error) {
			return respondPterodactylError(reply, error);
		}
	});

	fastify.post<{ Params: { nestId: string }; Body: z.infer<typeof importBodySchema> }>(
		"/nests/:nestId/eggs/import",
		async (request, reply) => {
			const body = importBodySchema.parse(request.body);
			try {
				const egg = await client.importEgg(Number(request.params.nestId), body.eggJson);
				await audit.record({
					actor: "session-user",
					action: "game-server.nestsEggs.import",
					target: request.params.nestId,
					severity: "info",
				});
				return { egg };
			} catch (error) {
				return respondPterodactylError(reply, error);
			}
		},
	);

	fastify.get<{ Params: { nestId: string; eggId: string } }>(
		"/nests/:nestId/eggs/:eggId/export",
		async (request, reply) => {
			try {
				const eggJson = await client.exportEgg(Number(request.params.nestId), Number(request.params.eggId));
				return { eggJson };
			} catch (error) {
				return respondPterodactylError(reply, error);
			}
		},
	);

	fastify.delete<{ Params: { nestId: string; eggId: string } }>(
		"/nests/:nestId/eggs/:eggId",
		async (request, reply) => {
			try {
				await client.removeEgg(Number(request.params.nestId), Number(request.params.eggId));
			} catch (error) {
				return respondPterodactylError(reply, error);
			}
			await audit.record({
				actor: "session-user",
				action: "game-server.nestsEggs.remove",
				target: `${request.params.nestId}:${request.params.eggId}`,
				severity: "warning",
			});
			return { ok: true };
		},
	);
};

export default nestsEggsModule;
