import type { Env } from "../../config/env.js";
import { pterodactylRequest } from "./pterodactyl-request.js";

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

interface RawUserAttributes {
	id: number;
	external_id: string | null;
	uuid: string;
	username: string;
	email: string;
	first_name: string;
	last_name: string;
	root_admin: boolean;
	"2fa": boolean;
}

function mapUser(attrs: RawUserAttributes): PterodactylPanelUser {
	return {
		id: attrs.id,
		externalId: attrs.external_id,
		uuid: attrs.uuid,
		username: attrs.username,
		email: attrs.email,
		firstName: attrs.first_name,
		lastName: attrs.last_name,
		isRootAdmin: attrs.root_admin,
		is2faEnabled: attrs["2fa"],
	};
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
		const data = await pterodactylRequest<{ data: Array<{ attributes: RawUserAttributes }> }>(
			this.env,
			"application",
			"/api/application/users",
		);
		return data.data.map((entry) => mapUser(entry.attributes));
	}

	async getDetails(userId: number): Promise<PterodactylPanelUser> {
		const data = await pterodactylRequest<{ attributes: RawUserAttributes }>(
			this.env,
			"application",
			`/api/application/users/${userId}`,
		);
		return mapUser(data.attributes);
	}

	async create(
		input: { email: string; username: string; firstName: string; lastName: string; password?: string },
	): Promise<PterodactylPanelUser> {
		const data = await pterodactylRequest<{ attributes: RawUserAttributes }>(
			this.env,
			"application",
			"/api/application/users",
			{
				method: "POST",
				body: JSON.stringify({
					email: input.email,
					username: input.username,
					first_name: input.firstName,
					last_name: input.lastName,
					...(input.password ? { password: input.password } : {}),
				}),
			},
		);
		return mapUser(data.attributes);
	}

	/**
	 * PATCH /api/application/users/{user}はemail/username/first_name/last_nameを
	 * 必須パラメータとして扱うパネルバージョンがあるため、未指定項目は現在値で補完してから送信する。
	 */
	async update(
		userId: number,
		input: Partial<{ email: string; username: string; firstName: string; lastName: string; password: string }>,
	): Promise<PterodactylPanelUser> {
		const current = await this.getDetails(userId);
		const data = await pterodactylRequest<{ attributes: RawUserAttributes }>(
			this.env,
			"application",
			`/api/application/users/${userId}`,
			{
				method: "PATCH",
				body: JSON.stringify({
					email: input.email ?? current.email,
					username: input.username ?? current.username,
					first_name: input.firstName ?? current.firstName,
					last_name: input.lastName ?? current.lastName,
					...(input.password ? { password: input.password } : {}),
				}),
			},
		);
		return mapUser(data.attributes);
	}

	async remove(userId: number): Promise<void> {
		await pterodactylRequest(this.env, "application", `/api/application/users/${userId}`, { method: "DELETE" });
	}
}
