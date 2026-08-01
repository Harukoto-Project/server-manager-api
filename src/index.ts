import "dotenv/config";
import { readFileSync } from "node:fs";
import type { ServerOptions } from "node:https";
import { loadEnv } from "./config/env.js";
import { buildServer } from "./server.js";

async function main() {
	const env = loadEnv();

	let httpsOptions: ServerOptions | undefined;
	if (env.TLS_ENABLED) {
		if (!env.TLS_CERT_PATH || !env.TLS_KEY_PATH) {
			console.error(
				"TLS_ENABLED=true のとき TLS_CERT_PATH と TLS_KEY_PATH の両方を指定してください。\n" +
					"scripts/setup-tls.sh を実行して証明書を生成してください。",
			);
			process.exit(1);
		}
		try {
			const cert = readFileSync(env.TLS_CERT_PATH);
			const key = readFileSync(env.TLS_KEY_PATH);
			httpsOptions = { cert, key };
			console.info(`TLS 有効: 証明書=${env.TLS_CERT_PATH}, 鍵=${env.TLS_KEY_PATH}`);
		} catch (err) {
			console.error(
				"TLS 証明書ファイルの読み込みに失敗しました。パスと権限を確認してください。\n" +
					`TLS_CERT_PATH=${env.TLS_CERT_PATH}\nTLS_KEY_PATH=${env.TLS_KEY_PATH}`,
				err,
			);
			process.exit(1);
		}
	}

	const fastify = await buildServer(env, httpsOptions);

	try {
		await fastify.listen({ host: env.HOST, port: env.PORT });
	} catch (error) {
		fastify.log.error(error);
		process.exit(1);
	}

	for (const signal of ["SIGINT", "SIGTERM"] as const) {
		process.on(signal, async () => {
			await fastify.close();
			process.exit(0);
		});
	}
}

main();
