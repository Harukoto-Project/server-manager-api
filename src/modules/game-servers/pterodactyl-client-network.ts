import type { Env } from "../../config/env.js";
import { pterodactylRequest } from "./pterodactyl-request.js";

export interface PterodactylServerAllocation {
	id: number;
	ip: string;
	ipAlias: string | null;
	port: number;
	notes: string | null;
	isDefault: boolean;
}

interface RawAllocationAttributes {
	id: number;
	ip: string;
	ip_alias: string | null;
	port: number;
	notes: string | null;
	is_default: boolean;
}

function toAllocation(attrs: RawAllocationAttributes): PterodactylServerAllocation {
	return {
		id: attrs.id,
		ip: attrs.ip,
		ipAlias: attrs.ip_alias,
		port: attrs.port,
		notes: attrs.notes,
		isDefault: attrs.is_default,
	};
}

/**
 * サーバーごとのネットワーク(アロケーション)管理(Pterodactyl Client API `allocation.*`権限に対応)。
 * `/api/client/servers/{server}/network/allocations`系のエンドポイントをラップする。
 * パネル全体のIP/ポート払い出し(ノードへのアロケーション追加)は
 * `pterodactyl-client-allocations.ts`(管理者機能ハブ側、Application API)が担当する。
 */
export class PterodactylServerNetworkClient {
	constructor(private readonly env: Env) {}

	async list(identifier: string): Promise<PterodactylServerAllocation[]> {
		const data = await pterodactylRequest<{ data: Array<{ attributes: RawAllocationAttributes }> }>(
			this.env,
			"client",
			`/api/client/servers/${identifier}/network/allocations`,
		);
		return data.data.map((entry) => toAllocation(entry.attributes));
	}

	async assign(identifier: string): Promise<PterodactylServerAllocation> {
		const data = await pterodactylRequest<{ attributes: RawAllocationAttributes }>(
			this.env,
			"client",
			`/api/client/servers/${identifier}/network/allocations`,
			{ method: "POST" },
		);
		return toAllocation(data.attributes);
	}

	async setNotes(identifier: string, allocationId: number, notes: string): Promise<PterodactylServerAllocation> {
		const data = await pterodactylRequest<{ attributes: RawAllocationAttributes }>(
			this.env,
			"client",
			`/api/client/servers/${identifier}/network/allocations/${allocationId}`,
			{ method: "POST", body: JSON.stringify({ notes }) },
		);
		return toAllocation(data.attributes);
	}

	async setPrimary(identifier: string, allocationId: number): Promise<void> {
		await pterodactylRequest(
			this.env,
			"client",
			`/api/client/servers/${identifier}/network/allocations/${allocationId}/primary`,
			{ method: "POST" },
		);
	}

	async unassign(identifier: string, allocationId: number): Promise<void> {
		await pterodactylRequest(
			this.env,
			"client",
			`/api/client/servers/${identifier}/network/allocations/${allocationId}`,
			{ method: "DELETE" },
		);
	}
}
