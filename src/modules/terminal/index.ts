import type { FastifyPluginAsync } from "fastify";
import type { ApiModuleContext } from "../types.js";
import { handleTerminalConnection } from "./session.js";

/**
 * Webターミナルモジュール。
 * WebSocket接続後、最初にクライアントから送られるユーザー名/パスワードでノード自身の
 * sshdへSSH接続することでログイン画面(Linuxユーザー認証)を実現し、以降はPTYの入出力を中継する。
 * (このモジュール自体は共有アクセストークン認証の配下にあるため、認証は2段階になる)
 */
const terminalModule: FastifyPluginAsync<{ ctx: ApiModuleContext }> = async (fastify, opts) => {
	const { env, audit } = opts.ctx;

	fastify.get("/session", { websocket: true }, (socket, request) => {
		handleTerminalConnection(socket, {
			host: env.TERMINAL_SSH_HOST,
			port: env.TERMINAL_SSH_PORT,
			audit,
			logger: fastify.log,
			clientIp: request.ip,
		});
	});
};

export default terminalModule;
