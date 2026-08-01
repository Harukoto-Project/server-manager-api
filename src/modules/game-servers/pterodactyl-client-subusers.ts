import type { Env } from "../../config/env.js";
import { pterodactylRequest } from "./pterodactyl-request.js";

export interface PterodactylSubuser {
	uuid: string;
	email: string;
	username: string | null;
	image: string | null;
	twoFactorEnabled: boolean;
	permissions: string[];
}

interface RawSubuserAttributes {
	uuid: string;
	username: string | null;
	email: string;
	image: string | null;
	"2fa_enabled": boolean;
	permissions: string[];
}

function toSubuser(attrs: RawSubuserAttributes): PterodactylSubuser {
	return {
		uuid: attrs.uuid,
		email: attrs.email,
		username: attrs.username,
		image: attrs.image,
		twoFactorEnabled: attrs["2fa_enabled"],
		permissions: attrs.permissions,
	};
}

/**
 * サーバーごとの共同管理者(サブユーザー)管理(Pterodactyl Client API `user.*`権限に対応)。
 * `/api/client/servers/{server}/users`系のエンドポイントをラップする。
 * 参考: https://pterodactyl-api-docs.netvpx.com/docs/intro (Client API Reference / Server Users)
 */
export class PterodactylSubusersClient {
	constructor(private readonly env: Env) {}

	async list(identifier: string): Promise<PterodactylSubuser[]> {
		const data = await pterodactylRequest<{ data: Array<{ attributes: RawSubuserAttributes }> }>(
			this.env,
			"client",
			`/api/client/servers/${identifier}/users`,
		);
		return data.data.map((entry) => toSubuser(entry.attributes));
	}

	async invite(identifier: string, email: string, permissions: string[]): Promise<PterodactylSubuser> {
		const data = await pterodactylRequest<{ attributes: RawSubuserAttributes }>(
			this.env,
			"client",
			`/api/client/servers/${identifier}/users`,
			{ method: "POST", body: JSON.stringify({ email, permissions }) },
		);
		return toSubuser(data.attributes);
	}

	async updatePermissions(
		identifier: string,
		subuserUuid: string,
		permissions: string[],
	): Promise<PterodactylSubuser> {
		const data = await pterodactylRequest<{ attributes: RawSubuserAttributes }>(
			this.env,
			"client",
			`/api/client/servers/${identifier}/users/${subuserUuid}`,
			{ method: "POST", body: JSON.stringify({ permissions }) },
		);
		return toSubuser(data.attributes);
	}

	async remove(identifier: string, subuserUuid: string): Promise<void> {
		await pterodactylRequest(this.env, "client", `/api/client/servers/${identifier}/users/${subuserUuid}`, {
			method: "DELETE",
		});
	}
}
