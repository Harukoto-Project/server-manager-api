import type { Env } from "../../config/env.js";
import { PterodactylNotImplementedError } from "./pterodactyl-request.js";

export interface PterodactylNest {
	id: number;
	name: string;
	description: string | null;
}

export interface PterodactylEggVariable {
	id: number;
	name: string;
	envVariable: string;
	defaultValue: string;
	isEditable: boolean;
	rules: string;
}

export interface PterodactylEgg {
	id: number;
	nestId: number;
	name: string;
	description: string | null;
	dockerImage: string;
	startup: string;
	variables: PterodactylEggVariable[];
}

/**
 * Egg・Nestライブラリ管理(Pterodactyl Application API `nests.*`/`eggs.*`権限に対応)。
 * `/api/application/nests`, `/api/application/nests/{nest}/eggs`系のエンドポイントをラップする。
 * Egg変数の更新やインポート/エクスポートはApplication APIで公式サポートされているか
 * バージョン差異があるため、実装時にパネルのバージョンで要確認(README/最終報告参照)。
 * Eggのインポートはファイルアップロードを伴うため、実装時は`@fastify/multipart`の追加を検討すること。
 */
export class PterodactylNestsEggsClient {
	constructor(private readonly env: Env) {}

	async listNests(): Promise<PterodactylNest[]> {
		throw new PterodactylNotImplementedError("game-servers.nestsEggs.listNests");
	}

	async listEggs(_nestId: number): Promise<PterodactylEgg[]> {
		throw new PterodactylNotImplementedError("game-servers.nestsEggs.listEggs");
	}

	async getEgg(_nestId: number, _eggId: number): Promise<PterodactylEgg> {
		throw new PterodactylNotImplementedError("game-servers.nestsEggs.getEgg");
	}

	async updateEggVariable(
		_nestId: number,
		_eggId: number,
		_variableId: number,
		_defaultValue: string,
	): Promise<PterodactylEggVariable> {
		throw new PterodactylNotImplementedError("game-servers.nestsEggs.updateEggVariable");
	}

	async importEgg(_nestId: number, _eggJson: string): Promise<PterodactylEgg> {
		throw new PterodactylNotImplementedError("game-servers.nestsEggs.importEgg");
	}

	async exportEgg(_nestId: number, _eggId: number): Promise<string> {
		throw new PterodactylNotImplementedError("game-servers.nestsEggs.exportEgg");
	}

	async removeEgg(_nestId: number, _eggId: number): Promise<void> {
		throw new PterodactylNotImplementedError("game-servers.nestsEggs.removeEgg");
	}
}
