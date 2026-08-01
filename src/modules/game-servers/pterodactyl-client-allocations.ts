import type { Env } from "../../config/env.js";
import { PterodactylNotImplementedError } from "./pterodactyl-request.js";

export interface PterodactylNodeAllocation {
	id: number;
	ip: string;
	ipAlias: string | null;
	port: number;
	notes: string | null;
	assigned: boolean;
}

/**
 * ノードごとのIPアドレス/ポート割り当て管理(Pterodactyl Application API `allocations.*`権限に対応)。
 * `/api/application/nodes/{node}/allocations`系のエンドポイントをラップする。
 * サーバー個別のアロケーション管理(Client API)は`pterodactyl-client-network.ts`が担当する。
 */
export class PterodactylAllocationsClient {
	constructor(private readonly env: Env) {}

	async list(_nodeId: number): Promise<PterodactylNodeAllocation[]> {
		throw new PterodactylNotImplementedError("game-servers.allocations.list");
	}

	async create(_nodeId: number, _ip: string, _ports: string[], _alias?: string): Promise<PterodactylNodeAllocation[]> {
		throw new PterodactylNotImplementedError("game-servers.allocations.create");
	}

	async remove(_nodeId: number, _allocationId: number): Promise<void> {
		throw new PterodactylNotImplementedError("game-servers.allocations.remove");
	}
}
