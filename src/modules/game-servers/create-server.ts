import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { ApiModuleContext } from "../types.js";
import { PterodactylCreateServerClient } from "./pterodactyl-client-create-server.js";
import { respondPterodactylError } from "./pterodactyl-request.js";

const createServerBodySchema = z.object({
	name: z.string().trim().min(1),
	description: z.string().optional(),
	userId: z.number().int().positive(),
	eggId: z.number().int().positive(),
	dockerImage: z.string().trim().min(1),
	startup: z.string().trim().min(1),
	environment: z.record(z.string(), z.string()).default({}),
	limits: z.object({
		memory: z.number().int().min(0),
		swap: z.number().int().min(-1),
		disk: z.number().int().min(0),
		io: z.number().int().min(10).max(1000),
		cpu: z.number().int().min(0),
	}),
	featureLimits: z.object({
		databases: z.number().int().min(0),
		allocations: z.number().int().min(0),
		backups: z.number().int().min(0),
	}),
	allocation: z.object({
		defaultAllocationId: z.number().int().positive().optional(),
		locationIds: z.array(z.number().int().positive()).optional(),
		dedicatedIp: z.boolean().optional(),
		portRange: z.array(z.string()).optional(),
	}),
	startOnCompletion: z.boolean().default(true),
});

/**
 * 管理者機能ハブの「サーバー作成」カテゴリに対応するAPI。
 * ロジック本体は`pterodactyl-client-create-server.ts`の`PterodactylCreateServerClient`に実装する。
 * Nest/Egg一覧の取得は`nests-eggs.ts`側のエンドポイントを利用する想定。
 *
 * `/nodes`, `/nodes/:nodeId/allocations`はサーバー作成フォーム専用の補助エンドポイント。
 * 別グループが並行実装する「ノード管理」(`nodes.ts`)・「アロケーション管理」(`allocations.ts`)とは
 * 依存を避けるため独立しており、機能重複を許容している(詳細は`pterodactyl-client-create-server.ts`参照)。
 */
const createServerModule: FastifyPluginAsync<{ ctx: ApiModuleContext }> = async (fastify, opts) => {
	const { audit } = opts.ctx;
	const client = new PterodactylCreateServerClient(opts.ctx.env);

	fastify.get("/nodes", async (_request, reply) => {
		try {
			const nodes = await client.listNodes();
			return { nodes };
		} catch (error) {
			return respondPterodactylError(reply, error);
		}
	});

	fastify.get<{ Params: { nodeId: string } }>("/nodes/:nodeId/allocations", async (request, reply) => {
		try {
			const allocations = await client.listNodeAllocations(Number(request.params.nodeId));
			return { allocations };
		} catch (error) {
			return respondPterodactylError(reply, error);
		}
	});

	fastify.post<{ Body: z.infer<typeof createServerBodySchema> }>("/", async (request, reply) => {
		const body = createServerBodySchema.parse(request.body);
		try {
			const server = await client.create(body);
			await audit.record({
				actor: "session-user",
				action: "game-server.create",
				target: body.name,
				severity: "warning",
			});
			return { server };
		} catch (error) {
			return respondPterodactylError(reply, error);
		}
	});
};

export default createServerModule;
