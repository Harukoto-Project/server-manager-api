import type { FastifyReply } from "fastify";
import type { Env } from "../../config/env.js";

/**
 * Pterodactyl Application/Client APIへの共通HTTPアクセスヘルパー。
 * `pterodactyl-client.ts`(サーバー一覧・電源操作・コンソール)と、
 * 機能ごとに分割された`pterodactyl-client-*.ts`の全ファイルから共有される。
 * URL構築・認証ヘッダー付与・エラーハンドリングをここに集約することで、
 * 各機能ファイルは「どのAPIキー種別で、どのパスを叩くか」だけに集中できるようにする。
 */

export type PterodactylApiKeyKind = "application" | "client";

export function assertPterodactylConfigured(env: Env): void {
	if (!env.PTERODACTYL_PANEL_URL || !env.PTERODACTYL_APPLICATION_API_KEY) {
		throw new Error("Pterodactyl連携が未設定です(PTERODACTYL_PANEL_URL / PTERODACTYL_APPLICATION_API_KEY)");
	}
}

export function pterodactylApiKey(env: Env, kind: PterodactylApiKeyKind): string {
	return (kind === "application" ? env.PTERODACTYL_APPLICATION_API_KEY : env.PTERODACTYL_CLIENT_API_KEY) ?? "";
}

/**
 * Pterodactyl API(Application/Client共通)へのリクエストを送信する。
 * `path`は`/api/application/...`または`/api/client/...`から始まる絶対パスを渡すこと。
 * レスポンスが204(No Content)の場合はundefinedを返す。
 */
export async function pterodactylRequest<T>(
	env: Env,
	kind: PterodactylApiKeyKind,
	path: string,
	init?: RequestInit,
): Promise<T> {
	assertPterodactylConfigured(env);
	const response = await fetch(`${env.PTERODACTYL_PANEL_URL}${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${pterodactylApiKey(env, kind)}`,
			Accept: "application/json",
			"Content-Type": "application/json",
			...init?.headers,
		},
	});
	if (!response.ok) {
		throw new Error(`Pterodactyl API error: ${response.status} ${await response.text()}`);
	}
	if (response.status === 204) {
		return undefined as T;
	}
	return (await response.json()) as T;
}

/**
 * 後続タスクが実装するまでの間、未実装のメソッド呼び出しであることを明示するためのエラー。
 * ルート側でこのエラーを捕捉した場合は501を返す想定(各`*.ts`のNOT_IMPLEMENTEDハンドラ参照)。
 */
export class PterodactylNotImplementedError extends Error {
	constructor(feature: string) {
		super(`${feature} はまだ実装されていません(後続タスクで実装予定)`);
		this.name = "PterodactylNotImplementedError";
	}
}

/**
 * `game-servers`配下の各ルートファイルで共通して使うエラーハンドラ。
 * `PterodactylNotImplementedError`は501、それ以外(実際のPterodactyl API呼び出し失敗)は502として返す。
 */
export function respondPterodactylError(reply: FastifyReply, error: unknown) {
	if (error instanceof PterodactylNotImplementedError) {
		return reply.code(501).send({ error: error.message });
	}
	return reply.code(502).send({ error: (error as Error).message });
}
