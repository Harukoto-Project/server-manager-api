import type { Env } from "../../config/env.js";
import { PterodactylNotImplementedError } from "./pterodactyl-request.js";

export interface PterodactylBackup {
	uuid: string;
	name: string;
	ignoredFiles: string[];
	isSuccessful: boolean;
	isLocked: boolean;
	checksum: string | null;
	bytes: number;
	createdAt: string;
	completedAt: string | null;
}

/**
 * サーバーごとのバックアップ管理(Pterodactyl Client API `backup.*`権限に対応)。
 * `/api/client/servers/{server}/backups`系のエンドポイントをラップする。
 */
export class PterodactylBackupsClient {
	constructor(private readonly env: Env) {}

	async list(_identifier: string): Promise<PterodactylBackup[]> {
		throw new PterodactylNotImplementedError("game-servers.backups.list");
	}

	async create(_identifier: string, _name: string, _ignoredFiles: string): Promise<PterodactylBackup> {
		throw new PterodactylNotImplementedError("game-servers.backups.create");
	}

	async getDownloadUrl(_identifier: string, _backupUuid: string): Promise<string> {
		throw new PterodactylNotImplementedError("game-servers.backups.getDownloadUrl");
	}

	async restore(_identifier: string, _backupUuid: string, _truncate: boolean): Promise<void> {
		throw new PterodactylNotImplementedError("game-servers.backups.restore");
	}

	async toggleLock(_identifier: string, _backupUuid: string): Promise<PterodactylBackup> {
		throw new PterodactylNotImplementedError("game-servers.backups.toggleLock");
	}

	async remove(_identifier: string, _backupUuid: string): Promise<void> {
		throw new PterodactylNotImplementedError("game-servers.backups.remove");
	}
}
