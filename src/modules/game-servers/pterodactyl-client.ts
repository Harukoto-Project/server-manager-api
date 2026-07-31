import type { Env } from "../../config/env.js";

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

	async listServers() {
		const data = await this.request<{ data: Array<{ attributes: Record<string, unknown> }> }>(
			this.env.PTERODACTYL_APPLICATION_API_KEY ?? "",
			"/api/application/servers?include=allocations",
		);
		return data.data.map((entry) => entry.attributes);
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
