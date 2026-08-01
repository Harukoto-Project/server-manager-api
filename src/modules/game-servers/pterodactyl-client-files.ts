import type { Env } from "../../config/env.js";
import { PterodactylNotImplementedError } from "./pterodactyl-request.js";

export interface PterodactylFileObject {
	name: string;
	mode: string;
	modeBits: string;
	size: number;
	isFile: boolean;
	isSymlink: boolean;
	mimetype: string;
	createdAt: string;
	modifiedAt: string;
}

/**
 * サーバーのファイル管理(Pterodactyl Client API `files.*`権限に対応)。
 * 参考: https://pterodactyl-api-docs.netvpx.com/docs/v0.7/client/files
 * 実装時は`pterodactylRequest(this.env, "client", ...)`で
 * `/api/client/servers/{server}/files/...`を呼び出す形にする。
 */
export class PterodactylFilesClient {
	constructor(private readonly env: Env) {}

	async list(_identifier: string, _directory: string): Promise<PterodactylFileObject[]> {
		throw new PterodactylNotImplementedError("game-servers.files.list");
	}

	async readContents(_identifier: string, _file: string): Promise<string> {
		throw new PterodactylNotImplementedError("game-servers.files.readContents");
	}

	async writeContents(_identifier: string, _file: string, _content: string): Promise<void> {
		throw new PterodactylNotImplementedError("game-servers.files.writeContents");
	}

	async rename(_identifier: string, _root: string, _files: Array<{ from: string; to: string }>): Promise<void> {
		throw new PterodactylNotImplementedError("game-servers.files.rename");
	}

	async copy(_identifier: string, _location: string): Promise<void> {
		throw new PterodactylNotImplementedError("game-servers.files.copy");
	}

	async compress(_identifier: string, _root: string, _files: string[]): Promise<PterodactylFileObject> {
		throw new PterodactylNotImplementedError("game-servers.files.compress");
	}

	async decompress(_identifier: string, _root: string, _file: string): Promise<void> {
		throw new PterodactylNotImplementedError("game-servers.files.decompress");
	}

	async remove(_identifier: string, _root: string, _files: string[]): Promise<void> {
		throw new PterodactylNotImplementedError("game-servers.files.remove");
	}

	async createFolder(_identifier: string, _root: string, _name: string): Promise<void> {
		throw new PterodactylNotImplementedError("game-servers.files.createFolder");
	}

	async getDownloadUrl(_identifier: string, _file: string): Promise<string> {
		throw new PterodactylNotImplementedError("game-servers.files.getDownloadUrl");
	}

	async getUploadUrl(_identifier: string): Promise<string> {
		throw new PterodactylNotImplementedError("game-servers.files.getUploadUrl");
	}
}
