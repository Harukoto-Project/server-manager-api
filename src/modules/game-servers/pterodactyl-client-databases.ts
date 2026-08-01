import type { Env } from "../../config/env.js";
import { PterodactylNotImplementedError } from "./pterodactyl-request.js";

export interface PterodactylDatabase {
	id: string;
	host: { address: string; port: number };
	name: string;
	username: string;
	connectionsFrom: string;
	maxConnections: number;
}

/**
 * サーバーごとのデータベース管理(Pterodactyl Client API `database.*`権限に対応)。
 * `/api/client/servers/{server}/databases`系のエンドポイントをラップする。
 */
export class PterodactylDatabasesClient {
	constructor(private readonly env: Env) {}

	async list(_identifier: string): Promise<PterodactylDatabase[]> {
		throw new PterodactylNotImplementedError("game-servers.databases.list");
	}

	async create(_identifier: string, _databaseName: string, _remote: string): Promise<PterodactylDatabase> {
		throw new PterodactylNotImplementedError("game-servers.databases.create");
	}

	async rotatePassword(_identifier: string, _databaseId: string): Promise<PterodactylDatabase> {
		throw new PterodactylNotImplementedError("game-servers.databases.rotatePassword");
	}

	async remove(_identifier: string, _databaseId: string): Promise<void> {
		throw new PterodactylNotImplementedError("game-servers.databases.remove");
	}
}
