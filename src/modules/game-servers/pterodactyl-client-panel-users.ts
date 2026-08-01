import type { Env } from "../../config/env.js";
import { PterodactylNotImplementedError } from "./pterodactyl-request.js";

export interface PterodactylPanelUser {
	id: number;
	externalId: string | null;
	uuid: string;
	username: string;
	email: string;
	firstName: string;
	lastName: string;
	isRootAdmin: boolean;
	is2faEnabled: boolean;
}

/**
 * Pterodactylパネルのアカウント管理(Pterodactyl Application API `users.*`権限に対応)。
 * `/api/application/users`系のエンドポイントをラップする。
 * 注意: これはPterodactylパネルへのログインアカウントの管理であり、
 * `system-settings/users-groups`(このサーバー自体のLinuxシステムユーザー)とは全くの別物。
 */
export class PterodactylPanelUsersClient {
	constructor(private readonly env: Env) {}

	async list(): Promise<PterodactylPanelUser[]> {
		throw new PterodactylNotImplementedError("game-servers.panelUsers.list");
	}

	async getDetails(_userId: number): Promise<PterodactylPanelUser> {
		throw new PterodactylNotImplementedError("game-servers.panelUsers.getDetails");
	}

	async create(
		_input: { email: string; username: string; firstName: string; lastName: string; password?: string },
	): Promise<PterodactylPanelUser> {
		throw new PterodactylNotImplementedError("game-servers.panelUsers.create");
	}

	async update(
		_userId: number,
		_input: Partial<{ email: string; username: string; firstName: string; lastName: string; password: string }>,
	): Promise<PterodactylPanelUser> {
		throw new PterodactylNotImplementedError("game-servers.panelUsers.update");
	}

	async remove(_userId: number): Promise<void> {
		throw new PterodactylNotImplementedError("game-servers.panelUsers.remove");
	}
}
