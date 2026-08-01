import type { Env } from "../../config/env.js";
import { pterodactylRequest } from "./pterodactyl-request.js";

export interface PterodactylNodeAllocation {
	id: number;
	ip: string;
	ipAlias: string | null;
	port: number;
	notes: string | null;
	assigned: boolean;
}

interface RawAllocationAttributes {
	id: number;
	ip: string;
	ip_alias: string | null;
	port: number;
	notes: string | null;
	assigned: boolean;
}

function mapAllocation(attrs: RawAllocationAttributes): PterodactylNodeAllocation {
	return {
		id: attrs.id,
		ip: attrs.ip,
		ipAlias: attrs.ip_alias,
		port: attrs.port,
		notes: attrs.notes,
		assigned: attrs.assigned,
	};
}

/**
 * ノードごとのIPアドレス/ポート割り当て管理(Pterodactyl Application API `allocations.*`権限に対応)。
 * `/api/application/nodes/{node}/allocations`系のエンドポイントをラップする。
 * サーバー個別のアロケーション管理(Client API)は`pterodactyl-client-network.ts`が担当する。
 */
export class PterodactylAllocationsClient {
	constructor(private readonly env: Env) {}

	async list(nodeId: number): Promise<PterodactylNodeAllocation[]> {
		const data = await pterodactylRequest<{ data: Array<{ attributes: RawAllocationAttributes }> }>(
			this.env,
			"application",
			`/api/application/nodes/${nodeId}/allocations`,
		);
		return data.data.map((entry) => mapAllocation(entry.attributes));
	}

	/**
	 * 割り当ての作成(`AllocationController@store`)はPterodactyl本体では204 No Contentを返すのみで、
	 * 作成後のアロケーション一覧は返ってこない。そのため作成後に改めて一覧を取得し直す。
	 */
	async create(nodeId: number, ip: string, ports: string[], alias?: string): Promise<PterodactylNodeAllocation[]> {
		await pterodactylRequest(this.env, "application", `/api/application/nodes/${nodeId}/allocations`, {
			method: "POST",
			body: JSON.stringify({ ip, ports, ...(alias ? { alias } : {}) }),
		});
		return this.list(nodeId);
	}

	async remove(nodeId: number, allocationId: number): Promise<void> {
		await pterodactylRequest(this.env, "application", `/api/application/nodes/${nodeId}/allocations/${allocationId}`, {
			method: "DELETE",
		});
	}
}
