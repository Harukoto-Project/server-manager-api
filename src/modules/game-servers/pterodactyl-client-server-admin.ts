import type { Env } from "../../config/env.js";
import { PterodactylNotImplementedError } from "./pterodactyl-request.js";

export interface PterodactylServerDetails {
	id: number;
	identifier: string;
	uuid: string;
	name: string;
	description: string | null;
	userId: number;
	nodeId: number;
	limits: { memory: number; swap: number; disk: number; io: number; cpu: number };
	featureLimits: { databases: number; allocations: number; backups: number };
}

/**
 * パネル管理者としてのサーバー管理(Pterodactyl Application API `servers.*`権限に対応)。
 * `/api/application/servers/{id}`系のエンドポイントをラップする。
 * サーバー詳細ページの「サーバー管理」タブ(詳細編集/ビルド設定/再インストール/凍結/削除)から使う。
 * サーバーの作成自体は`pterodactyl-client-create-server.ts`が担当する。
 */
export class PterodactylServerAdminClient {
	constructor(private readonly env: Env) {}

	async getDetails(_identifier: string): Promise<PterodactylServerDetails> {
		throw new PterodactylNotImplementedError("game-servers.serverAdmin.getDetails");
	}

	async updateDetails(
		_identifier: string,
		_input: Partial<{ name: string; description: string; userId: number }>,
	): Promise<PterodactylServerDetails> {
		throw new PterodactylNotImplementedError("game-servers.serverAdmin.updateDetails");
	}

	async updateBuild(
		_identifier: string,
		_input: Partial<{
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
		throw new PterodactylNotImplementedError("game-servers.serverAdmin.updateBuild");
	}

	async reinstall(_identifier: string): Promise<void> {
		throw new PterodactylNotImplementedError("game-servers.serverAdmin.reinstall");
	}

	async suspend(_identifier: string): Promise<void> {
		throw new PterodactylNotImplementedError("game-servers.serverAdmin.suspend");
	}

	async unsuspend(_identifier: string): Promise<void> {
		throw new PterodactylNotImplementedError("game-servers.serverAdmin.unsuspend");
	}

	async remove(_identifier: string, _force: boolean): Promise<void> {
		throw new PterodactylNotImplementedError("game-servers.serverAdmin.remove");
	}
}
