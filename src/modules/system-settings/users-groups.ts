import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { userInfo } from "node:os";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { safeExec } from "../../lib/exec.js";
import type { ApiModuleContext } from "../types.js";

export const usernameSchema = z
	.string()
	.regex(/^[a-z][-a-z0-9_]{0,31}$/, "ユーザー名は英小文字で始まり、英小文字・数字・-・_のみ使用できます。");

const NOLOGIN_SHELLS = new Set(["/usr/sbin/nologin", "/sbin/nologin", "/bin/false", "/usr/bin/false", ""]);

export interface SystemHumanUser {
	username: string;
	uid: number;
	gid: number;
	homeDir: string;
	shell: string;
}

export async function listHumanUsers(): Promise<SystemHumanUser[]> {
	const raw = await readFile("/etc/passwd", "utf8");
	return raw
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith("#"))
		.map((line) => line.split(":"))
		.filter((fields) => fields.length >= 7)
		.map((fields) => ({
			username: fields[0] ?? "",
			uid: Number(fields[2] ?? "0"),
			gid: Number(fields[3] ?? "0"),
			homeDir: fields[5] ?? "",
			shell: fields[6] ?? "",
		}))
		.filter(
			(user) =>
				user.username.length > 0 &&
				user.username !== "nobody" &&
				user.uid >= 1000 &&
				user.uid < 65534 &&
				!NOLOGIN_SHELLS.has(user.shell),
		);
}

function execWithStdin(command: string, args: string[], input: string): Promise<{ ok: boolean; stderr: string }> {
	return new Promise((resolve) => {
		const child = spawn(command, args, { shell: false, windowsHide: true });
		let stderr = "";
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		child.on("error", (error) => resolve({ ok: false, stderr: error.message }));
		child.on("close", (code) => resolve({ ok: code === 0, stderr }));
		child.stdin.write(input);
		child.stdin.end();
	});
}

const createUserSchema = z.object({
	username: usernameSchema,
	password: z.string().min(8).max(128).optional(),
});

/**
 * ユーザー・グループ管理モジュール(system-settingsの`users-groups`カテゴリ対応)。
 */
const usersGroupsModule: FastifyPluginAsync<{ ctx: ApiModuleContext }> = async (fastify, opts) => {
	const { audit } = opts.ctx;

	fastify.get("/users", async () => {
		const users = await listHumanUsers();
		return {
			users: users.map(({ username, uid, homeDir, shell }) => ({ username, uid, homeDir, shell })),
		};
	});

	fastify.get("/groups", async (request, reply) => {
		const result = await safeExec("getent", ["group"]);
		if (!result.ok) {
			return reply.code(500).send({ error: result.stderr || "グループ一覧の取得に失敗しました。" });
		}
		const groups = result.stdout
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => {
				const fields = line.split(":");
				const membersField = fields[3] ?? "";
				return {
					name: fields[0] ?? "",
					gid: Number(fields[2] ?? "0"),
					members: membersField
						.split(",")
						.map((member) => member.trim())
						.filter(Boolean),
				};
			});
		return { groups };
	});

	fastify.post("/users", async (request, reply) => {
		const body = createUserSchema.parse(request.body);
		const existingUsers = await listHumanUsers();
		if (existingUsers.some((user) => user.username === body.username)) {
			return reply.code(409).send({ error: "同じ名前のユーザーが既に存在します。" });
		}

		const result = await safeExec("useradd", ["-m", "-s", "/bin/bash", body.username], 30_000);
		if (!result.ok) {
			return reply.code(500).send({ error: result.stderr || "ユーザーの作成に失敗しました。" });
		}

		if (body.password) {
			const chpasswdResult = await execWithStdin("chpasswd", [], `${body.username}:${body.password}\n`);
			if (!chpasswdResult.ok) {
				await audit.record({
					actor: "session-user",
					action: "system.users-groups.create-user",
					target: body.username,
					detail: { passwordSet: false },
					severity: "warning",
				});
				return reply.code(500).send({
					error: `ユーザーは作成されましたが、初期パスワードの設定に失敗しました: ${chpasswdResult.stderr}`,
				});
			}
		}

		await audit.record({
			actor: "session-user",
			action: "system.users-groups.create-user",
			target: body.username,
			detail: { passwordSet: Boolean(body.password) },
			severity: "critical",
		});
		return { ok: true, username: body.username };
	});

	fastify.delete<{ Params: { username: string } }>("/users/:username", async (request, reply) => {
		const username = usernameSchema.parse(request.params.username);
		const existingUsers = await listHumanUsers();
		if (!existingUsers.some((user) => user.username === username)) {
			return reply.code(404).send({ error: "指定されたユーザーが見つかりません。" });
		}
		if (username === userInfo().username) {
			return reply.code(400).send({ error: "現在このAPIを実行しているシステムユーザー自身は削除できません。" });
		}

		const result = await safeExec("userdel", ["-r", username], 30_000);
		if (!result.ok) {
			return reply.code(500).send({ error: result.stderr || "ユーザーの削除に失敗しました。" });
		}

		await audit.record({
			actor: "session-user",
			action: "system.users-groups.delete-user",
			target: username,
			severity: "critical",
		});
		return { ok: true };
	});
};

export default usersGroupsModule;
