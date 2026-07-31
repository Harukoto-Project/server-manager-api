import type { FastifyPluginAsync } from "fastify";
import { safeExec } from "../../lib/exec.js";
import type { ApiModuleContext } from "../types.js";

const PACKAGE_NAME = "fail2ban";

interface IntrusionPreventionStatus {
	installed: boolean;
	active: boolean;
	enabled: boolean;
	jails: string[];
	raw: string;
}

async function isPackageInstalled(): Promise<boolean> {
	const result = await safeExec("dpkg", ["-l", PACKAGE_NAME]);
	if (!result.ok) return false;
	return result.stdout.split("\n").some((line) => line.trim().startsWith("ii") && line.includes(PACKAGE_NAME));
}

function parseJailList(raw: string): string[] {
	const match = raw.match(/Jail list:\s*(.+)/);
	if (!match) return [];
	return (match[1] ?? "")
		.split(",")
		.map((jail) => jail.trim())
		.filter(Boolean);
}

/**
 * 不正アクセス防止(fail2ban)のインストール・状態確認・有効化/無効化モジュール。
 */
const intrusionPreventionModule: FastifyPluginAsync<{ ctx: ApiModuleContext }> = async (fastify, opts) => {
	const { audit } = opts.ctx;

	fastify.get("/status", async (): Promise<IntrusionPreventionStatus> => {
		const installed = await isPackageInstalled();
		if (!installed) {
			return { installed: false, active: false, enabled: false, jails: [], raw: "" };
		}

		const [activeResult, enabledResult, statusResult] = await Promise.all([
			safeExec("systemctl", ["is-active", PACKAGE_NAME]),
			safeExec("systemctl", ["is-enabled", PACKAGE_NAME]),
			safeExec("fail2ban-client", ["status"]),
		]);

		return {
			installed: true,
			active: activeResult.stdout.trim() === "active",
			enabled: enabledResult.stdout.trim() === "enabled",
			jails: statusResult.ok ? parseJailList(statusResult.stdout) : [],
			raw: statusResult.stdout || statusResult.stderr,
		};
	});

	fastify.post("/install", async (request, reply) => {
		const installResult = await safeExec("apt-get", ["install", "-y", PACKAGE_NAME], 5 * 60_000);
		if (!installResult.ok) {
			return reply.code(500).send({ error: installResult.stderr });
		}
		const enableResult = await safeExec("systemctl", ["enable", "--now", PACKAGE_NAME]);
		if (!enableResult.ok) {
			return reply.code(500).send({ error: enableResult.stderr });
		}
		await audit.record({
			actor: "session-user",
			action: "system.intrusion-prevention.install",
			severity: "warning",
		});
		return { ok: true };
	});

	fastify.post("/enable", async (request, reply) => {
		const result = await safeExec("systemctl", ["enable", "--now", PACKAGE_NAME]);
		if (!result.ok) {
			return reply.code(500).send({ error: result.stderr });
		}
		await audit.record({
			actor: "session-user",
			action: "system.intrusion-prevention.enable",
			severity: "warning",
		});
		return { ok: true };
	});

	fastify.post("/disable", async (request, reply) => {
		const result = await safeExec("systemctl", ["disable", "--now", PACKAGE_NAME]);
		if (!result.ok) {
			return reply.code(500).send({ error: result.stderr });
		}
		await audit.record({
			actor: "session-user",
			action: "system.intrusion-prevention.disable",
			severity: "warning",
		});
		return { ok: true };
	});
};

export default intrusionPreventionModule;
