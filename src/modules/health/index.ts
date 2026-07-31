import type { FastifyPluginAsync } from "fastify";
import type { ApiModuleContext } from "../types.js";

const healthModule: FastifyPluginAsync<{ ctx: ApiModuleContext }> = async (fastify) => {
	fastify.get("/", async () => ({
		status: "ok",
		time: new Date().toISOString(),
	}));
};

export default healthModule;
