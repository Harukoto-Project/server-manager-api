import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { safeExec } from "../../lib/exec.js";
import type { ApiModuleContext } from "../types.js";

const ufwRuleSchema = z.object({
	action: z.enum(["allow", "deny", "delete"]),
	rule: z.string().min(1),
});

const hostnameSchema = z.object({
	hostname: z
		.string()
		.min(1)
		.max(253)
		.regex(
			/^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/,
			"ホスト名として使用できない文字が含まれています",
		),
});

const timezoneSchema = z.object({
	timezone: z.string().min(1),
});

const localeSchema = z.object({
	locale: z.string().min(1),
});

function parseLines(output: string): string[] {
	return output
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
}

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

	fastify.post("/basics/hostname", async (request, reply) => {
		const body = hostnameSchema.parse(request.body);
		const result = await safeExec("hostnamectl", ["set-hostname", body.hostname]);
		if (!result.ok) {
			return reply.code(500).send({ error: result.stderr });
		}
		await audit.record({
			actor: "session-user",
			action: "system.basics.hostname",
			target: body.hostname,
			severity: "warning",
		});
		return { ok: true, hostname: body.hostname };
	});

	fastify.get("/basics/timezones", async (request, reply) => {
		const result = await safeExec("timedatectl", ["list-timezones"]);
		if (!result.ok) {
			return reply.code(500).send({ error: result.stderr });
		}
		return { timezones: parseLines(result.stdout) };
	});

	fastify.post("/basics/timezone", async (request, reply) => {
		const body = timezoneSchema.parse(request.body);
		const listResult = await safeExec("timedatectl", ["list-timezones"]);
		if (!listResult.ok) {
			return reply.code(500).send({ error: listResult.stderr });
		}
		const timezones = parseLines(listResult.stdout);
		if (!timezones.includes(body.timezone)) {
			return reply.code(400).send({ error: "不正なタイムゾーンです。" });
		}
		const result = await safeExec("timedatectl", ["set-timezone", body.timezone]);
		if (!result.ok) {
			return reply.code(500).send({ error: result.stderr });
		}
		await audit.record({
			actor: "session-user",
			action: "system.basics.timezone",
			target: body.timezone,
			severity: "warning",
		});
		return { ok: true, timezone: body.timezone };
	});

	fastify.get("/locale", async (request, reply) => {
		const [localesResult, statusResult] = await Promise.all([
			safeExec("locale", ["-a"]),
			safeExec("localectl", ["status"]),
		]);
		if (!localesResult.ok) {
			return reply.code(500).send({ error: localesResult.stderr });
		}
		const locales = parseLines(localesResult.stdout);
		let currentLang = process.env.LANG ?? "";
		if (statusResult.ok) {
			const line = statusResult.stdout.split("\n").find((l) => l.includes("LANG="));
			const match = line?.match(/LANG=([^\s,]+)/);
			if (match?.[1]) currentLang = match[1];
		}
		return { locales, currentLang };
	});

	fastify.post("/locale", async (request, reply) => {
		const body = localeSchema.parse(request.body);
		const localesResult = await safeExec("locale", ["-a"]);
		if (!localesResult.ok) {
			return reply.code(500).send({ error: localesResult.stderr });
		}
		const locales = parseLines(localesResult.stdout);
		if (!locales.includes(body.locale)) {
			return reply.code(400).send({ error: "利用できないロケールです。" });
		}
		const result = await safeExec("localectl", ["set-locale", `LANG=${body.locale}`]);
		if (!result.ok) {
			return reply.code(500).send({ error: result.stderr });
		}
		await audit.record({
			actor: "session-user",
			action: "system.locale.set",
			target: body.locale,
			severity: "warning",
		});
		return {
			ok: true,
			locale: body.locale,
			requiresRestart: true,
			message: "設定を反映するには再ログインまたは再起動が必要な場合があります。",
		};
	});
};

export default systemSettingsModule;
