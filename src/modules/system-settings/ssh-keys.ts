import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { safeExec } from "../../lib/exec.js";
import type { ApiModuleContext } from "../types.js";
import { listHumanUsers, usernameSchema } from "./users-groups.js";

const SSH_KEY_TYPE_REGEX =
	/^(ssh-rsa|ssh-ed25519|ssh-dss|ecdsa-sha2-nistp256|ecdsa-sha2-nistp384|ecdsa-sha2-nistp521|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com)$/;

const SSH_PUBLIC_KEY_REGEX =
	/^(ssh-rsa|ssh-ed25519|ssh-dss|ecdsa-sha2-nistp256|ecdsa-sha2-nistp384|ecdsa-sha2-nistp521|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com)\s+\S+/;

interface SshKeyEntry {
	index: number;
	keyType: string;
	key: string;
	comment: string;
	raw: string;
}

function parseAuthorizedKeysLine(line: string): Omit<SshKeyEntry, "index"> {
	const parts = line.trim().split(/\s+/);
	const typeIndex = parts.findIndex((part) => SSH_KEY_TYPE_REGEX.test(part));
	if (typeIndex === -1) {
		return { keyType: "unknown", key: line.trim(), comment: "", raw: line };
	}
	return {
		keyType: parts[typeIndex] ?? "unknown",
		key: parts[typeIndex + 1] ?? "",
		comment: parts.slice(typeIndex + 2).join(" "),
		raw: line,
	};
}

async function resolveUserOrNull(username: string) {
	const humanUsers = await listHumanUsers();
	return humanUsers.find((user) => user.username === username) ?? null;
}

function authorizedKeysPathFor(homeDir: string): { sshDir: string; authorizedKeysPath: string } {
	const sshDir = path.join(homeDir, ".ssh");
	return { sshDir, authorizedKeysPath: path.join(sshDir, "authorized_keys") };
}

const usernameParamsSchema = z.object({ username: usernameSchema });
const indexParamsSchema = z.object({
	username: usernameSchema,
	index: z.coerce.number().int().min(0),
});
const addKeySchema = z.object({
	key: z.string().min(20).max(4096).regex(SSH_PUBLIC_KEY_REGEX, "有効なSSH公開鍵の形式ではありません。"),
});

/**
 * SSH公開鍵管理モジュール(system-settingsの`ssh-keys`カテゴリ対応)。
 * 対象ユーザーは`/users`(users-groups)で取得できる一覧に存在するものだけを許可し、パストラバーサルを防ぐ。
 */
const sshKeysModule: FastifyPluginAsync<{ ctx: ApiModuleContext }> = async (fastify, opts) => {
	const { audit } = opts.ctx;

	fastify.get<{ Params: { username: string } }>("/:username", async (request, reply) => {
		const { username } = usernameParamsSchema.parse(request.params);
		const user = await resolveUserOrNull(username);
		if (!user) {
			return reply.code(404).send({ error: "指定されたユーザーが見つかりません。" });
		}

		const { authorizedKeysPath } = authorizedKeysPathFor(user.homeDir);
		try {
			const raw = await readFile(authorizedKeysPath, "utf8");
			const keys: SshKeyEntry[] = raw
				.split("\n")
				.map((line) => line.trim())
				.filter((line) => line.length > 0 && !line.startsWith("#"))
				.map((line, index) => ({ index, ...parseAuthorizedKeysLine(line) }));
			return { keys };
		} catch {
			return { keys: [] };
		}
	});

	fastify.post<{ Params: { username: string } }>("/:username", async (request, reply) => {
		const { username } = usernameParamsSchema.parse(request.params);
		const body = addKeySchema.parse(request.body);
		const user = await resolveUserOrNull(username);
		if (!user) {
			return reply.code(404).send({ error: "指定されたユーザーが見つかりません。" });
		}

		const { sshDir, authorizedKeysPath } = authorizedKeysPathFor(user.homeDir);
		await mkdir(sshDir, { recursive: true, mode: 0o700 });

		let existing = "";
		try {
			existing = await readFile(authorizedKeysPath, "utf8");
		} catch {
			existing = "";
		}

		const trimmedKey = body.key.trim();
		const separator = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
		await writeFile(authorizedKeysPath, `${existing}${separator}${trimmedKey}\n`, { mode: 0o600 });

		await safeExec("chown", ["-R", `${user.uid}:${user.gid}`, sshDir]);
		await safeExec("chmod", ["700", sshDir]);
		await safeExec("chmod", ["600", authorizedKeysPath]);

		await audit.record({
			actor: "session-user",
			action: "system.ssh-keys.add",
			target: username,
			severity: "critical",
		});
		return { ok: true };
	});

	fastify.delete<{ Params: { username: string; index: string } }>("/:username/:index", async (request, reply) => {
		const { username, index } = indexParamsSchema.parse(request.params);
		const user = await resolveUserOrNull(username);
		if (!user) {
			return reply.code(404).send({ error: "指定されたユーザーが見つかりません。" });
		}

		const { authorizedKeysPath } = authorizedKeysPathFor(user.homeDir);
		let raw: string;
		try {
			raw = await readFile(authorizedKeysPath, "utf8");
		} catch {
			return reply.code(404).send({ error: "鍵ファイルが見つかりません。" });
		}

		const lines = raw.split("\n");
		const validLineIndexes = lines
			.map((line, lineIndex) => ({ line, lineIndex }))
			.filter(({ line }) => line.trim().length > 0 && !line.trim().startsWith("#"));
		const target = validLineIndexes[index];
		if (!target) {
			return reply.code(404).send({ error: "指定された鍵が見つかりません。" });
		}

		const nextLines = lines.filter((_, lineIndex) => lineIndex !== target.lineIndex);
		const nextContent = nextLines.join("\n").replace(/\n+$/, "");
		await writeFile(authorizedKeysPath, nextContent.length > 0 ? `${nextContent}\n` : "", { mode: 0o600 });

		await audit.record({
			actor: "session-user",
			action: "system.ssh-keys.remove",
			target: username,
			detail: { index },
			severity: "critical",
		});
		return { ok: true };
	});
};

export default sshKeysModule;
