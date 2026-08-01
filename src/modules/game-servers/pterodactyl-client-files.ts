import type { Env } from "../../config/env.js";
import { assertPterodactylConfigured, pterodactylApiKey, pterodactylRequest } from "./pterodactyl-request.js";

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

interface RawFileObjectAttributes {
	name: string;
	mode: string;
	mode_bits: string;
	size: number;
	is_file: boolean;
	is_symlink: boolean;
	mimetype: string;
	created_at: string;
	modified_at: string;
}

function mapFileObject(attrs: RawFileObjectAttributes): PterodactylFileObject {
	return {
		name: attrs.name,
		mode: attrs.mode,
		modeBits: attrs.mode_bits,
		size: attrs.size,
		isFile: attrs.is_file,
		isSymlink: attrs.is_symlink,
		mimetype: attrs.mimetype,
		createdAt: attrs.created_at,
		modifiedAt: attrs.modified_at,
	};
}

/**
 * サーバーのファイル管理(Pterodactyl Client API `files.*`権限に対応)。
 * 参考: https://pterodactyl-api-docs.netvpx.com/docs (Client API Reference > Files)
 * `/api/client/servers/{server}/files/...`を`pterodactylRequest(this.env, "client", ...)`経由で呼び出す。
 */
export class PterodactylFilesClient {
	constructor(private readonly env: Env) {}

	async list(identifier: string, directory: string): Promise<PterodactylFileObject[]> {
		const data = await pterodactylRequest<{ data: Array<{ attributes: RawFileObjectAttributes }> }>(
			this.env,
			"client",
			`/api/client/servers/${identifier}/files/list?directory=${encodeURIComponent(directory)}`,
		);
		return data.data.map((entry) => mapFileObject(entry.attributes));
	}

	/**
	 * ファイル内容の取得はプレーンテキストで返るため(JSONではない)、
	 * `pterodactylRequest`(常にJSONとしてパースする)は使わず、ここだけ直接fetchする。
	 */
	async readContents(identifier: string, file: string): Promise<string> {
		assertPterodactylConfigured(this.env);
		const response = await fetch(
			`${this.env.PTERODACTYL_PANEL_URL}/api/client/servers/${identifier}/files/contents?file=${encodeURIComponent(file)}`,
			{
				headers: {
					Authorization: `Bearer ${pterodactylApiKey(this.env, "client")}`,
					Accept: "text/plain",
				},
			},
		);
		if (!response.ok) {
			throw new Error(`Pterodactyl API error: ${response.status} ${await response.text()}`);
		}
		return response.text();
	}

	/**
	 * ファイル書き込みのリクエストボディは生テキスト(Content-Type: text/plain)であり、
	 * JSON化してはいけない点に注意。
	 */
	async writeContents(identifier: string, file: string, content: string): Promise<void> {
		await pterodactylRequest(
			this.env,
			"client",
			`/api/client/servers/${identifier}/files/write?file=${encodeURIComponent(file)}`,
			{
				method: "POST",
				headers: { "Content-Type": "text/plain" },
				body: content,
			},
		);
	}

	async rename(identifier: string, root: string, files: Array<{ from: string; to: string }>): Promise<void> {
		await pterodactylRequest(this.env, "client", `/api/client/servers/${identifier}/files/rename`, {
			method: "PUT",
			body: JSON.stringify({ root, files }),
		});
	}

	async copy(identifier: string, location: string): Promise<void> {
		await pterodactylRequest(this.env, "client", `/api/client/servers/${identifier}/files/copy`, {
			method: "POST",
			body: JSON.stringify({ location }),
		});
	}

	async compress(identifier: string, root: string, files: string[]): Promise<PterodactylFileObject> {
		const data = await pterodactylRequest<{ attributes: RawFileObjectAttributes }>(
			this.env,
			"client",
			`/api/client/servers/${identifier}/files/compress`,
			{ method: "POST", body: JSON.stringify({ root, files }) },
		);
		return mapFileObject(data.attributes);
	}

	async decompress(identifier: string, root: string, file: string): Promise<void> {
		await pterodactylRequest(this.env, "client", `/api/client/servers/${identifier}/files/decompress`, {
			method: "POST",
			body: JSON.stringify({ root, file }),
		});
	}

	async remove(identifier: string, root: string, files: string[]): Promise<void> {
		await pterodactylRequest(this.env, "client", `/api/client/servers/${identifier}/files/delete`, {
			method: "POST",
			body: JSON.stringify({ root, files }),
		});
	}

	async createFolder(identifier: string, root: string, name: string): Promise<void> {
		await pterodactylRequest(this.env, "client", `/api/client/servers/${identifier}/files/create-folder`, {
			method: "POST",
			body: JSON.stringify({ root, name }),
		});
	}

	async getDownloadUrl(identifier: string, file: string): Promise<string> {
		const data = await pterodactylRequest<{ attributes: { url: string } }>(
			this.env,
			"client",
			`/api/client/servers/${identifier}/files/download?file=${encodeURIComponent(file)}`,
		);
		return data.attributes.url;
	}

	/** 署名付きアップロードURLを取得する。`directory`省略時はルート("/")を対象にする */
	async getUploadUrl(identifier: string, directory = "/"): Promise<string> {
		const data = await pterodactylRequest<{ attributes: { url: string } }>(
			this.env,
			"client",
			`/api/client/servers/${identifier}/files/upload?directory=${encodeURIComponent(directory)}`,
		);
		return data.attributes.url;
	}
}
