import type { Env } from "../../config/env.js";
import { pterodactylRequest } from "./pterodactyl-request.js";

export interface PterodactylServerDetails {
	id: number;
	identifier: string;
	uuid: string;
	name: string;
	description: string | null;
	suspended: boolean;
	userId: number;
	nodeId: number;
	limits: { memory: number; swap: number; disk: number; io: number; cpu: number };
	featureLimits: { databases: number; allocations: number; backups: number };
}

interface PterodactylServerListEntryAttributes {
	id: number;
	identifier: string;
}

interface PterodactylServerAttributes {
	id: number;
	uuid: string;
	identifier: string;
	name: string;
	description: string | null;
	suspended: boolean;
	user: number;
	node: number;
	allocation: number;
	limits: { memory: number; swap: number; disk: number; io: number; cpu: number };
	feature_limits: { databases: number; allocations: number; backups: number };
}

function toServerDetails(attrs: PterodactylServerAttributes): PterodactylServerDetails {
	return {
		id: attrs.id,
		identifier: attrs.identifier,
		uuid: attrs.uuid,
		name: attrs.name,
		description: attrs.description,
		suspended: attrs.suspended,
		userId: attrs.user,
		nodeId: attrs.node,
		limits: {
			memory: attrs.limits.memory,
			swap: attrs.limits.swap,
			disk: attrs.limits.disk,
			io: attrs.limits.io,
			cpu: attrs.limits.cpu,
		},
		featureLimits: {
			databases: attrs.feature_limits.databases,
			allocations: attrs.feature_limits.allocations,
			backups: attrs.feature_limits.backups,
		},
	};
}

/**
 * パネル管理者としてのサーバー管理(Pterodactyl Application API `servers.*`権限に対応)。
 * `/api/application/servers/{id}`系のエンドポイントをラップする。
 * サーバー詳細ページの「サーバー管理」タブ(詳細編集/ビルド設定/再インストール/凍結/削除)から使う。
 * サーバーの作成自体は`pterodactyl-client-create-server.ts`が担当する。
 */
export class PterodactylServerAdminClient {
	constructor(private readonly env: Env) {}

	/**
	 * Application APIのサーバー個別操作は内部ID(数値)を要求する一方、
	 * ルート側は他のClient API系機能と統一するためidentifier(短い英数字)を受け取る。
	 * Application APIにはidentifierによる直接検索手段が無いため、サーバー一覧を
	 * ページングしながら該当するidentifierを探して内部IDへ変換する。
	 */
	private async resolveInternalId(identifier: string): Promise<number> {
		const perPage = 100;
		const maxPages = 20;
		for (let page = 1; page <= maxPages; page++) {
			const data = await pterodactylRequest<{
				data: Array<{ attributes: PterodactylServerListEntryAttributes }>;
				meta: { pagination: { total_pages: number } };
			}>(this.env, "application", `/api/application/servers?page=${page}&per_page=${perPage}`);
			const match = data.data.find((entry) => entry.attributes.identifier === identifier);
			if (match) return match.attributes.id;
			if (page >= data.meta.pagination.total_pages) break;
		}
		throw new Error(`サーバーが見つかりません(identifier: ${identifier})`);
	}

	private async fetchAttributes(serverId: number): Promise<PterodactylServerAttributes> {
		const data = await pterodactylRequest<{ attributes: PterodactylServerAttributes }>(
			this.env,
			"application",
			`/api/application/servers/${serverId}`,
		);
		return data.attributes;
	}

	async getDetails(identifier: string): Promise<PterodactylServerDetails> {
		const serverId = await this.resolveInternalId(identifier);
		return toServerDetails(await this.fetchAttributes(serverId));
	}

	async updateDetails(
		identifier: string,
		input: Partial<{ name: string; description: string; userId: number }>,
	): Promise<PterodactylServerDetails> {
		const serverId = await this.resolveInternalId(identifier);
		const data = await pterodactylRequest<{ attributes: PterodactylServerAttributes }>(
			this.env,
			"application",
			`/api/application/servers/${serverId}/details`,
			{
				method: "PATCH",
				body: JSON.stringify({
					...(input.name !== undefined ? { name: input.name } : {}),
					...(input.description !== undefined ? { description: input.description } : {}),
					...(input.userId !== undefined ? { user: input.userId } : {}),
				}),
			},
		);
		return toServerDetails(data.attributes);
	}

	/**
	 * `/build`エンドポイントは仕様上、allocation/memory/swap/disk/io/cpuの全項目を
	 * 毎回送る必要がある(未指定項目があると意図せず0/nullに巻き戻る場合があるため)。
	 * そのため更新前に現在値を取得し、指定が無かった項目は現在値で埋めて送信する。
	 */
	async updateBuild(
		identifier: string,
		input: Partial<{
			memory: number;
			swap: number;
			disk: number;
			io: number;
			cpu: number;
			databases: number;
			allocations: number;
			backups: number;
		}>,
	): Promise<PterodactylServerDetails> {
		const serverId = await this.resolveInternalId(identifier);
		const current = await this.fetchAttributes(serverId);
		const data = await pterodactylRequest<{ attributes: PterodactylServerAttributes }>(
			this.env,
			"application",
			`/api/application/servers/${serverId}/build`,
			{
				method: "PATCH",
				body: JSON.stringify({
					allocation: current.allocation,
					memory: input.memory ?? current.limits.memory,
					swap: input.swap ?? current.limits.swap,
					disk: input.disk ?? current.limits.disk,
					io: input.io ?? current.limits.io,
					cpu: input.cpu ?? current.limits.cpu,
					feature_limits: {
						databases: input.databases ?? current.feature_limits.databases,
						allocations: input.allocations ?? current.feature_limits.allocations,
						backups: input.backups ?? current.feature_limits.backups,
					},
				}),
			},
		);
		return toServerDetails(data.attributes);
	}

	async reinstall(identifier: string): Promise<void> {
		const serverId = await this.resolveInternalId(identifier);
		await pterodactylRequest(this.env, "application", `/api/application/servers/${serverId}/reinstall`, {
			method: "POST",
		});
	}

	async suspend(identifier: string): Promise<void> {
		const serverId = await this.resolveInternalId(identifier);
		await pterodactylRequest(this.env, "application", `/api/application/servers/${serverId}/suspend`, {
			method: "POST",
		});
	}

	async unsuspend(identifier: string): Promise<void> {
		const serverId = await this.resolveInternalId(identifier);
		await pterodactylRequest(this.env, "application", `/api/application/servers/${serverId}/unsuspend`, {
			method: "POST",
		});
	}

	async remove(identifier: string, force: boolean): Promise<void> {
		const serverId = await this.resolveInternalId(identifier);
		const path = force ? `/api/application/servers/${serverId}/force` : `/api/application/servers/${serverId}`;
		await pterodactylRequest(this.env, "application", path, { method: "DELETE" });
	}
}
