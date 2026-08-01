import type { Env } from "../../config/env.js";
import { assertPterodactylConfigured, pterodactylApiKey, pterodactylRequest } from "./pterodactyl-request.js";

export interface PterodactylNest {
	id: number;
	name: string;
	description: string | null;
}

export interface PterodactylEggVariable {
	id: number;
	name: string;
	description: string | null;
	envVariable: string;
	defaultValue: string;
	isViewable: boolean;
	isEditable: boolean;
	rules: string;
}

export interface PterodactylEgg {
	id: number;
	nestId: number;
	name: string;
	description: string | null;
	dockerImage: string;
	dockerImages: Record<string, string>;
	startup: string;
	variables: PterodactylEggVariable[];
}

interface PterodactylListResponse<T> {
	data: Array<{ attributes: T }>;
}

interface PterodactylItemResponse<T> {
	attributes: T;
}

interface RawNestAttributes {
	id: number;
	name: string;
	description: string | null;
}

interface RawEggVariableAttributes {
	id: number;
	name: string;
	description: string | null;
	env_variable: string;
	default_value: string;
	user_viewable: boolean;
	user_editable: boolean;
	rules: string;
}

interface RawEggAttributes {
	id: number;
	nest: number;
	name: string;
	description: string | null;
	docker_image: string;
	docker_images?: Record<string, string>;
	startup: string;
	relationships?: {
		variables?: {
			data: Array<{ attributes: RawEggVariableAttributes }>;
		};
	};
}

function mapNest(attrs: RawNestAttributes): PterodactylNest {
	return { id: attrs.id, name: attrs.name, description: attrs.description };
}

function mapVariable(attrs: RawEggVariableAttributes): PterodactylEggVariable {
	return {
		id: attrs.id,
		name: attrs.name,
		description: attrs.description,
		envVariable: attrs.env_variable,
		defaultValue: attrs.default_value,
		isViewable: attrs.user_viewable,
		isEditable: attrs.user_editable,
		rules: attrs.rules,
	};
}

function mapEgg(attrs: RawEggAttributes): PterodactylEgg {
	return {
		id: attrs.id,
		nestId: attrs.nest,
		name: attrs.name,
		description: attrs.description,
		dockerImage: attrs.docker_image,
		dockerImages: attrs.docker_images ?? {},
		startup: attrs.startup,
		variables: (attrs.relationships?.variables?.data ?? []).map((entry) => mapVariable(entry.attributes)),
	};
}

/**
 * Egg・Nestライブラリ管理(Pterodactyl Application API `nests.*`/`eggs.*`権限に対応)。
 * `/api/application/nests`, `/api/application/nests/{nest}/eggs`系のエンドポイントをラップする。
 *
 * 【重要】公式ドキュメント(https://pterodactyl-panel.mintlify.app/api/application/eggs 等)および
 * 本家Pterodactyl(1.0-develop)のソース(`routes/api-application.php`)によれば、
 * Nest/EggはApplication API上「読み取り専用」(一覧・詳細取得のみ)であり、
 * インポート/エクスポート/削除/変数更新は標準では提供されていない。
 * これらはPelicanパネル(Pterodactylフォーク)等、一部のパネル実装が独自に追加した拡張エンドポイントとして
 * 存在することがある(参考: https://github.com/pelican-dev/panel/pull/1947)。
 * このモジュールの`importEgg`/`exportEgg`/`removeEgg`/`updateEggVariable`は、
 * タスク仕様および接続先パネルの構成(Nestスコープの一覧/詳細が実際に動作することをMCP経由で確認済み)に基づき
 * Nestスコープの拡張エンドポイント(`/api/application/nests/{nest}/eggs/...`)を叩く実装としている。
 * 接続先パネルがこれらの拡張エンドポイントを持たない場合は404/405等のエラーになるため、
 * 実際のパネルに対して要検証(詳細は最終報告を参照)。
 */
export class PterodactylNestsEggsClient {
	constructor(private readonly env: Env) {}

	async listNests(): Promise<PterodactylNest[]> {
		const data = await pterodactylRequest<PterodactylListResponse<RawNestAttributes>>(
			this.env,
			"application",
			"/api/application/nests",
		);
		return data.data.map((entry) => mapNest(entry.attributes));
	}

	async listEggs(nestId: number): Promise<PterodactylEgg[]> {
		const data = await pterodactylRequest<PterodactylListResponse<RawEggAttributes>>(
			this.env,
			"application",
			`/api/application/nests/${nestId}/eggs?include=variables`,
		);
		return data.data.map((entry) => mapEgg(entry.attributes));
	}

	async getEgg(nestId: number, eggId: number): Promise<PterodactylEgg> {
		const data = await pterodactylRequest<PterodactylItemResponse<RawEggAttributes>>(
			this.env,
			"application",
			`/api/application/nests/${nestId}/eggs/${eggId}?include=variables`,
		);
		return mapEgg(data.attributes);
	}

	async updateEggVariable(
		nestId: number,
		eggId: number,
		variableId: number,
		defaultValue: string,
	): Promise<PterodactylEggVariable> {
		const data = await pterodactylRequest<PterodactylItemResponse<RawEggVariableAttributes>>(
			this.env,
			"application",
			`/api/application/nests/${nestId}/eggs/${eggId}/variables/${variableId}`,
			{ method: "PATCH", body: JSON.stringify({ default_value: defaultValue }) },
		);
		return mapVariable(data.attributes);
	}

	/**
	 * `eggJson`(PTDL_v2形式等のEggエクスポートJSON文字列)をmultipart/form-dataでアップロードしてインポートする。
	 * `pterodactylRequest`はJSONボディ専用のため、ここでは直接`fetch`を組み立てる。
	 */
	async importEgg(nestId: number, eggJson: string): Promise<PterodactylEgg> {
		assertPterodactylConfigured(this.env);
		const formData = new FormData();
		formData.append("file", new Blob([eggJson], { type: "application/json" }), "egg.json");

		const response = await fetch(`${this.env.PTERODACTYL_PANEL_URL}/api/application/nests/${nestId}/eggs/import`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${pterodactylApiKey(this.env, "application")}`,
				Accept: "application/json",
			},
			body: formData,
		});
		if (!response.ok) {
			throw new Error(`Pterodactyl API error: ${response.status} ${await response.text()}`);
		}
		const data = (await response.json()) as PterodactylItemResponse<RawEggAttributes>;
		return mapEgg(data.attributes);
	}

	/** エクスポートされたEgg JSONを文字列のまま返す(クライアント側でファイルとしてダウンロードさせる想定) */
	async exportEgg(nestId: number, eggId: number): Promise<string> {
		assertPterodactylConfigured(this.env);
		const response = await fetch(
			`${this.env.PTERODACTYL_PANEL_URL}/api/application/nests/${nestId}/eggs/${eggId}/export`,
			{
				headers: {
					Authorization: `Bearer ${pterodactylApiKey(this.env, "application")}`,
					Accept: "application/json",
				},
			},
		);
		if (!response.ok) {
			throw new Error(`Pterodactyl API error: ${response.status} ${await response.text()}`);
		}
		return response.text();
	}

	async removeEgg(nestId: number, eggId: number): Promise<void> {
		await pterodactylRequest(this.env, "application", `/api/application/nests/${nestId}/eggs/${eggId}`, {
			method: "DELETE",
		});
	}
}
