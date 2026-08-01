import type { Env } from "../../config/env.js";
import { pterodactylRequest } from "./pterodactyl-request.js";

export interface PterodactylMount {
	id: number;
	name: string;
	description: string | null;
	source: string;
	target: string;
	readOnly: boolean;
}

export interface PterodactylRole {
	id: number;
	name: string;
	description: string | null;
	permissions: string[];
}

/** 一覧取得結果。`available: false`はこのPterodactylバージョン/フォークにそもそもエンドポイントが存在しないことを表す */
export interface PterodactylMountsListResult {
	available: boolean;
	mounts: PterodactylMount[];
}

export interface PterodactylRolesListResult {
	available: boolean;
	roles: PterodactylRole[];
}

interface RawMountAttributes {
	id: number;
	name: string;
	description: string | null;
	source: string;
	target: string;
	read_only: boolean;
}

interface RawRoleAttributes {
	id: number;
	name: string;
	description?: string | null;
	permissions?: string[];
}

function mapMount(attrs: RawMountAttributes): PterodactylMount {
	return {
		id: attrs.id,
		name: attrs.name,
		description: attrs.description,
		source: attrs.source,
		target: attrs.target,
		readOnly: attrs.read_only,
	};
}

function mapRole(attrs: RawRoleAttributes): PterodactylRole {
	return {
		id: attrs.id,
		name: attrs.name,
		description: attrs.description ?? null,
		permissions: attrs.permissions ?? [],
	};
}

/**
 * `pterodactylRequest`が投げるエラー(`Pterodactyl API error: ${status} ...`形式)から
 * 「そもそもこのパネルにエンドポイントが存在しない」ケース(404/405)かどうかを判定する。
 * 標準のPterodactyl Panel(1.0-develop時点)にはApplication APIの`/mounts`・`/roles`
 * コントローラー自体が存在しないため、フォークやバージョンによっては常にこの分岐に入る想定。
 */
function isEndpointUnavailable(error: unknown): boolean {
	return error instanceof Error && /Pterodactyl API error: (404|405)\b/.test(error.message);
}

/**
 * マウント管理(Application API `mounts.*`)とAdminロール管理をまとめて扱うクライアント。
 * `/api/application/mounts`系のエンドポイントをラップする。
 * ロール(Admin Roles)はPterodactylパネルのバージョンによりApplication APIでの
 * 公開状況が異なるため、404/405の場合は`available: false`を返し呼び出し元でフォールバック表示する。
 */
export class PterodactylMountsRolesClient {
	constructor(private readonly env: Env) {}

	async listMounts(): Promise<PterodactylMountsListResult> {
		try {
			const data = await pterodactylRequest<{ data: Array<{ attributes: RawMountAttributes }> }>(
				this.env,
				"application",
				"/api/application/mounts",
			);
			return { available: true, mounts: data.data.map((entry) => mapMount(entry.attributes)) };
		} catch (error) {
			if (isEndpointUnavailable(error)) return { available: false, mounts: [] };
			throw error;
		}
	}

	async createMount(
		input: { name: string; description: string; source: string; target: string; readOnly: boolean },
	): Promise<PterodactylMount> {
		const data = await pterodactylRequest<{ attributes: RawMountAttributes }>(
			this.env,
			"application",
			"/api/application/mounts",
			{
				method: "POST",
				body: JSON.stringify({
					name: input.name,
					description: input.description,
					source: input.source,
					target: input.target,
					read_only: input.readOnly,
				}),
			},
		);
		return mapMount(data.attributes);
	}

	async removeMount(mountId: number): Promise<void> {
		await pterodactylRequest(this.env, "application", `/api/application/mounts/${mountId}`, { method: "DELETE" });
	}

	async listRoles(): Promise<PterodactylRolesListResult> {
		try {
			const data = await pterodactylRequest<{ data: Array<{ attributes: RawRoleAttributes }> }>(
				this.env,
				"application",
				"/api/application/roles",
			);
			return { available: true, roles: data.data.map((entry) => mapRole(entry.attributes)) };
		} catch (error) {
			if (isEndpointUnavailable(error)) return { available: false, roles: [] };
			throw error;
		}
	}
}
