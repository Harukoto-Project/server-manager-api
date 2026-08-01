import type { Env } from "../../config/env.js";
import { PterodactylNotImplementedError } from "./pterodactyl-request.js";

export interface CreateServerInput {
	name: string;
	description?: string;
	userId: number;
	eggId: number;
	dockerImage: string;
	startup: string;
	environment: Record<string, string>;
	limits: { memory: number; swap: number; disk: number; io: number; cpu: number };
	featureLimits: { databases: number; allocations: number; backups: number };
	allocation: { defaultAllocationId?: number; locationIds?: number[]; dedicatedIp?: boolean; portRange?: string[] };
	startOnCompletion: boolean;
}

export interface CreatedServer {
	id: number;
	identifier: string;
	uuid: string;
}

/**
 * 新規サーバーのプロビジョニング(Pterodactyl Application API `POST /api/application/servers`)。
 * Nest/Egg/Node/割り当てリソースを指定して新規サーバーを作成する。
 * 管理者機能ハブの「サーバー作成」カテゴリから使う。
 */
export class PterodactylCreateServerClient {
	constructor(private readonly env: Env) {}

	async create(_input: CreateServerInput): Promise<CreatedServer> {
		throw new PterodactylNotImplementedError("game-servers.createServer.create");
	}
}
