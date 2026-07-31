import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { ApiModuleContext } from "../types.js";
import { ProcessManager } from "./manager.js";

const registerSchema = z.object({
	name: z.string().min(1),
	kind: z.enum(["node", "python", "custom"]),
	cwd: z.string().min(1),
	command: z.string().min(1),
	args: z.array(z.string()).default([]),
	env: z.record(z.string()).default({}),
	autoStart: z.boolean().default(false),
});

/**
 * Node.js/Pythonプロジェクト管理モジュール(Pterodactylに影響を受けた軽量プロセスマネージャ)。
 * WebSocketでコンソール(stdout/stderr)をリアルタイム配信する。
 */
const processManagerModule: FastifyPluginAsync<{ ctx: ApiModuleContext }> = async (fastify, opts) => {
	const { audit } = opts.ctx;
	const manager = new ProcessManager();
	await manager.init();

	fastify.get("/projects", async () => ({ projects: manager.list() }));

	fastify.post("/projects", async (request) => {
		const body = registerSchema.parse(request.body);
		const id = randomUUID();
		await manager.register({ id, ...body });
		if (body.autoStart) manager.start(id);
		return { id };
	});

	fastify.delete<{ Params: { id: string } }>("/projects/:id", async (request) => {
		await manager.remove(request.params.id);
		return { ok: true };
	});

	fastify.post<{ Params: { id: string } }>("/projects/:id/start", async (request) => {
		manager.start(request.params.id);
		await audit.record({ actor: "session-user", action: "process.start", target: request.params.id });
		return { ok: true };
	});

	fastify.post<{ Params: { id: string } }>("/projects/:id/stop", async (request) => {
		manager.stop(request.params.id);
		await audit.record({ actor: "session-user", action: "process.stop", target: request.params.id });
		return { ok: true };
	});

	fastify.post<{ Params: { id: string } }>("/projects/:id/restart", async (request) => {
		manager.restart(request.params.id);
		await audit.record({ actor: "session-user", action: "process.restart", target: request.params.id });
		return { ok: true };
	});

	fastify.get<{ Params: { id: string } }>("/projects/:id/console", { websocket: true }, (socket, request) => {
		manager.subscribe(request.params.id, socket);
	});
};

export default processManagerModule;
