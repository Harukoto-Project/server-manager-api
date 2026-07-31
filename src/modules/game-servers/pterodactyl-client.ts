import type { Env } from "../../config/env.js";

export interface PterodactylServer {
	identifier: string;
	uuid: string;
	name: string;
	description: string | null;
	/** Application APIのインストール/凍結状態。null(正常稼働可能)以外は installing/suspended 等 */
	status: string | null;
	/** Client APIのresourcesから取得する電源状態。取得できない場合は"unknown" */
	currentState: "running" | "starting" | "stopping" | "offline" | "unknown";
	limits: { memory: number; disk: number; cpu: number };
}

/**
 * 既存Pterodactylパネルの Application/Client API を薄くラップするクライアント。
 * Notion「Minecraft/ゲームサーバー管理モジュール(Pterodactyl連携)」に対応。
 * 将来Pterodactyl自体を置き換える場合は、この class と同じインターフェースを持つ
 * 別実装に差し替えるだけで済むようにする(APIアダプタ層)。
 */
export class PterodactylClient {
	constructor(private readonly env: Env) {}

	private assertConfigured() {
		if (!this.env.PTERODACTYL_PANEL_URL || !this.env.PTERODACTYL_APPLICATION_API_KEY) {
			throw new Error("Pterodactyl連携が未設定です(PTERODACTYL_PANEL_URL / PTERODACTYL_APPLICATION_API_KEY)");
		}
	}

	private async request<T>(apiKey: string, path: string, init?: RequestInit): Promise<T> {
		this.assertConfigured();
		const response = await fetch(`${this.env.PTERODACTYL_PANEL_URL}${path}`, {
			...init,
			headers: {
				Authorization: `Bearer ${apiKey}`,
				Accept: "application/json",
				"Content-Type": "application/json",
				...init?.headers,
			},
		});
		if (!response.ok) {
			throw new Error(`Pterodactyl API error: ${response.status} ${await response.text()}`);
		}
		return (await response.json()) as T;
	}

	/**
	 * サーバー一覧をApplication APIで取得し、各サーバーの電源状態をClient APIの
	 * resourcesエンドポイントで補う。Application APIの`status`はインストール/凍結状態
	 * (null/installing/suspended等)であり、起動中かどうかは分からないため。
	 * Client APIキーが未設定、またはそのサーバーへのアクセス権がない場合は"unknown"にフォールバックする。
	 */
	async listServers(): Promise<PterodactylServer[]> {
		const data = await this.request<{
			data: Array<{
				attributes: {
					identifier: string;
					uuid: string;
					name: string;
					description: string | null;
					status: string | null;
					limits: { memory: number; disk: number; cpu: number };
				};
			}>;
		}>(this.env.PTERODACTYL_APPLICATION_API_KEY ?? "", "/api/application/servers?include=allocations");

		return Promise.all(
			data.data.map(async (entry) => {
				const attrs = entry.attributes;
				const currentState = await this.getCurrentState(attrs.identifier);
				return {
					identifier: attrs.identifier,
					uuid: attrs.uuid,
					name: attrs.name,
					description: attrs.description,
					status: attrs.status,
					currentState,
					limits: attrs.limits,
				};
			}),
		);
	}

	private async getCurrentState(identifier: string): Promise<PterodactylServer["currentState"]> {
		if (!this.env.PTERODACTYL_CLIENT_API_KEY) return "unknown";
		try {
			const resources = await this.request<{ attributes: { current_state: string } }>(
				this.env.PTERODACTYL_CLIENT_API_KEY,
				`/api/client/servers/${identifier}/resources`,
			);
			const state = resources.attributes.current_state;
			if (state === "running" || state === "starting" || state === "stopping" || state === "offline") {
				return state;
			}
			return "unknown";
		} catch {
			return "unknown";
		}
	}

	async sendPowerAction(serverIdentifier: string, signal: "start" | "stop" | "restart" | "kill") {
		await this.request(
			this.env.PTERODACTYL_CLIENT_API_KEY ?? "",
			`/api/client/servers/${serverIdentifier}/power`,
			{ method: "POST", body: JSON.stringify({ signal }) },
		);
	}

	/** Pterodactyl Client APIからWebSocketコンソールの接続情報(トークン付きURL)を取得する */
	async getConsoleCredentials(serverIdentifier: string) {
		return this.request<{ data: { token: string; socket: string } }>(
			this.env.PTERODACTYL_CLIENT_API_KEY ?? "",
			`/api/client/servers/${serverIdentifier}/websocket`,
		);
	}
}
