import { readFile, writeFile } from "node:fs/promises";
import type { FastifyPluginAsync } from "fastify";
import { safeExec } from "../../lib/exec.js";
import type { ApiModuleContext } from "../types.js";

const CONFIG_PATH = "/etc/apt/apt.conf.d/20auto-upgrades";
const PACKAGE_NAME = "unattended-upgrades";

interface AutoSecurityUpdatesStatus {
	installed: boolean;
	configExists: boolean;
	updatePackageListsEnabled: boolean;
	unattendedUpgradeEnabled: boolean;
	raw: string;
}

async function readConfig(): Promise<{ exists: boolean; raw: string }> {
	try {
		const raw = await readFile(CONFIG_PATH, "utf8");
		return { exists: true, raw };
	} catch {
		return { exists: false, raw: "" };
	}
}

function parsePeriodicValue(raw: string, key: string): boolean {
	const match = raw.match(new RegExp(`${key}\\s+"(\\d)"`));
	return match?.[1] === "1";
}

async function isPackageInstalled(): Promise<boolean> {
	const result = await safeExec("dpkg", ["-l", PACKAGE_NAME]);
	if (!result.ok) return false;
	return result.stdout.split("\n").some((line) => line.trim().startsWith("ii") && line.includes(PACKAGE_NAME));
}

function buildConfigContent(enabled: boolean): string {
	const value = enabled ? "1" : "0";
	return `APT::Periodic::Update-Package-Lists "${value}";\nAPT::Periodic::Unattended-Upgrade "${value}";\n`;
}

/**
 * 自動セキュリティ更新(unattended-upgrades)の状態確認・有効化/無効化モジュール。
 */
const autoSecurityUpdatesModule: FastifyPluginAsync<{ ctx: ApiModuleContext }> = async (fastify, opts) => {
	const { audit } = opts.ctx;

	fastify.get("/status", async (): Promise<AutoSecurityUpdatesStatus> => {
		const [installed, config] = await Promise.all([isPackageInstalled(), readConfig()]);
		return {
			installed,
			configExists: config.exists,
			updatePackageListsEnabled: parsePeriodicValue(config.raw, "APT::Periodic::Update-Package-Lists"),
			unattendedUpgradeEnabled: parsePeriodicValue(config.raw, "APT::Periodic::Unattended-Upgrade"),
			raw: config.raw,
		};
	});

	fastify.post("/enable", async (request, reply) => {
		const installed = await isPackageInstalled();
		if (!installed) {
			const installResult = await safeExec("apt-get", ["install", "-y", PACKAGE_NAME], 5 * 60_000);
			if (!installResult.ok) {
				return reply.code(500).send({ error: installResult.stderr });
			}
		}
		try {
			await writeFile(CONFIG_PATH, buildConfigContent(true), "utf8");
		} catch (error) {
			return reply.code(500).send({ error: (error as Error).message });
		}
		await audit.record({
			actor: "session-user",
			action: "system.auto-security-updates.enable",
			severity: "warning",
		});
		return { ok: true };
	});

	fastify.post("/disable", async (request, reply) => {
		try {
			await writeFile(CONFIG_PATH, buildConfigContent(false), "utf8");
		} catch (error) {
			return reply.code(500).send({ error: (error as Error).message });
		}
		await audit.record({
			actor: "session-user",
			action: "system.auto-security-updates.disable",
			severity: "warning",
		});
		return { ok: true };
	});
};

export default autoSecurityUpdatesModule;
