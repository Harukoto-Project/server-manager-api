import type { Env } from "../../config/env.js";
import { pterodactylRequest } from "./pterodactyl-request.js";

export interface PterodactylStartupVariable {
	name: string;
	description: string;
	envVariable: string;
	defaultValue: string;
	serverValue: string;
	isEditable: boolean;
	rules: string;
}

export interface PterodactylStartupInfo {
	startupCommand: string;
	dockerImage: string;
	variables: PterodactylStartupVariable[];
}

interface RawEggVariableAttributes {
	name: string;
	description: string;
	env_variable: string;
	default_value: string;
	server_value: string;
	is_editable: boolean;
	rules: string;
}

function mapVariable(attrs: RawEggVariableAttributes): PterodactylStartupVariable {
	return {
		name: attrs.name,
		description: attrs.description,
		envVariable: attrs.env_variable,
		defaultValue: attrs.default_value,
		serverValue: attrs.server_value,
		isEditable: attrs.is_editable,
		rules: attrs.rules,
	};
}

/**
 * サーバーの起動設定管理(Pterodactyl Client API `startup.*`権限に対応)。
 * `/api/client/servers/{server}/startup`系のエンドポイントをラップする。
 * スタートアップコマンド自体やDockerイメージの変更はApplication API側
 * (`pterodactyl-client-server-admin.ts`)が担当し、ここでは環境変数(egg variables)の
 * 値の変更のみをClient APIで行う想定。
 */
export class PterodactylStartupClient {
	constructor(private readonly env: Env) {}

	async get(identifier: string): Promise<PterodactylStartupInfo> {
		const startup = await pterodactylRequest<{
			data: Array<{ attributes: RawEggVariableAttributes }>;
			meta: {
				startup_command: string;
				raw_startup_command: string;
				docker_images: Record<string, string>;
			};
		}>(this.env, "client", `/api/client/servers/${identifier}/startup`);

		// 現在選択中のDockerイメージは`/startup`エンドポイントには含まれず、
		// サーバー詳細エンドポイント(`docker_image`属性)から取得する必要がある。
		// アクセス権限の都合で取得できない場合でも起動設定自体は表示できるようにフォールバックする。
		let dockerImage = "";
		try {
			const details = await pterodactylRequest<{ attributes: { docker_image: string } }>(
				this.env,
				"client",
				`/api/client/servers/${identifier}`,
			);
			dockerImage = details.attributes.docker_image;
		} catch {
			dockerImage = "";
		}

		return {
			startupCommand: startup.meta.startup_command,
			dockerImage,
			variables: startup.data.map((entry) => mapVariable(entry.attributes)),
		};
	}

	async updateVariable(identifier: string, key: string, value: string): Promise<PterodactylStartupVariable> {
		const data = await pterodactylRequest<{ attributes: RawEggVariableAttributes }>(
			this.env,
			"client",
			`/api/client/servers/${identifier}/startup/variable`,
			{ method: "PUT", body: JSON.stringify({ key, value }) },
		);
		return mapVariable(data.attributes);
	}
}
