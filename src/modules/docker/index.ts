import Docker from "dockerode";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { ApiModuleContext } from "../types.js";

const actionSchema = z.object({
	action: z.enum(["start", "stop", "restart"]),
});

/**
 * Dockerコンテナ/イメージ/ボリューム/ネットワーク管理モジュール(Notion「Dockerモジュールの深掘り」対応)。
 * dockerode経由でDockerソケットを操作する。将来的にはグループ直接付与ではなく
 * 薄いラッパー経由に絞る対策を検討する(Notion「セキュリティ設計」参照)。
 */
const dockerModule: FastifyPluginAsync<{ ctx: ApiModuleContext }> = async (fastify, opts) => {
	const { audit } = opts.ctx;
	const docker = new Docker({ socketPath: opts.ctx.env.DOCKER_SOCKET_PATH });

	fastify.get("/containers", async () => {
		const containers = await docker.listContainers({ all: true });
		return containers.map((c) => ({
			id: c.Id,
			names: c.Names,
			image: c.Image,
			state: c.State,
			status: c.Status,
			ports: c.Ports,
		}));
	});

	fastify.post<{ Params: { id: string }; Body: z.infer<typeof actionSchema> }>(
		"/containers/:id/action",
		async (request, reply) => {
			const { action } = actionSchema.parse(request.body);
			const container = docker.getContainer(request.params.id);

			try {
				if (action === "start") await container.start();
				if (action === "stop") await container.stop();
				if (action === "restart") await container.restart();
			} catch (error) {
				return reply.code(500).send({ error: (error as Error).message });
			}

			await audit.record({
				actor: "session-user",
				action: `docker.container.${action}`,
				target: request.params.id,
				severity: "warning",
			});

			return { ok: true };
		},
	);

	fastify.get("/containers/:id/logs", async (request) => {
		const { id } = request.params as { id: string };
		const container = docker.getContainer(id);
		const buffer = (await container.logs({
			stdout: true,
			stderr: true,
			tail: 500,
		})) as unknown as Buffer;
		return { logs: buffer.toString("utf8") };
	});

	fastify.get("/images", async () => {
		const images = await docker.listImages();
		return images.map((i) => ({
			id: i.Id,
			tags: i.RepoTags,
			sizeBytes: i.Size,
		}));
	});

	fastify.get("/volumes", async () => {
		const { Volumes } = await docker.listVolumes();
		return (Volumes ?? []).map((v) => ({ name: v.Name, driver: v.Driver, mountpoint: v.Mountpoint }));
	});

	fastify.get("/networks", async () => {
		const networks = await docker.listNetworks();
		return networks.map((n) => ({ id: n.Id, name: n.Name, driver: n.Driver, scope: n.Scope }));
	});
};

export default dockerModule;
