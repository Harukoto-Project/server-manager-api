import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyPluginAsync } from "fastify";
import type { ApiModuleContext } from "../types.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const packageJsonPath = path.join(currentDir, "../../../package.json");
const { version } = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version: string };

const healthModule: FastifyPluginAsync<{ ctx: ApiModuleContext }> = async (fastify) => {
	fastify.get("/", async () => ({
		status: "ok",
		time: new Date().toISOString(),
		version,
	}));
};

export default healthModule;
