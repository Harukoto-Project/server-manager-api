import type { Env } from "../../config/env.js";
import { PterodactylNotImplementedError } from "./pterodactyl-request.js";

export interface PterodactylSubuser {
	uuid: string;
	email: string;
	username: string | null;
	image: string | null;
	twoFactorEnabled: boolean;
	permissions: string[];
}

/**
 * サーバーごとの共同管理者(サブユーザー)管理(Pterodactyl Client API `user.*`権限に対応)。
 * `/api/client/servers/{server}/users`系のエンドポイントをラップする。
 */
export class PterodactylSubusersClient {
	constructor(private readonly env: Env) {}

	async list(_identifier: string): Promise<PterodactylSubuser[]> {
		throw new PterodactylNotImplementedError("game-servers.subusers.list");
	}

	async invite(_identifier: string, _email: string, _permissions: string[]): Promise<PterodactylSubuser> {
		throw new PterodactylNotImplementedError("game-servers.subusers.invite");
	}

	async updatePermissions(_identifier: string, _subuserUuid: string, _permissions: string[]): Promise<PterodactylSubuser> {
		throw new PterodactylNotImplementedError("game-servers.subusers.updatePermissions");
	}

	async remove(_identifier: string, _subuserUuid: string): Promise<void> {
		throw new PterodactylNotImplementedError("game-servers.subusers.remove");
	}
}
