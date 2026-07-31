import { readFile, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { ApiModuleContext } from "../types.js";

const HOSTS_FILE = "/etc/hosts";

const HOSTNAME_PATTERN = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

const ipAddressSchema = z.string().refine((value) => isIP(value) !== 0, "IPアドレスの形式が正しくありません。");
const hostnameSchema = z
	.string()
	.min(1)
	.max(253)
	.regex(HOSTNAME_PATTERN, "ホスト名の形式が正しくありません。");

const addHostEntrySchema = z.object({
	ip: ipAddressSchema,
	hostname: hostnameSchema,
	comment: z.string().max(200).optional(),
});

const hostsIndexParamsSchema = z.object({
	index: z.coerce.number().int().nonnegative(),
});

interface HostsEntry {
	index: number;
	ip: string;
	hostnames: string[];
	comment: string | null;
	raw: string;
	isSystemEntry: boolean;
}

function isProtectedSystemEntry(ip: string, hostnames: string[]): boolean {
	if (ip === "127.0.0.1" || ip === "::1") return true;
	if (ip.startsWith("127.") && hostnames.length > 0) return true;
	return false;
}

function parseHostsFile(raw: string): { lines: string[]; entries: HostsEntry[] } {
	const lines = raw.split("\n");
	const entries: HostsEntry[] = [];
	lines.forEach((line, index) => {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) return;
		const hashIndex = line.indexOf("#");
		const dataPart = hashIndex >= 0 ? line.slice(0, hashIndex) : line;
		const comment = hashIndex >= 0 ? line.slice(hashIndex + 1).trim() || null : null;
		const tokens = dataPart.trim().split(/\s+/).filter(Boolean);
		if (tokens.length < 2) return;
		const [ip, ...hostnames] = tokens;
		if (!ip) return;
		entries.push({
			index,
			ip,
			hostnames,
			comment,
			raw: line,
			isSystemEntry: isProtectedSystemEntry(ip, hostnames),
		});
	});
	return { lines, entries };
}

/**
 * 名前解決の設定モジュール(system-settingsの`name-resolution`カテゴリ対応)。
 * `/etc/hosts`の一覧取得・追記・削除を提供する。基本的なシステムエントリ
 * (127.0.0.1/::1のlocalhost、127.0.1.1の自ホスト名等)は削除できないようガードする。
 */
const nameResolutionModule: FastifyPluginAsync<{ ctx: ApiModuleContext }> = async (fastify, opts) => {
	const { audit } = opts.ctx;

	fastify.get("/hosts", async (request, reply) => {
		try {
			const raw = await readFile(HOSTS_FILE, "utf8");
			const { entries } = parseHostsFile(raw);
			return { entries };
		} catch (error) {
			return reply.code(500).send({ error: (error as Error).message });
		}
	});

	fastify.post("/hosts", async (request, reply) => {
		const body = addHostEntrySchema.parse(request.body);
		let raw: string;
		try {
			raw = await readFile(HOSTS_FILE, "utf8");
		} catch (error) {
			return reply.code(500).send({ error: (error as Error).message });
		}
		const needsNewlineBefore = raw.length > 0 && !raw.endsWith("\n");
		const newLine = `${body.ip}\t${body.hostname}${body.comment ? ` # ${body.comment}` : ""}\n`;
		try {
			await writeFile(HOSTS_FILE, `${raw}${needsNewlineBefore ? "\n" : ""}${newLine}`, "utf8");
		} catch (error) {
			return reply.code(500).send({ error: (error as Error).message });
		}
		await audit.record({
			actor: "session-user",
			action: "system.hosts.add",
			target: `${body.ip} ${body.hostname}`,
			severity: "warning",
		});
		return { ok: true };
	});

	fastify.delete("/hosts/:index", async (request, reply) => {
		const params = hostsIndexParamsSchema.parse(request.params);
		let raw: string;
		try {
			raw = await readFile(HOSTS_FILE, "utf8");
		} catch (error) {
			return reply.code(500).send({ error: (error as Error).message });
		}
		const { lines, entries } = parseHostsFile(raw);
		const target = entries.find((entry) => entry.index === params.index);
		if (!target) {
			return reply.code(404).send({ error: "指定されたエントリが見つかりません。" });
		}
		if (target.isSystemEntry) {
			return reply.code(403).send({ error: "このエントリは基本的なシステム設定のため削除できません。" });
		}
		const nextLines = lines.filter((_, index) => index !== params.index);
		try {
			await writeFile(HOSTS_FILE, nextLines.join("\n"), "utf8");
		} catch (error) {
			return reply.code(500).send({ error: (error as Error).message });
		}
		await audit.record({
			actor: "session-user",
			action: "system.hosts.delete",
			target: target.raw.trim(),
			severity: "warning",
		});
		return { ok: true };
	});
};

export default nameResolutionModule;
