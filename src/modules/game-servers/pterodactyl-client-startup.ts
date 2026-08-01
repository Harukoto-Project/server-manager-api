import type { Env } from "../../config/env.js";
import { PterodactylNotImplementedError } from "./pterodactyl-request.js";

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

/**
 * サーバーの起動設定管理(Pterodactyl Client API `startup.*`権限に対応)。
 * `/api/client/servers/{server}/startup`系のエンドポイントをラップする。
 * スタートアップコマンド自体やDockerイメージの変更はApplication API側
 * (`pterodactyl-client-server-admin.ts`)が担当し、ここでは環境変数(egg variables)の
 * 値の変更のみをClient APIで行う想定。
 */
export class PterodactylStartupClient {
	constructor(private readonly env: Env) {}

	async get(_identifier: string): Promise<PterodactylStartupInfo> {
		throw new PterodactylNotImplementedError("game-servers.startup.get");
	}

	async updateVariable(_identifier: string, _key: string, _value: string): Promise<PterodactylStartupVariable> {
		throw new PterodactylNotImplementedError("game-servers.startup.updateVariable");
	}
}
