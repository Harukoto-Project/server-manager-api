import pino from "pino";
import type { Env } from "../config/env.js";

export function createLogger(env: Env) {
	return pino({
		level: env.LOG_LEVEL,
		transport:
			env.NODE_ENV === "development"
				? { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } }
				: undefined,
	});
}

export type Logger = ReturnType<typeof createLogger>;
