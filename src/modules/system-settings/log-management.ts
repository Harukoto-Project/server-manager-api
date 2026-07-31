import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { ApiModuleContext } from "../types.js";

const LOGROTATE_DIR = "/etc/logrotate.d";
const FREQUENCIES = ["daily", "weekly", "monthly", "yearly"] as const;
type LogrotateFrequency = (typeof FREQUENCIES)[number];

const updateLogrotateConfigSchema = z
	.object({
		rotate: z.coerce.number().int().min(0).max(3650).optional(),
		frequency: z.enum(FREQUENCIES).optional(),
	})
	.refine((data) => data.rotate !== undefined || data.frequency !== undefined, {
		message: "rotateまたはfrequencyのいずれかを指定してください。",
	});

const configNameParamsSchema = z.object({
	name: z
		.string()
		.min(1)
		.max(255)
		.refine(
			(value) => !value.includes("/") && !value.includes("..") && value === path.basename(value),
			"不正なファイル名です。",
		),
});

interface LogrotateConfigSummary {
	name: string;
	rotate: number | null;
	frequency: LogrotateFrequency | null;
	maxsize: string | null;
}

function parseLogrotateConfig(raw: string): Omit<LogrotateConfigSummary, "name"> {
	const rotateMatch = raw.match(/\brotate\s+(\d+)/);
	const maxsizeMatch = raw.match(/\bmaxsize\s+(\S+)/);
	const frequency = FREQUENCIES.find((freq) => new RegExp(`(^|\\s)${freq}(\\s|$)`, "m").test(raw)) ?? null;
	return {
		rotate: rotateMatch?.[1] ? Number(rotateMatch[1]) : null,
		frequency,
		maxsize: maxsizeMatch?.[1] ?? null,
	};
}

async function listConfigNames(): Promise<string[]> {
	const entries = await readdir(LOGROTATE_DIR, { withFileTypes: true });
	return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
}

function appendDirective(raw: string, directive: string): string {
	const closingBraceIndex = raw.lastIndexOf("}");
	if (closingBraceIndex === -1) {
		return `${raw.trimEnd()}\n${directive}\n`;
	}
	return `${raw.slice(0, closingBraceIndex)}\t${directive}\n${raw.slice(closingBraceIndex)}`;
}

function applyRotateUpdate(raw: string, rotate: number): string {
	if (/\brotate\s+\d+/.test(raw)) {
		return raw.replace(/\brotate\s+\d+/, `rotate ${rotate}`);
	}
	return appendDirective(raw, `rotate ${rotate}`);
}

function applyFrequencyUpdate(raw: string, frequency: LogrotateFrequency): string {
	let next = raw;
	for (const freq of FREQUENCIES) {
		if (freq === frequency) continue;
		next = next.replace(new RegExp(`^[ \\t]*${freq}[ \\t]*$`, "gm"), "");
	}
	if (new RegExp(`(^|\\s)${frequency}(\\s|$)`, "m").test(next)) {
		return next;
	}
	return appendDirective(next, frequency);
}

const logManagementModule: FastifyPluginAsync<{ ctx: ApiModuleContext }> = async (fastify, opts) => {
	const { audit } = opts.ctx;

	fastify.get("/logrotate-configs", async (request, reply) => {
		let names: string[];
		try {
			names = await listConfigNames();
		} catch (error) {
			return reply.code(500).send({ error: (error as Error).message });
		}
		const configs: LogrotateConfigSummary[] = await Promise.all(
			names.map(async (name) => {
				const raw = await readFile(path.join(LOGROTATE_DIR, name), "utf8").catch(() => "");
				return { name, ...parseLogrotateConfig(raw) };
			}),
		);
		return { configs };
	});

	fastify.post("/logrotate-configs/:name", async (request, reply) => {
		const params = configNameParamsSchema.parse(request.params);
		const body = updateLogrotateConfigSchema.parse(request.body);

		let names: string[];
		try {
			names = await listConfigNames();
		} catch (error) {
			return reply.code(500).send({ error: (error as Error).message });
		}
		if (!names.includes(params.name)) {
			return reply.code(404).send({ error: "指定された設定ファイルが見つかりません。" });
		}

		const filePath = path.join(LOGROTATE_DIR, params.name);
		let raw: string;
		try {
			raw = await readFile(filePath, "utf8");
		} catch (error) {
			return reply.code(500).send({ error: (error as Error).message });
		}

		let next = raw;
		if (body.rotate !== undefined) next = applyRotateUpdate(next, body.rotate);
		if (body.frequency !== undefined) next = applyFrequencyUpdate(next, body.frequency);

		try {
			await writeFile(filePath, next, "utf8");
		} catch (error) {
			return reply.code(500).send({ error: (error as Error).message });
		}

		await audit.record({
			actor: "session-user",
			action: "system.logrotate.update",
			target: params.name,
			detail: { rotate: body.rotate, frequency: body.frequency },
			severity: "warning",
		});
		return { ok: true };
	});
};

export default logManagementModule;
