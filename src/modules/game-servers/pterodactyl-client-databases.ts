import type { Env } from "../../config/env.js";
import { pterodactylRequest } from "./pterodactyl-request.js";

export interface PterodactylDatabase {
	id: string;
	host: { address: string; port: number };
	name: string;
	username: string;
	/** 作成時・パスワードローテート時のみ値が入る。一覧取得時は`?include=password`で取得を試みる */
	password: string | null;
	connectionsFrom: string;
	maxConnections: number;
}

interface PterodactylDatabaseAttributes {
	id: string;
	host: { address: string; port: number };
	name: string;
	username: string;
	connections_from: string;
	max_connections: number;
	relationships?: {
		password?: { attributes: { password: string } };
	};
}

function mapDatabase(attrs: PterodactylDatabaseAttributes): PterodactylDatabase {
	return {
		id: attrs.id,
		host: attrs.host,
		name: attrs.name,
		username: attrs.username,
		password: attrs.relationships?.password?.attributes.password ?? null,
		connectionsFrom: attrs.connections_from,
		maxConnections: attrs.max_connections,
	};
}

/**
 * サーバーごとのデータベース管理(Pterodactyl Client API `database.*`権限に対応)。
 * `/api/client/servers/{server}/databases`系のエンドポイントをラップする。
 * 参考: https://pterodactyl-api-docs.netvpx.com/docs/intro (Client API Reference > Database Management)
 */
export class PterodactylDatabasesClient {
	constructor(private readonly env: Env) {}

	async list(identifier: string): Promise<PterodactylDatabase[]> {
		const data = await pterodactylRequest<{ data: Array<{ attributes: PterodactylDatabaseAttributes }> }>(
			this.env,
			"client",
			`/api/client/servers/${identifier}/databases?include=password`,
		);
		return data.data.map((entry) => mapDatabase(entry.attributes));
	}

	async create(identifier: string, databaseName: string, remote: string): Promise<PterodactylDatabase> {
		const data = await pterodactylRequest<{ attributes: PterodactylDatabaseAttributes }>(
			this.env,
			"client",
			`/api/client/servers/${identifier}/databases`,
			{ method: "POST", body: JSON.stringify({ database: databaseName, remote }) },
		);
		return mapDatabase(data.attributes);
	}

	async rotatePassword(identifier: string, databaseId: string): Promise<PterodactylDatabase> {
		const data = await pterodactylRequest<{ attributes: PterodactylDatabaseAttributes }>(
			this.env,
			"client",
			`/api/client/servers/${identifier}/databases/${databaseId}/rotate-password`,
			{ method: "POST" },
		);
		return mapDatabase(data.attributes);
	}

	async remove(identifier: string, databaseId: string): Promise<void> {
		await pterodactylRequest(this.env, "client", `/api/client/servers/${identifier}/databases/${databaseId}`, {
			method: "DELETE",
		});
	}
}
