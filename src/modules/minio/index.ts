import type { FastifyPluginAsync } from "fastify";
import * as Minio from "minio";
import type { ApiModuleContext } from "../types.js";

interface BucketItem {
	name: string;
	prefix?: string;
	size?: number;
	etag?: string;
	lastModified?: Date;
}

function createMinioClient(endpoint: string, accessKey: string, secretKey: string): Minio.Client {
	const url = new URL(endpoint);
	const port = url.port ? parseInt(url.port, 10) : url.protocol === "https:" ? 443 : 80;
	return new Minio.Client({
		endPoint: url.hostname,
		port,
		useSSL: url.protocol === "https:",
		accessKey,
		secretKey,
	});
}

const minioModule: FastifyPluginAsync<{ ctx: ApiModuleContext }> = async (fastify) => {
	const endpoint = process.env.MINIO_ENDPOINT;
	const accessKey = process.env.MINIO_ACCESS_KEY;
	const secretKey = process.env.MINIO_SECRET_KEY;

	const available = Boolean(endpoint && accessKey && secretKey);
	let client: Minio.Client | null = null;
	if (available) {
		client = createMinioClient(endpoint!, accessKey!, secretKey!);
	}

	fastify.get("/status", async () => {
		if (!available || !client) {
			return { available: false };
		}
		try {
			const healthUrl = `${endpoint}/minio/health/live`;
			const response = await fetch(healthUrl, { signal: AbortSignal.timeout(5000) });
			return { available: true, online: response.ok };
		} catch {
			return { available: true, online: false };
		}
	});

	fastify.get("/buckets", async (_, reply) => {
		if (!available || !client) {
			return { available: false, buckets: [] };
		}
		try {
			const buckets = await client.listBuckets();
			return {
				available: true,
				buckets: buckets.map((b) => ({
					name: b.name,
					creationDate: b.creationDate,
				})),
			};
		} catch {
			return reply.code(500).send({ error: "バケット一覧の取得に失敗しました" });
		}
	});

	fastify.get<{ Params: { name: string } }>("/buckets/:name/info", async (request, reply) => {
		if (!available || !client) {
			return { available: false };
		}
		const { name } = request.params;
		try {
			let objectCount = 0;
			let totalSizeBytes = 0;

			await new Promise<void>((resolve, reject) => {
				const stream = client!.listObjectsV2(name, "", true);
				stream.on("data", (obj: BucketItem) => {
					objectCount++;
					totalSizeBytes += obj.size ?? 0;
				});
				stream.on("end", resolve);
				stream.on("error", reject);
			});

			return { available: true, name, objectCount, totalSizeBytes };
		} catch {
			return reply.code(500).send({ error: "バケット情報の取得に失敗しました" });
		}
	});
};

export default minioModule;
