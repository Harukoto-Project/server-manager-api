import type { Env } from "../../config/env.js";
import { pterodactylRequest } from "./pterodactyl-request.js";

export interface PterodactylNode {
	id: number;
	uuid: string;
	name: string;
	description: string | null;
	locationId: number;
	fqdn: string;
	scheme: string;
	isMaintenanceMode: boolean;
	memory: number;
	memoryOverallocate: number;
	disk: number;
	diskOverallocate: number;
	/** 割り当て済みのメモリ/ディスク量(MB)。`allocated_resources`から取得 */
	allocatedMemory: number;
	allocatedDisk: number;
}

export interface PterodactylNodeConfiguration {
	debug: boolean;
	uuid: string;
	tokenId: string;
	remote: string;
	api: { host: string; port: number; ssl: { enabled: boolean } };
	system: { dataDirectory: string; sftpBindPort: number };
	allowedMounts: string[];
}

interface RawNodeAttributes {
	id: number;
	uuid: string;
	name: string;
	description: string | null;
	location_id: number;
	fqdn: string;
	scheme: string;
	maintenance_mode: boolean;
	memory: number;
	memory_overallocate: number;
	disk: number;
	disk_overallocate: number;
	allocated_resources?: { memory: number; disk: number };
}

interface RawNodeConfiguration {
	debug: boolean;
	uuid: string;
	token_id: string;
	/** wingsデーモンの起動トークン本体。パネル管理者以外に露出させたくないため、この型からは意図的に除外して扱う */
	token?: string;
	api: { host: string; port: number; ssl: { enabled: boolean } };
	system: { data: string; sftp: { bind_port: number } };
	allowed_mounts?: string[];
	remote: string;
}

function mapNode(attrs: RawNodeAttributes): PterodactylNode {
	return {
		id: attrs.id,
		uuid: attrs.uuid,
		name: attrs.name,
		description: attrs.description,
		locationId: attrs.location_id,
		fqdn: attrs.fqdn,
		scheme: attrs.scheme,
		isMaintenanceMode: attrs.maintenance_mode,
		memory: attrs.memory,
		memoryOverallocate: attrs.memory_overallocate,
		disk: attrs.disk,
		diskOverallocate: attrs.disk_overallocate,
		allocatedMemory: attrs.allocated_resources?.memory ?? 0,
		allocatedDisk: attrs.allocated_resources?.disk ?? 0,
	};
}

/**
 * ノード管理(Pterodactyl Application API `nodes.*`権限に対応、閲覧・設定確認のみ)。
 * `/api/application/nodes`系のエンドポイントをラップする。
 * ノード自体の追加/削除はwingsのインストール作業を伴うため、当面は閲覧のみをスコープとする。
 */
export class PterodactylNodesClient {
	constructor(private readonly env: Env) {}

	async list(): Promise<PterodactylNode[]> {
		const data = await pterodactylRequest<{ data: Array<{ attributes: RawNodeAttributes }> }>(
			this.env,
			"application",
			"/api/application/nodes",
		);
		return data.data.map((entry) => mapNode(entry.attributes));
	}

	async getDetails(nodeId: number): Promise<PterodactylNode> {
		const data = await pterodactylRequest<{ attributes: RawNodeAttributes }>(
			this.env,
			"application",
			`/api/application/nodes/${nodeId}`,
		);
		return mapNode(data.attributes);
	}

	/**
	 * wingsデーモンの設定情報を取得する。生のレスポンスには`token`(デーモン起動トークン本体)が
	 * 含まれるが、機密性が高いためクライアントには一切返さない(`tokenId`のみ返す)。
	 */
	async getConfiguration(nodeId: number): Promise<PterodactylNodeConfiguration> {
		const data = await pterodactylRequest<RawNodeConfiguration>(
			this.env,
			"application",
			`/api/application/nodes/${nodeId}/configuration`,
		);
		return {
			debug: data.debug,
			uuid: data.uuid,
			tokenId: data.token_id,
			remote: data.remote,
			api: { host: data.api.host, port: data.api.port, ssl: { enabled: data.api.ssl.enabled } },
			system: { dataDirectory: data.system.data, sftpBindPort: data.system.sftp.bind_port },
			allowedMounts: data.allowed_mounts ?? [],
		};
	}
}
