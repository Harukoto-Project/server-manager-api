import { randomUUID } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { safeExec } from "../../lib/exec.js";
import type { ApiModuleContext } from "../types.js";

const MIN_LEAD_TIME_MS = 60_000;

const scheduleActionSchema = z.object({
	action: z.enum(["reboot", "shutdown"]),
	time: z.string().datetime({ offset: true }),
});

interface PowerScheduleJob {
	jobId: string;
	time: string;
	action: "reboot" | "shutdown" | "unknown";
	command: string;
}

function parseAtqLine(line: string): { jobId: string; time: string } | null {
	const trimmed = line.trim();
	if (!trimmed) return null;
	const tokens = trimmed.split(/\s+/);
	if (tokens.length < 3) return null;
	const jobId = tokens[0] ?? "";
	if (!jobId) return null;
	const time = tokens.slice(1, tokens.length - 2).join(" ");
	return { jobId, time };
}

function detectAction(script: string): "reboot" | "shutdown" | "unknown" {
	if (/shutdown\s+-r|(^|\s)reboot(\s|$)/im.test(script)) return "reboot";
	if (/shutdown\s+-[hP]|poweroff/im.test(script)) return "shutdown";
	return "unknown";
}

async function listPowerJobs(): Promise<PowerScheduleJob[]> {
	const atq = await safeExec("atq");
	if (!atq.ok) return [];

	const jobs: PowerScheduleJob[] = [];
	for (const line of atq.stdout.split("\n")) {
		const parsedLine = parseAtqLine(line);
		if (!parsedLine) continue;

		const detail = await safeExec("at", ["-c", parsedLine.jobId]);
		if (!detail.ok) continue;
		if (!/shutdown|reboot|poweroff/i.test(detail.stdout)) continue;

		const command =
			detail.stdout
				.split("\n")
				.map((l) => l.trim())
				.find((l) => /^(shutdown|reboot|poweroff)\b/i.test(l)) ?? "";

		jobs.push({
			jobId: parsedLine.jobId,
			time: parsedLine.time,
			action: detectAction(detail.stdout),
			command,
		});
	}
	return jobs;
}

function toAtTimeArgument(isoTime: string): string {
	const date = new Date(isoTime);
	const hours = String(date.getHours()).padStart(2, "0");
	const minutes = String(date.getMinutes()).padStart(2, "0");
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	const year = date.getFullYear();
	return `${hours}:${minutes} ${month}/${day}/${year}`;
}

async function scheduleAtJob(
	scriptContent: string,
	atTimeArgument: string,
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
	const tmpFile = path.join(os.tmpdir(), `server-manager-at-${randomUUID()}.sh`);
	await writeFile(tmpFile, scriptContent, "utf8");
	try {
		return await safeExec("at", ["-f", tmpFile, atTimeArgument]);
	} finally {
		await unlink(tmpFile).catch(() => {});
	}
}

const powerScheduleModule: FastifyPluginAsync<{ ctx: ApiModuleContext }> = async (fastify, opts) => {
	const { audit } = opts.ctx;

	fastify.get("/schedule", async (request, reply) => {
		try {
			const jobs = await listPowerJobs();
			return { jobs };
		} catch (error) {
			return reply.code(500).send({ error: (error as Error).message });
		}
	});

	fastify.post("/schedule", async (request, reply) => {
		const body = scheduleActionSchema.parse(request.body);

		const targetDate = new Date(body.time);
		if (Number.isNaN(targetDate.getTime())) {
			return reply.code(400).send({ error: "時刻の形式が正しくありません。" });
		}
		if (targetDate.getTime() - Date.now() < MIN_LEAD_TIME_MS) {
			return reply.code(400).send({ error: "予約時刻は現在時刻より1分以上先を指定してください。" });
		}

		const command = body.action === "reboot" ? "shutdown -r now" : "shutdown -h now";
		const atTimeArgument = toAtTimeArgument(body.time);
		const scriptContent = `#!/bin/sh\n${command}\n`;

		const result = await scheduleAtJob(scriptContent, atTimeArgument);
		if (!result.ok) {
			return reply.code(500).send({
				error: result.stderr || "予約の登録に失敗しました。atコマンドが利用可能か確認してください。",
			});
		}
		const jobIdMatch = result.stderr.match(/job\s+(\d+)/i);

		await audit.record({
			actor: "session-user",
			action: `system.power-schedule.${body.action}`,
			target: `${atTimeArgument}${jobIdMatch ? ` (job ${jobIdMatch[1]})` : ""}`,
			severity: "critical",
		});
		return { ok: true, jobId: jobIdMatch?.[1] ?? null, scheduledAt: atTimeArgument };
	});

	fastify.delete("/schedule", async (request, reply) => {
		try {
			const jobs = await listPowerJobs();
			const cancelledJobIds: string[] = [];
			for (const job of jobs) {
				const result = await safeExec("atrm", [job.jobId]);
				if (result.ok) cancelledJobIds.push(job.jobId);
			}
			await safeExec("shutdown", ["-c"]);

			await audit.record({
				actor: "session-user",
				action: "system.power-schedule.cancel",
				target: cancelledJobIds.join(", ") || "(none)",
				severity: "warning",
			});
			return { ok: true, cancelledJobIds };
		} catch (error) {
			return reply.code(500).send({ error: (error as Error).message });
		}
	});
};

export default powerScheduleModule;
