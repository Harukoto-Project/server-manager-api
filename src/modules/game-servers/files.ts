import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { ApiModuleContext } from "../types.js";
import { PterodactylFilesClient } from "./pterodactyl-client-files.js";
import { respondPterodactylError } from "./pterodactyl-request.js";

const renameBodySchema = z.object({
	root: z.string(),
	files: z.array(z.object({ from: z.string(), to: z.string() })),
});
const copyBodySchema = z.object({ location: z.string() });
const compressBodySchema = z.object({ root: z.string(), files: z.array(z.string()) });
const decompressBodySchema = z.object({ root: z.string(), file: z.string() });
const deleteBodySchema = z.object({ root: z.string(), files: z.array(z.string()) });
const createFolderBodySchema = z.object({ root: z.string(), name: z.string() });
const writeBodySchema = z.object({ content: z.string() });

/**
 * サーバー詳細ページの「ファイル管理」タブに対応するAPI。
 * ロジック本体は`pterodactyl-client-files.ts`の`PterodactylFilesClient`に実装する。
 */
const filesModule: FastifyPluginAsync<{ ctx: ApiModuleContext }> = async (fastify, opts) => {
	const { audit } = opts.ctx;
	const client = new PterodactylFilesClient(opts.ctx.env);

	fastify.get<{ Params: { identifier: string }; Querystring: { directory?: string } }>(
		"/:identifier/list",
		async (request, reply) => {
			try {
				const files = await client.list(request.params.identifier, request.query.directory ?? "/");
				return { files };
			} catch (error) {
				return respondPterodactylError(reply, error);
			}
		},
	);

	fastify.get<{ Params: { identifier: string }; Querystring: { file: string } }>(
		"/:identifier/contents",
		async (request, reply) => {
			try {
				const content = await client.readContents(request.params.identifier, request.query.file);
				return { content };
			} catch (error) {
				return respondPterodactylError(reply, error);
			}
		},
	);

	fastify.post<{
		Params: { identifier: string };
		Querystring: { file: string };
		Body: z.infer<typeof writeBodySchema>;
	}>("/:identifier/write", async (request, reply) => {
		const body = writeBodySchema.parse(request.body);
		try {
			await client.writeContents(request.params.identifier, request.query.file, body.content);
		} catch (error) {
			return respondPterodactylError(reply, error);
		}
		await audit.record({
			actor: "session-user",
			action: "game-server.files.write",
			target: `${request.params.identifier}:${request.query.file}`,
			severity: "warning",
		});
		return { ok: true };
	});

	fastify.put<{ Params: { identifier: string }; Body: z.infer<typeof renameBodySchema> }>(
		"/:identifier/rename",
		async (request, reply) => {
			const body = renameBodySchema.parse(request.body);
			try {
				await client.rename(request.params.identifier, body.root, body.files);
			} catch (error) {
				return respondPterodactylError(reply, error);
			}
			return { ok: true };
		},
	);

	fastify.post<{ Params: { identifier: string }; Body: z.infer<typeof copyBodySchema> }>(
		"/:identifier/copy",
		async (request, reply) => {
			const body = copyBodySchema.parse(request.body);
			try {
				await client.copy(request.params.identifier, body.location);
			} catch (error) {
				return respondPterodactylError(reply, error);
			}
			return { ok: true };
		},
	);

	fastify.post<{ Params: { identifier: string }; Body: z.infer<typeof compressBodySchema> }>(
		"/:identifier/compress",
		async (request, reply) => {
			const body = compressBodySchema.parse(request.body);
			try {
				const file = await client.compress(request.params.identifier, body.root, body.files);
				return { file };
			} catch (error) {
				return respondPterodactylError(reply, error);
			}
		},
	);

	fastify.post<{ Params: { identifier: string }; Body: z.infer<typeof decompressBodySchema> }>(
		"/:identifier/decompress",
		async (request, reply) => {
			const body = decompressBodySchema.parse(request.body);
			try {
				await client.decompress(request.params.identifier, body.root, body.file);
			} catch (error) {
				return respondPterodactylError(reply, error);
			}
			return { ok: true };
		},
	);

	fastify.post<{ Params: { identifier: string }; Body: z.infer<typeof deleteBodySchema> }>(
		"/:identifier/delete",
		async (request, reply) => {
			const body = deleteBodySchema.parse(request.body);
			try {
				await client.remove(request.params.identifier, body.root, body.files);
			} catch (error) {
				return respondPterodactylError(reply, error);
			}
			await audit.record({
				actor: "session-user",
				action: "game-server.files.delete",
				target: `${request.params.identifier}:${body.root}`,
				severity: "warning",
			});
			return { ok: true };
		},
	);

	fastify.post<{ Params: { identifier: string }; Body: z.infer<typeof createFolderBodySchema> }>(
		"/:identifier/create-folder",
		async (request, reply) => {
			const body = createFolderBodySchema.parse(request.body);
			try {
				await client.createFolder(request.params.identifier, body.root, body.name);
			} catch (error) {
				return respondPterodactylError(reply, error);
			}
			return { ok: true };
		},
	);

	fastify.get<{ Params: { identifier: string }; Querystring: { file: string } }>(
		"/:identifier/download",
		async (request, reply) => {
			try {
				const url = await client.getDownloadUrl(request.params.identifier, request.query.file);
				return { url };
			} catch (error) {
				return respondPterodactylError(reply, error);
			}
		},
	);

	fastify.post<{ Params: { identifier: string } }>("/:identifier/upload", async (request, reply) => {
		try {
			const url = await client.getUploadUrl(request.params.identifier);
			return { url };
		} catch (error) {
			return respondPterodactylError(reply, error);
		}
	});
};

export default filesModule;
