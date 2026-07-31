import { randomUUID } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { safeExec } from "../../lib/exec.js";
import type { ApiModuleContext } from "../types.js";

const CRON_SCHEDULE_PATTERN = /^(\S+\s+){4}\S+$/;

const createCronJobSchema = z.object({
	schedule: z
		.string()
		.trim()
		.min(1)
		.regex(CRON_SCHEDULE_PATTERN, "cron形式(分 時 日 月 曜日)で指定してください。"),
	command: z.string().trim().min(1),
});

const cronJobIndexParamsSchema = z.object({
	index: z.coerce.number().int().nonnegative(),
});

interface CronJobEntry {
	index: number;
	schedule: string;
	command: string;
	raw: string;
}

function trimTrailingEmptyLines(lines: string[]): string[] {
	const result = [...lines];
	while (result.length > 0 && (result[result.length - 1] ?? "").trim() === "") {
		result.pop();
	}
	return result;
}

function parseCrontabLines(lines: string[]): CronJobEntry[] {
	const jobs: CronJobEntry[] = [];
	lines.forEach((line, index) => {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) return;
		const tokens = trimmed.split(/\s+/);
		if (tokens.length < 6) return;
		jobs.push({
			index,
			schedule: tokens.slice(0, 5).join(" "),
			command: tokens.slice(5).join(" "),
			raw: line,
		});
	});
	return jobs;
}

async function readCrontabLines(): Promise<string[]> {
	const result = await safeExec("crontab", ["-l"]);
	if (!result.ok) {
		return [];
	}
	return trimTrailingEmptyLines(result.stdout.split("\n"));
}

async function writeCrontabLines(lines: string[]): Promise<{ ok: boolean; stderr: string }> {
	const tmpFile = path.join(os.tmpdir(), `server-manager-crontab-${randomUUID()}.txt`);
	const content = `${trimTrailingEmptyLines(lines).join("\n")}\n`;
	await writeFile(tmpFile, content, "utf8");
	try {
		const result = await safeExec("crontab", [tmpFile]);
		return { ok: result.ok, stderr: result.stderr };
	} finally {
		await unlink(tmpFile).catch(() => {});
	}
}

const scheduledTasksModule: FastifyPluginAsync<{ ctx: ApiModuleContext }> = async (fastify, opts) => {
	const { audit } = opts.ctx;

	fastify.get("/cron-jobs", async () => {
		const lines = await readCrontabLines();
		return { jobs: parseCrontabLines(lines) };
	});

	fastify.post("/cron-jobs", async (request, reply) => {
		const body = createCronJobSchema.parse(request.body);
		const lines = await readCrontabLines();
		const newLine = `${body.schedule} ${body.command}`;
		const nextLines = [...lines, newLine];

		const writeResult = await writeCrontabLines(nextLines);
		if (!writeResult.ok) {
			return reply.code(500).send({ error: writeResult.stderr || "crontabの更新に失敗しました。" });
		}

		await audit.record({
			actor: "session-user",
			action: "system.cron.add",
			target: newLine,
			severity: "warning",
		});
		return { ok: true, index: nextLines.length - 1 };
	});

	fastify.delete("/cron-jobs/:index", async (request, reply) => {
		const params = cronJobIndexParamsSchema.parse(request.params);
		const lines = await readCrontabLines();
		const target = params.index < lines.length ? lines[params.index] : undefined;
		if (target === undefined) {
			return reply.code(404).send({ error: "指定されたジョブが見つかりません。" });
		}

		const nextLines = lines.filter((_, index) => index !== params.index);
		const writeResult = await writeCrontabLines(nextLines);
		if (!writeResult.ok) {
			return reply.code(500).send({ error: writeResult.stderr || "crontabの更新に失敗しました。" });
		}

		await audit.record({
			actor: "session-user",
			action: "system.cron.delete",
			target: target.trim(),
			severity: "warning",
		});
		return { ok: true };
	});
};

export default scheduledTasksModule;
