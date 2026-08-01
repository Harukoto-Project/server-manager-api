import type { Env } from "../../config/env.js";
import { pterodactylRequest } from "./pterodactyl-request.js";

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
 * サーバー作成フォーム専用の補助データ(ノード一覧)。
 * `game-servers/nodes.ts`(別グループ担当の「ノード管理」機能)とは無関係の、
 * このフォーム内でのノード選択のためだけの簡易情報。
 */
export interface CreateServerNodeOption {
	id: number;
	name: string;
	fqdn: string;
	memoryMb: number;
	memoryOverallocateMb: number;
	diskMb: number;
	diskOverallocateMb: number;
	isMaintenanceMode: boolean;
}

/**
 * サーバー作成フォーム専用の補助データ(ノードの未割り当てアロケーション一覧)。
 * `game-servers/allocations.ts`(別グループ担当の「アロケーション管理」機能)とは無関係。
 */
export interface CreateServerAllocationOption {
	id: number;
	ip: string;
	ipAlias: string | null;
	port: number;
}

interface RawNodeAttributes {
	id: number;
	name: string;
	fqdn: string;
	memory: number;
	memory_overallocate: number;
	disk: number;
	disk_overallocate: number;
	maintenance_mode: boolean;
}

interface RawAllocationAttributes {
	id: number;
	ip: string;
	ip_alias: string | null;
	port: number;
	assigned: boolean;
}

/**
 * 新規サーバーのプロビジョニング(Pterodactyl Application API `POST /api/application/servers`)。
 * Nest/Egg/Node/割り当てリソースを指定して新規サーバーを作成する。
 * 管理者機能ハブの「サーバー作成」カテゴリから使う。
 *
 * リクエストボディの構造は本家Pterodactyl 1.0-developの
 * `StoreServerRequest`(https://github.com/pterodactyl/panel/blob/1.0-develop/app/Http/Requests/Api/Application/Servers/StoreServerRequest.php)
 * を参照して実装している。`deploy`(自動割り当て: locations/dedicated_ip/port_range)を指定した場合は
 * `allocation.default`は不要になるため、`allocation`情報が「自動割り当て向け」か「手動割り当て(defaultAllocationId)」かで
 * リクエストの組み立てを分岐する。
 */
export class PterodactylCreateServerClient {
	constructor(private readonly env: Env) {}

	async create(input: CreateServerInput): Promise<CreatedServer> {
		const body: Record<string, unknown> = {
			name: input.name,
			user: input.userId,
			egg: input.eggId,
			docker_image: input.dockerImage,
			startup: input.startup,
			environment: input.environment,
			limits: {
				memory: input.limits.memory,
				swap: input.limits.swap,
				disk: input.limits.disk,
				io: input.limits.io,
				cpu: input.limits.cpu,
			},
			feature_limits: {
				databases: input.featureLimits.databases,
				allocations: input.featureLimits.allocations,
				backups: input.featureLimits.backups,
			},
			start_on_completion: input.startOnCompletion,
		};

		if (input.description) {
			body.description = input.description;
		}

		const { defaultAllocationId, locationIds, dedicatedIp, portRange } = input.allocation;
		const useAutoDeploy = Boolean((locationIds && locationIds.length > 0) || dedicatedIp || (portRange && portRange.length > 0));
		if (useAutoDeploy) {
			body.deploy = {
				locations: locationIds ?? [],
				dedicated_ip: dedicatedIp ?? false,
				port_range: portRange ?? [],
			};
		} else {
			body.allocation = { default: defaultAllocationId };
		}

		const response = await pterodactylRequest<{ attributes: { id: number; identifier: string; uuid: string } }>(
			this.env,
			"application",
			"/api/application/servers",
			{ method: "POST", body: JSON.stringify(body) },
		);

		return { id: response.attributes.id, identifier: response.attributes.identifier, uuid: response.attributes.uuid };
	}

	/** サーバー作成フォームの「ノード選択」用の簡易ノード一覧(閲覧のみ) */
	async listNodes(): Promise<CreateServerNodeOption[]> {
		const data = await pterodactylRequest<{ data: Array<{ attributes: RawNodeAttributes }> }>(
			this.env,
			"application",
			"/api/application/nodes?per_page=100",
		);
		return data.data.map((entry) => ({
			id: entry.attributes.id,
			name: entry.attributes.name,
			fqdn: entry.attributes.fqdn,
			memoryMb: entry.attributes.memory,
			memoryOverallocateMb: entry.attributes.memory_overallocate,
			diskMb: entry.attributes.disk,
			diskOverallocateMb: entry.attributes.disk_overallocate,
			isMaintenanceMode: entry.attributes.maintenance_mode,
		}));
	}

	/** サーバー作成フォームの「アロケーション選択」用に、指定ノードの未割り当てアロケーションのみを返す */
	async listNodeAllocations(nodeId: number): Promise<CreateServerAllocationOption[]> {
		const data = await pterodactylRequest<{ data: Array<{ attributes: RawAllocationAttributes }> }>(
			this.env,
			"application",
			`/api/application/nodes/${nodeId}/allocations?per_page=100`,
		);
		return data.data
			.filter((entry) => !entry.attributes.assigned)
			.map((entry) => ({
				id: entry.attributes.id,
				ip: entry.attributes.ip,
				ipAlias: entry.attributes.ip_alias,
				port: entry.attributes.port,
			}));
	}
}
