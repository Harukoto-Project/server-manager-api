import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { safeExec } from "../../lib/exec.js";
import type { ApiModuleContext } from "../types.js";

const ufwRuleSchema = z.object({
	action: z.enum(["allow", "deny", "delete"]),
	rule: z.string().min(1),
});

/**
 * システム設定GUIモジュール(Notion「システム設定GUIの拡充」対応)。
 * apt更新確認・UFWルール編集・ホスト名/タイムゾーン等の基本設定を1モジュールに集約する。
 *
 * TODO: ユーザー/グループ管理、ネットワークインターフェース設定、cron/systemdタイマー管理、
 * ストレージ閲覧は今後この配下にサブルートとして追加していく(モジュール内部で機能を積み増す形)。
 */
const systemSettingsModule: FastifyPluginAsync<{ ctx: ApiModuleContext }> = async (fastify, opts) => {
	const { audit } = opts.ctx;

	fastify.get("/apt/updates", async (request, reply) => {
		const result = await safeExec("apt", ["list", "--upgradable"]);
		if (!result.ok) {
			return reply.code(500).send({ error: result.stderr });
		}
		const packages = result.stdout
			.split("\n")
			.slice(1)
			.filter(Boolean)
			.map((line) => line.split("/")[0]);
		return { packages };
	});

	fastify.post("/apt/upgrade", async (request, reply) => {
		const result = await safeExec("apt-get", ["-y", "upgrade"], 10 * 60_000);
		if (!result.ok) {
			return reply.code(500).send({ error: result.stderr });
		}
		await audit.record({ actor: "session-user", action: "system.apt.upgrade", severity: "critical" });
		return { ok: true, output: result.stdout };
	});

	fastify.get("/ufw/status", async (request, reply) => {
		const result = await safeExec("ufw", ["status", "numbered"]);
		if (!result.ok) {
			return reply.code(500).send({ error: result.stderr });
		}
		return { status: result.stdout };
	});

	fastify.post("/ufw/rule", async (request, reply) => {
		const body = ufwRuleSchema.parse(request.body);
		const args = body.action === "delete" ? ["delete", "allow", body.rule] : [body.action, body.rule];
		const result = await safeExec("ufw", args);
		if (!result.ok) {
			return reply.code(500).send({ error: result.stderr });
		}
		await audit.record({
			actor: "session-user",
			action: `system.ufw.${body.action}`,
			target: body.rule,
			severity: "warning",
		});
		return { ok: true };
	});

	fastify.get("/basics", async (request, reply) => {
		const [hostname, timezone] = await Promise.all([
			safeExec("hostnamectl", ["--static"]),
			safeExec("timedatectl", ["show", "--property=Timezone", "--value"]),
		]);
		return {
			hostname: hostname.stdout.trim(),
			timezone: timezone.stdout.trim(),
		};
	});
};

export default systemSettingsModule;
