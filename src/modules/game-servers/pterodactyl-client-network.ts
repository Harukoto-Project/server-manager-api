import type { Env } from "../../config/env.js";
import { PterodactylNotImplementedError } from "./pterodactyl-request.js";

export interface PterodactylServerAllocation {
	id: number;
	ip: string;
	ipAlias: string | null;
	port: number;
	notes: string | null;
	isDefault: boolean;
}

/**
 * サーバーごとのネットワーク(アロケーション)管理(Pterodactyl Client API `allocation.*`権限に対応)。
 * `/api/client/servers/{server}/network/allocations`系のエンドポイントをラップする。
 * パネル全体のIP/ポート払い出し(ノードへのアロケーション追加)は
 * `pterodactyl-client-allocations.ts`(管理者機能ハブ側、Application API)が担当する。
 */
export class PterodactylServerNetworkClient {
	constructor(private readonly env: Env) {}

	async list(_identifier: string): Promise<PterodactylServerAllocation[]> {
		throw new PterodactylNotImplementedError("game-servers.network.list");
	}

	async assign(_identifier: string): Promise<PterodactylServerAllocation> {
		throw new PterodactylNotImplementedError("game-servers.network.assign");
	}

	async setNotes(_identifier: string, _allocationId: number, _notes: string): Promise<PterodactylServerAllocation> {
		throw new PterodactylNotImplementedError("game-servers.network.setNotes");
	}

	async setPrimary(_identifier: string, _allocationId: number): Promise<void> {
		throw new PterodactylNotImplementedError("game-servers.network.setPrimary");
	}

	async unassign(_identifier: string, _allocationId: number): Promise<void> {
		throw new PterodactylNotImplementedError("game-servers.network.unassign");
	}
}
