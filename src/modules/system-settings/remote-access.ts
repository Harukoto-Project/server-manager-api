import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { safeExec } from "../../lib/exec.js";
import type { ApiModuleContext } from "../types.js";

const DROP_IN_PATH = "/etc/ssh/sshd_config.d/99-server-manager.conf";

interface SshConfigSummary {
	port: string;
	permitRootLogin: string;
	passwordAuthentication: string;
}

function extractSshdSetting(source: string, key: string): string | undefined {
	const line = source
		.split("\n")
		.map((entry) => entry.trim())
		.find((entry) => entry.length > 0 && !entry.startsWith("#") && entry.toLowerCase().startsWith(key.toLowerCase()));
	if (!line) return undefined;
	return line.split(/\s+/).slice(1).join(" ") || undefined;
}

async function readEffectiveSshConfig(): Promise<SshConfigSummary> {
	const sshdT = await safeExec("sshd", ["-T"]);
	let source = sshdT.stdout;
	if (!sshdT.ok || source.trim().length === 0) {
		try {
			source = await readFile("/etc/ssh/sshd_config", "utf8");
		} catch {
			source = "";
		}
	}
	return {
		port: extractSshdSetting(source, "port") ?? "22",
		permitRootLogin: extractSshdSetting(source, "permitrootlogin") ?? "unknown",
		passwordAuthentication: extractSshdSetting(source, "passwordauthentication") ?? "unknown",
	};
}

function parseDropIn(content: string): Record<string, string> {
	const settings: Record<string, string> = {};
	for (const rawLine of content.split("\n")) {
		const line = rawLine.trim();
		if (line.length === 0 || line.startsWith("#")) continue;
		const [key, ...rest] = line.split(/\s+/);
		if (key) settings[key] = rest.join(" ");
	}
	return settings;
}

function serializeDropIn(settings: Record<string, string>): string {
	return `${Object.entries(settings)
		.map(([key, value]) => `${key} ${value}`)
		.join("\n")}\n`;
}

const sshConfigUpdateSchema = z
	.object({
		port: z.coerce.number().int().min(1).max(65535).optional(),
		permitRootLogin: z.enum(["yes", "no", "prohibit-password", "forced-commands-only"]).optional(),
		passwordAuthentication: z.enum(["yes", "no"]).optional(),
	})
	.refine((value) => Object.keys(value).length > 0, { message: "変更する設定が指定されていません。" });

/**
 * リモート接続(SSH)設定モジュール(system-settingsの`remote-access`カテゴリ対応)。
 * メインの/etc/ssh/sshd_configは直接編集せず、drop-inファイルの追記/上書き + `sshd -t`検証 + `reload`のみで反映する。
 */
const remoteAccessModule: FastifyPluginAsync<{ ctx: ApiModuleContext }> = async (fastify, opts) => {
	const { audit } = opts.ctx;

	fastify.get("/ssh-config", async () => readEffectiveSshConfig());

	fastify.post("/ssh-config", async (request, reply) => {
		const body = sshConfigUpdateSchema.parse(request.body);

		let existingContent = "";
		let fileExisted = true;
		try {
			existingContent = await readFile(DROP_IN_PATH, "utf8");
		} catch {
			fileExisted = false;
		}

		const nextSettings = parseDropIn(existingContent);
		if (body.port !== undefined) nextSettings.Port = String(body.port);
		if (body.permitRootLogin !== undefined) nextSettings.PermitRootLogin = body.permitRootLogin;
		if (body.passwordAuthentication !== undefined) nextSettings.PasswordAuthentication = body.passwordAuthentication;

		await mkdir(path.dirname(DROP_IN_PATH), { recursive: true });
		await writeFile(DROP_IN_PATH, serializeDropIn(nextSettings), "utf8");

		const syntaxCheck = await safeExec("sshd", ["-t"]);
		if (!syntaxCheck.ok) {
			if (fileExisted) {
				await writeFile(DROP_IN_PATH, existingContent, "utf8");
			} else {
				await rm(DROP_IN_PATH, { force: true });
			}
			await audit.record({
				actor: "session-user",
				action: "system.remote-access.update-rejected",
				detail: { ...body, reason: syntaxCheck.stderr },
				severity: "warning",
			});
			return reply.code(400).send({ error: `設定の検証に失敗したため変更を取り消しました: ${syntaxCheck.stderr}` });
		}

		const reload = await safeExec("systemctl", ["reload", "ssh"]);
		if (!reload.ok) {
			return reply.code(500).send({
				error: `設定ファイルは書き込まれましたが、sshの再読み込みに失敗しました。手動で確認してください: ${reload.stderr}`,
			});
		}

		await audit.record({
			actor: "session-user",
			action: "system.remote-access.update",
			detail: body,
			severity: "critical",
		});
		return { ok: true, settings: await readEffectiveSshConfig() };
	});
};

export default remoteAccessModule;
