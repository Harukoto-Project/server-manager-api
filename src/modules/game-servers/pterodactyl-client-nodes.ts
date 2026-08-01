import type { Env } from "../../config/env.js";
import { PterodactylNotImplementedError } from "./pterodactyl-request.js";

export interface PterodactylNode {
	id: number;
	name: string;
	locationId: number;
	fqdn: string;
	scheme: string;
	memory: number;
	memoryOverallocate: number;
	disk: number;
	diskOverallocate: number;
	isMaintenanceMode: boolean;
}

export interface PterodactylNodeConfiguration {
	debug: boolean;
	uuid: string;
	tokenId: string;
	remote: string;
	web: { host: string; port: number; ssl: { enabled: boolean } };
}

/**
 * ノード管理(Pterodactyl Application API `nodes.*`権限に対応、閲覧・設定確認のみ)。
 * `/api/application/nodes`系のエンドポイントをラップする。
 * ノード自体の追加/削除はwingsのインストール作業を伴うため、当面は閲覧のみをスコープとする。
 */
export class PterodactylNodesClient {
	constructor(private readonly env: Env) {}

	async list(): Promise<PterodactylNode[]> {
		throw new PterodactylNotImplementedError("game-servers.nodes.list");
	}

	async getDetails(_nodeId: number): Promise<PterodactylNode> {
		throw new PterodactylNotImplementedError("game-servers.nodes.getDetails");
	}

	async getConfiguration(_nodeId: number): Promise<PterodactylNodeConfiguration> {
		throw new PterodactylNotImplementedError("game-servers.nodes.getConfiguration");
	}
}
