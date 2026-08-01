import type { Env } from "../../config/env.js";
import { pterodactylRequest } from "./pterodactyl-request.js";

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

interface PterodactylBackupAttributes {
	uuid: string;
	name: string;
	ignored_files: string[];
	sha256_hash: string | null;
	bytes: number;
	created_at: string;
	completed_at: string | null;
	is_successful: boolean | null;
	is_locked: boolean;
}

function mapBackup(attrs: PterodactylBackupAttributes): PterodactylBackup {
	return {
		uuid: attrs.uuid,
		name: attrs.name,
		ignoredFiles: attrs.ignored_files,
		isSuccessful: attrs.is_successful === true,
		isLocked: attrs.is_locked,
		checksum: attrs.sha256_hash,
		bytes: attrs.bytes,
		createdAt: attrs.created_at,
		completedAt: attrs.completed_at,
	};
}

/**
 * サーバーごとのバックアップ管理(Pterodactyl Client API `backup.*`権限に対応)。
 * `/api/client/servers/{server}/backups`系のエンドポイントをラップする。
 * 参考: https://pterodactyl-api-docs.netvpx.com/docs/intro (Client API Reference > Backup Management)
 */
export class PterodactylBackupsClient {
	constructor(private readonly env: Env) {}

	async list(identifier: string): Promise<PterodactylBackup[]> {
		const data = await pterodactylRequest<{ data: Array<{ attributes: PterodactylBackupAttributes }> }>(
			this.env,
			"client",
			`/api/client/servers/${identifier}/backups`,
		);
		return data.data.map((entry) => mapBackup(entry.attributes));
	}

	async create(identifier: string, name: string, ignoredFiles: string): Promise<PterodactylBackup> {
		const body: Record<string, unknown> = {};
		if (name) body.name = name;
		if (ignoredFiles) body.ignored = ignoredFiles;
		const data = await pterodactylRequest<{ attributes: PterodactylBackupAttributes }>(
			this.env,
			"client",
			`/api/client/servers/${identifier}/backups`,
			{ method: "POST", body: JSON.stringify(body) },
		);
		return mapBackup(data.attributes);
	}

	async getDownloadUrl(identifier: string, backupUuid: string): Promise<string> {
		const data = await pterodactylRequest<{ attributes: { url: string } }>(
			this.env,
			"client",
			`/api/client/servers/${identifier}/backups/${backupUuid}/download`,
		);
		return data.attributes.url;
	}

	async restore(identifier: string, backupUuid: string, truncate: boolean): Promise<void> {
		await pterodactylRequest(this.env, "client", `/api/client/servers/${identifier}/backups/${backupUuid}/restore`, {
			method: "POST",
			body: JSON.stringify({ truncate }),
		});
	}

	/**
	 * バックアップのロック状態を反転させる(Pterodactyl Client APIはトグル動作かつ204レスポンスのため、
	 * 反転後の状態を得るために詳細取得エンドポイントを続けて呼び出す)。
	 */
	async toggleLock(identifier: string, backupUuid: string): Promise<PterodactylBackup> {
		await pterodactylRequest(this.env, "client", `/api/client/servers/${identifier}/backups/${backupUuid}/lock`, {
			method: "POST",
		});
		const data = await pterodactylRequest<{ attributes: PterodactylBackupAttributes }>(
			this.env,
			"client",
			`/api/client/servers/${identifier}/backups/${backupUuid}`,
		);
		return mapBackup(data.attributes);
	}

	async remove(identifier: string, backupUuid: string): Promise<void> {
		await pterodactylRequest(this.env, "client", `/api/client/servers/${identifier}/backups/${backupUuid}`, {
			method: "DELETE",
		});
	}
}
