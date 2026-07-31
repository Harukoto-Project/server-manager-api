import "dotenv/config";
import { loadEnv } from "./config/env.js";
import { buildServer } from "./server.js";

async function main() {
	const env = loadEnv();
	const fastify = await buildServer(env);

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
