import { Client, type ClientChannel } from "ssh2";
import type { WebSocket } from "ws";
import type { AuditLogger } from "../../lib/audit.js";

interface AuthMessage {
	type: "auth";
	username: string;
	password: string;
	cols?: number;
	rows?: number;
}

interface InputMessage {
	type: "input";
	data: string;
}

interface ResizeMessage {
	type: "resize";
	cols: number;
	rows: number;
}

type ClientMessage = AuthMessage | InputMessage | ResizeMessage;

interface TerminalSessionOptions {
	host: string;
	port: number;
	audit: AuditLogger;
	clientIp: string;
}

function isClientMessage(value: unknown): value is ClientMessage {
	return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

function send(socket: WebSocket, message: Record<string, unknown>): void {
	if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

/**
 * Webターミナルの1接続分のセッション。
 * クライアントからの最初のメッセージ(ユーザー名/パスワード)でノード自身のsshdに
 * SSH接続し、認証をsshd(PAM)に委ねる。認証成功後はPTYの入出力をそのままWebSocketへ中継する。
 * パスワードはメモリ上でssh2に渡すのみで、ログ・監査ログ・ディスクには一切残さない。
 */
export function handleTerminalConnection(socket: WebSocket, options: TerminalSessionOptions): void {
	const { host, port, audit, clientIp } = options;

	let authenticatedUsername: string | undefined;
	let sshClient: Client | undefined;
	let sshStream: ClientChannel | undefined;

	function cleanup(): void {
		sshStream?.end();
		sshClient?.end();
		sshStream = undefined;
		sshClient = undefined;
	}

	function beginAuth(message: AuthMessage): void {
		if (sshClient) return;

		const client = new Client();
		sshClient = client;

		client.on("ready", () => {
			client.shell(
				{ cols: message.cols ?? 80, rows: message.rows ?? 24, term: "xterm-256color" },
				(error, stream) => {
					if (error || !stream) {
						send(socket, { type: "auth-error", message: "シェルの起動に失敗しました。" });
						cleanup();
						return;
					}

					authenticatedUsername = message.username;
					sshStream = stream;
					send(socket, { type: "auth-success" });
					void audit.record({
						actor: message.username,
						action: "terminal.login",
						target: clientIp,
						severity: "info",
					});

					stream.on("data", (chunk: Buffer) => send(socket, { type: "data", data: chunk.toString("utf8") }));
					stream.stderr?.on("data", (chunk: Buffer) => send(socket, { type: "data", data: chunk.toString("utf8") }));
					stream.on("close", () => {
						send(socket, { type: "exit" });
						void audit.record({ actor: message.username, action: "terminal.disconnect", target: clientIp });
						cleanup();
					});
				},
			);
		});

		client.on("error", () => {
			send(socket, { type: "auth-error", message: "ログインに失敗しました。ユーザー名とパスワードを確認してください。" });
			void audit.record({
				actor: message.username,
				action: "terminal.login.rejected",
				target: clientIp,
				severity: "warning",
			});
			cleanup();
		});

		client.connect({
			host,
			port,
			username: message.username,
			password: message.password,
			readyTimeout: 10_000,
			tryKeyboard: false,
		});
	}

	socket.on("message", (raw) => {
		let message: unknown;
		try {
			message = JSON.parse(raw.toString());
		} catch {
			return;
		}
		if (!isClientMessage(message)) return;

		if (message.type === "auth") {
			if (!authenticatedUsername) beginAuth(message);
			return;
		}

		if (!sshStream) return;

		if (message.type === "input") {
			sshStream.write(message.data);
		} else if (message.type === "resize") {
			sshStream.setWindow(message.rows, message.cols, 0, 0);
		}
	});

	socket.on("close", () => cleanup());
}
