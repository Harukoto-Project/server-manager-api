import type { Env } from "../../config/env.js";
import { PterodactylNotImplementedError } from "./pterodactyl-request.js";

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

/**
 * マウント管理(Application API `mounts.*`)とAdminロール管理をまとめて扱うクライアント。
 * `/api/application/mounts`系のエンドポイントをラップする。
 * ロール(Admin Roles)はPterodactylパネルのバージョンによりApplication APIでの
 * 公開状況が異なるため、実装時はMCPツール(list_roles等)の挙動を参考に要検証。
 */
export class PterodactylMountsRolesClient {
	constructor(private readonly env: Env) {}

	async listMounts(): Promise<PterodactylMount[]> {
		throw new PterodactylNotImplementedError("game-servers.mountsRoles.listMounts");
	}

	async createMount(
		_input: { name: string; description: string; source: string; target: string; readOnly: boolean },
	): Promise<PterodactylMount> {
		throw new PterodactylNotImplementedError("game-servers.mountsRoles.createMount");
	}

	async removeMount(_mountId: number): Promise<void> {
		throw new PterodactylNotImplementedError("game-servers.mountsRoles.removeMount");
	}

	async listRoles(): Promise<PterodactylRole[]> {
		throw new PterodactylNotImplementedError("game-servers.mountsRoles.listRoles");
	}
}
