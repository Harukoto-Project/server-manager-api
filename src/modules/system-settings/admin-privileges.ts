import { userInfo } from "node:os";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { safeExec } from "../../lib/exec.js";
import type { ApiModuleContext } from "../types.js";
import { listHumanUsers, usernameSchema } from "./users-groups.js";

const ADMIN_GROUPS = ["sudo", "wheel"];

async function listGroupMembers(groupName: string): Promise<string[]> {
	const result = await safeExec("getent", ["group", groupName]);
	if (!result.ok) return [];
	const membersField = result.stdout.trim().split(":")[3] ?? "";
	return membersField
		.split(",")
		.map((member) => member.trim())
		.filter(Boolean);
}

const usernameParamsSchema = z.object({ username: usernameSchema });

/**
 * 管理者権限(sudo)の管理モジュール(system-settingsの`admin-privileges`カテゴリ対応)。
 * `/etc/sudoers`は直接編集せず、グループ操作(usermod/gpasswd)のみで実装する。
 */
const adminPrivilegesModule: FastifyPluginAsync<{ ctx: ApiModuleContext }> = async (fastify, opts) => {
	const { audit } = opts.ctx;

	fastify.get("/admin-users", async () => {
		const membersByGroup = await Promise.all(ADMIN_GROUPS.map((group) => listGroupMembers(group)));
		const usernames = new Set<string>();
		for (const members of membersByGroup) {
			for (const member of members) usernames.add(member);
		}
		const admins = Array.from(usernames)
			.sort()
			.map((username) => ({
				username,
				groups: ADMIN_GROUPS.filter((group, index) => membersByGroup[index]?.includes(username)),
			}));
		return { admins };
	});

	fastify.post<{ Params: { username: string } }>("/admin-users/:username", async (request, reply) => {
		const { username } = usernameParamsSchema.parse(request.params);
		const humanUsers = await listHumanUsers();
		if (!humanUsers.some((user) => user.username === username)) {
			return reply.code(404).send({ error: "指定されたユーザーが見つかりません。" });
		}

		const result = await safeExec("usermod", ["-aG", "sudo", username]);
		if (!result.ok) {
			return reply.code(500).send({ error: result.stderr || "管理者権限の付与に失敗しました。" });
		}

		await audit.record({
			actor: "session-user",
			action: "system.admin-privileges.grant",
			target: username,
			severity: "critical",
		});
		return { ok: true };
	});

	fastify.delete<{ Params: { username: string } }>("/admin-users/:username", async (request, reply) => {
		const { username } = usernameParamsSchema.parse(request.params);
		if (username === userInfo().username) {
			return reply
				.code(400)
				.send({ error: "現在このAPIを実行しているシステムユーザー自身の管理者権限は削除できません。" });
		}

		const result = await safeExec("gpasswd", ["-d", username, "sudo"]);
		if (!result.ok) {
			return reply.code(500).send({ error: result.stderr || "管理者権限の削除に失敗しました。" });
		}

		await audit.record({
			actor: "session-user",
			action: "system.admin-privileges.revoke",
			target: username,
			severity: "critical",
		});
		return { ok: true };
	});
};

export default adminPrivilegesModule;
