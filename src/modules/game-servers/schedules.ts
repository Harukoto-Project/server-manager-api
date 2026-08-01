import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { ApiModuleContext } from "../types.js";
import { PterodactylSchedulesClient } from "./pterodactyl-client-schedules.js";
import { respondPterodactylError } from "./pterodactyl-request.js";

const cronFieldSchema = z.string().trim().min(1).default("*");
const scheduleBodySchema = z.object({
	name: z.string().trim().min(1),
	minute: cronFieldSchema,
	hour: cronFieldSchema,
	dayOfWeek: cronFieldSchema,
	dayOfMonth: cronFieldSchema,
	isActive: z.boolean().default(true),
});
const scheduleUpdateBodySchema = scheduleBodySchema.partial();
const taskBodySchema = z.object({
	action: z.enum(["command", "power", "backup"]),
	payload: z.string().trim().min(1),
	timeOffset: z.number().int().min(0).max(900).default(0),
});
const taskUpdateBodySchema = taskBodySchema.partial();

/**
 * サーバー詳細ページの「スケジュール(自動タスク)」タブに対応するAPI。
 * ロジック本体は`pterodactyl-client-schedules.ts`の`PterodactylSchedulesClient`に実装する。
 */
const schedulesModule: FastifyPluginAsync<{ ctx: ApiModuleContext }> = async (fastify, opts) => {
	const { audit } = opts.ctx;
	const client = new PterodactylSchedulesClient(opts.ctx.env);

	fastify.get<{ Params: { identifier: string } }>("/:identifier", async (request, reply) => {
		try {
			const schedules = await client.list(request.params.identifier);
			return { schedules };
		} catch (error) {
			return respondPterodactylError(reply, error);
		}
	});

	fastify.post<{ Params: { identifier: string }; Body: z.infer<typeof scheduleBodySchema> }>(
		"/:identifier",
		async (request, reply) => {
			const body = scheduleBodySchema.parse(request.body);
			try {
				const schedule = await client.create(request.params.identifier, body);
				await audit.record({
					actor: "session-user",
					action: "game-server.schedules.create",
					target: `${request.params.identifier}:${body.name}`,
					severity: "info",
				});
				return { schedule };
			} catch (error) {
				return respondPterodactylError(reply, error);
			}
		},
	);

	fastify.patch<{
		Params: { identifier: string; scheduleId: string };
		Body: z.infer<typeof scheduleUpdateBodySchema>;
	}>("/:identifier/:scheduleId", async (request, reply) => {
		const body = scheduleUpdateBodySchema.parse(request.body);
		try {
			const schedule = await client.update(request.params.identifier, Number(request.params.scheduleId), body);
			return { schedule };
		} catch (error) {
			return respondPterodactylError(reply, error);
		}
	});

	fastify.delete<{ Params: { identifier: string; scheduleId: string } }>(
		"/:identifier/:scheduleId",
		async (request, reply) => {
			try {
				await client.remove(request.params.identifier, Number(request.params.scheduleId));
			} catch (error) {
				return respondPterodactylError(reply, error);
			}
			await audit.record({
				actor: "session-user",
				action: "game-server.schedules.delete",
				target: `${request.params.identifier}:${request.params.scheduleId}`,
				severity: "warning",
			});
			return { ok: true };
		},
	);

	fastify.post<{
		Params: { identifier: string; scheduleId: string };
		Body: z.infer<typeof taskBodySchema>;
	}>("/:identifier/:scheduleId/tasks", async (request, reply) => {
		const body = taskBodySchema.parse(request.body);
		try {
			const task = await client.createTask(request.params.identifier, Number(request.params.scheduleId), body);
			return { task };
		} catch (error) {
			return respondPterodactylError(reply, error);
		}
	});

	fastify.patch<{
		Params: { identifier: string; scheduleId: string; taskId: string };
		Body: z.infer<typeof taskUpdateBodySchema>;
	}>("/:identifier/:scheduleId/tasks/:taskId", async (request, reply) => {
		const body = taskUpdateBodySchema.parse(request.body);
		try {
			const task = await client.updateTask(
				request.params.identifier,
				Number(request.params.scheduleId),
				Number(request.params.taskId),
				body,
			);
			return { task };
		} catch (error) {
			return respondPterodactylError(reply, error);
		}
	});

	fastify.delete<{ Params: { identifier: string; scheduleId: string; taskId: string } }>(
		"/:identifier/:scheduleId/tasks/:taskId",
		async (request, reply) => {
			try {
				await client.removeTask(
					request.params.identifier,
					Number(request.params.scheduleId),
					Number(request.params.taskId),
				);
			} catch (error) {
				return respondPterodactylError(reply, error);
			}
			return { ok: true };
		},
	);
};

export default schedulesModule;
