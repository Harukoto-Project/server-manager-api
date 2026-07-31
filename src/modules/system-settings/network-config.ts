import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { safeExec } from "../../lib/exec.js";
import type { ApiModuleContext } from "../types.js";

const ipAddressSchema = z.string().refine((value) => isIP(value) !== 0, "IPアドレスの形式が正しくありません。");

const dnsServersSchema = z.object({
	servers: z.array(ipAddressSchema).min(1).max(8),
});

const RESOLVED_DROPIN_DIR = "/etc/systemd/resolved.conf.d";
const RESOLVED_DROPIN_FILE = path.join(RESOLVED_DROPIN_DIR, "99-server-manager.conf");
const NETPLAN_DIR = "/etc/netplan";
const INTERFACES_FILE = "/etc/network/interfaces";

function parseResolvectlDns(output: string): string[] {
	const servers = new Set<string>();
	for (const line of output.split("\n")) {
		const match = line.match(/DNS Servers:\s*(.+)$/);
		if (!match || !match[1]) continue;
		for (const addr of match[1].trim().split(/\s+/)) {
			if (addr) servers.add(addr);
		}
	}
	return Array.from(servers);
}

/**
 * ネットワーク設定変更モジュール(system-settingsの`network-config`/`name-resolution`カテゴリ対応)。
 * IPアドレス/ゲートウェイ変更は接続断のリスクが高いため今回は「閲覧専用」に留め、
 * DNSサーバー設定のみ`systemd-resolved`のdrop-inファイル経由で変更可能にする。
 */
const networkConfigModule: FastifyPluginAsync<{ ctx: ApiModuleContext }> = async (fastify, opts) => {
	const { audit } = opts.ctx;

	fastify.get("/dns-servers", async (request, reply) => {
		const status = await safeExec("resolvectl", ["status"]);
		if (status.ok) {
			return {
				source: "systemd-resolved" as const,
				servers: parseResolvectlDns(status.stdout),
				raw: status.stdout,
			};
		}
		try {
			const raw = await readFile("/etc/resolv.conf", "utf8");
			const servers = raw
				.split("\n")
				.map((line) => line.trim())
				.filter((line) => line.startsWith("nameserver "))
				.map((line) => line.replace("nameserver ", "").trim());
			return { source: "resolv.conf" as const, servers, raw };
		} catch (error) {
			return reply.code(500).send({ error: (error as Error).message });
		}
	});

	fastify.post("/dns-servers", async (request, reply) => {
		const body = dnsServersSchema.parse(request.body);

		const activeCheck = await safeExec("systemctl", ["is-active", "systemd-resolved"]);
		if (!activeCheck.ok || activeCheck.stdout.trim() !== "active") {
			return reply.code(400).send({
				error:
					"systemd-resolvedが有効ではないため、この方法でDNSサーバーを変更できません。手動での設定変更が必要です。",
			});
		}

		const content = `[Resolve]\nDNS=${body.servers.join(" ")}\n`;
		try {
			await mkdir(RESOLVED_DROPIN_DIR, { recursive: true });
			await writeFile(RESOLVED_DROPIN_FILE, content, "utf8");
		} catch (error) {
			return reply.code(500).send({ error: (error as Error).message });
		}

		const restart = await safeExec("systemctl", ["restart", "systemd-resolved"]);
		if (!restart.ok) {
			return reply.code(500).send({
				error: `設定ファイルは書き込みましたが、systemd-resolvedの再起動に失敗しました: ${restart.stderr}`,
			});
		}

		await audit.record({
			actor: "session-user",
			action: "system.network.dns.update",
			target: body.servers.join(", "),
			severity: "warning",
		});
		return { ok: true };
	});

	/**
	 * IPアドレス/ゲートウェイ設定は接続断のリスクが高いため閲覧専用。
	 * netplanの設定(Ubuntu 18.04+)を優先し、無ければ/etc/network/interfacesを返す。
	 */
	fastify.get("/interfaces-config", async (request, reply) => {
		try {
			const files = await readdir(NETPLAN_DIR);
			const yamlFiles = files.filter((file) => file.endsWith(".yaml") || file.endsWith(".yml"));
			if (yamlFiles.length > 0) {
				const contents = await Promise.all(
					yamlFiles.map(async (file) => ({
						file: path.join(NETPLAN_DIR, file),
						content: await readFile(path.join(NETPLAN_DIR, file), "utf8"),
					})),
				);
				return { source: "netplan" as const, files: contents };
			}
		} catch {
			// netplanディレクトリが存在しない場合は/etc/network/interfacesにフォールバック
		}
		try {
			const content = await readFile(INTERFACES_FILE, "utf8");
			return { source: "interfaces" as const, files: [{ file: INTERFACES_FILE, content }] };
		} catch (error) {
			return reply.code(500).send({ error: (error as Error).message, source: "unknown" as const, files: [] });
		}
	});
};

export default networkConfigModule;
