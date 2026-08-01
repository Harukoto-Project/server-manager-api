import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { ApiModuleContext } from "../types.js";

const BLOCKED_PATHS = ["/proc", "/sys", "/dev", "/run/udev"];

const MAX_READ_BYTES = 2 * 1024 * 1024;

function isBlockedPath(resolved: string): boolean {
	return BLOCKED_PATHS.some((blocked) => resolved === blocked || resolved.startsWith(`${blocked}/`));
}

function safePath(inputPath: string, root: string): string {
	const resolved = path.resolve(root, inputPath.startsWith("/") ? inputPath.slice(1) : inputPath);

	if (root !== "/" && !resolved.startsWith(root + path.sep) && resolved !== root) {
		throw Object.assign(new Error("許可されたルートディレクトリ外へのアクセスは禁止されています。"), { statusCode: 403 });
	}

	if (isBlockedPath(resolved)) {
		throw Object.assign(new Error("カーネル仮想FSへのアクセスはブロックされています。"), { statusCode: 403 });
	}

	return resolved;
}

const writeBodySchema = z.object({
	path: z.string().min(1),
	content: z.string(),
});

const pathBodySchema = z.object({
	path: z.string().min(1),
});

const renameBodySchema = z.object({
	oldPath: z.string().min(1),
	newPath: z.string().min(1),
});

const fileManagerModule: FastifyPluginAsync<{ ctx: ApiModuleContext }> = async (fastify, opts) => {
	const { audit, env } = opts.ctx;
	const root = env.FILE_MANAGER_ROOT;

	fastify.get("/list", async (request, reply) => {
		const { path: queryPath } = request.query as { path?: string };
		const targetPath = queryPath ?? "/";

		let resolved: string;
		try {
			resolved = safePath(targetPath, root);
		} catch (error) {
			return reply.code((error as { statusCode?: number }).statusCode ?? 400).send({ error: (error as Error).message });
		}

		let entries;
		try {
			entries = await readdir(resolved, { withFileTypes: true });
		} catch {
			return reply.code(404).send({ error: "ディレクトリが見つかりません。" });
		}

		const items = await Promise.all(
			entries.map(async (entry) => {
				const fullPath = path.join(resolved, entry.name);
				let size: number | null = null;
				let modifiedAt: string | null = null;
				let permissions: string | null = null;

				try {
					const info = await stat(fullPath);
					size = info.size;
					modifiedAt = info.mtime.toISOString();
					permissions = (info.mode & 0o777).toString(8).padStart(3, "0");
				} catch {
					// アクセス不可の場合はnullのまま
				}

				return {
					name: entry.name,
					type: entry.isDirectory() ? "directory" : "file",
					size,
					modifiedAt,
					permissions,
					path: path.join(targetPath, entry.name).replace(/\\/g, "/"),
				};
			}),
		);

		return { path: targetPath, items };
	});

	fastify.get("/read", async (request, reply) => {
		const { path: queryPath } = request.query as { path?: string };
		if (!queryPath) return reply.code(400).send({ error: "path パラメーターが必要です。" });

		let resolved: string;
		try {
			resolved = safePath(queryPath, root);
		} catch (error) {
			return reply.code((error as { statusCode?: number }).statusCode ?? 400).send({ error: (error as Error).message });
		}

		let info;
		try {
			info = await stat(resolved);
		} catch {
			return reply.code(404).send({ error: "ファイルが見つかりません。" });
		}

		if (info.isDirectory()) {
			return reply.code(400).send({ error: "指定されたパスはディレクトリです。" });
		}

		if (info.size > MAX_READ_BYTES) {
			return reply.code(413).send({ error: `ファイルサイズが上限(${MAX_READ_BYTES / 1024 / 1024}MB)を超えています。` });
		}

		let content: string;
		try {
			const buffer = await readFile(resolved);
			if (buffer.includes(0)) {
				return { isBinary: true, content: null };
			}
			content = buffer.toString("utf8");
		} catch {
			return reply.code(500).send({ error: "ファイルを読み取れませんでした。" });
		}

		return { isBinary: false, content };
	});

	fastify.post("/write", async (request, reply) => {
		let body: z.infer<typeof writeBodySchema>;
		try {
			body = writeBodySchema.parse(request.body);
		} catch {
			return reply.code(400).send({ error: "リクエストボディが不正です。" });
		}

		let resolved: string;
		try {
			resolved = safePath(body.path, root);
		} catch (error) {
			return reply.code((error as { statusCode?: number }).statusCode ?? 400).send({ error: (error as Error).message });
		}

		try {
			await writeFile(resolved, body.content, "utf8");
		} catch {
			return reply.code(500).send({ error: "ファイルの書き込みに失敗しました。" });
		}

		await audit.record({
			actor: "session-user",
			action: "file-manager.write",
			target: body.path,
			severity: "warning",
		});

		return { ok: true };
	});

	fastify.post("/mkdir", async (request, reply) => {
		let body: z.infer<typeof pathBodySchema>;
		try {
			body = pathBodySchema.parse(request.body);
		} catch {
			return reply.code(400).send({ error: "リクエストボディが不正です。" });
		}

		let resolved: string;
		try {
			resolved = safePath(body.path, root);
		} catch (error) {
			return reply.code((error as { statusCode?: number }).statusCode ?? 400).send({ error: (error as Error).message });
		}

		try {
			await mkdir(resolved, { recursive: true });
		} catch {
			return reply.code(500).send({ error: "ディレクトリの作成に失敗しました。" });
		}

		await audit.record({
			actor: "session-user",
			action: "file-manager.mkdir",
			target: body.path,
			severity: "warning",
		});

		return { ok: true };
	});

	fastify.delete("/delete", async (request, reply) => {
		let body: z.infer<typeof pathBodySchema>;
		try {
			body = pathBodySchema.parse(request.body);
		} catch {
			return reply.code(400).send({ error: "リクエストボディが不正です。" });
		}

		let resolved: string;
		try {
			resolved = safePath(body.path, root);
		} catch (error) {
			return reply.code((error as { statusCode?: number }).statusCode ?? 400).send({ error: (error as Error).message });
		}

		try {
			await rm(resolved, { recursive: true, force: true });
		} catch {
			return reply.code(500).send({ error: "削除に失敗しました。" });
		}

		await audit.record({
			actor: "session-user",
			action: "file-manager.delete",
			target: body.path,
			severity: "warning",
		});

		return { ok: true };
	});

	fastify.post("/rename", async (request, reply) => {
		let body: z.infer<typeof renameBodySchema>;
		try {
			body = renameBodySchema.parse(request.body);
		} catch {
			return reply.code(400).send({ error: "リクエストボディが不正です。" });
		}

		let resolvedOld: string;
		let resolvedNew: string;
		try {
			resolvedOld = safePath(body.oldPath, root);
			resolvedNew = safePath(body.newPath, root);
		} catch (error) {
			return reply.code((error as { statusCode?: number }).statusCode ?? 400).send({ error: (error as Error).message });
		}

		try {
			await rename(resolvedOld, resolvedNew);
		} catch {
			return reply.code(500).send({ error: "名前変更/移動に失敗しました。" });
		}

		await audit.record({
			actor: "session-user",
			action: "file-manager.rename",
			target: `${body.oldPath} -> ${body.newPath}`,
			severity: "warning",
		});

		return { ok: true };
	});
};

export default fileManagerModule;
