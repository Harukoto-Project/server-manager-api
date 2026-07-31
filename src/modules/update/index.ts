import { existsSync } from "node:fs";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { safeExec } from "../../lib/exec.js";
import type { ApiModuleContext } from "../types.js";

const runUpdateSchema = z.object({
	installPath: z.string().min(1, "installPathは必須です。"),
	serviceName: z.string().min(1).default("server-manager.service"),
});

interface UpdateStepResult {
	step: string;
	ok: boolean;
	stdout: string;
	stderr: string;
}

/** API自身を更新する自己アップデートモジュール(git pull -> npm install -> npm run build -> systemctl restart)。 */
const updateModule: FastifyPluginAsync<{ ctx: ApiModuleContext }> = async (fastify, opts) => {
	const { audit } = opts.ctx;

	fastify.post("/run", async (request, reply) => {
		const body = runUpdateSchema.parse(request.body);

		if (!existsSync(body.installPath)) {
			return reply.code(400).send({ error: `installPathが存在しません: ${body.installPath}` });
		}

		const steps: UpdateStepResult[] = [];

		const recordFailure = async (failedStep: string) => {
			await audit.record({
				actor: "session-user",
				action: "system.api-update.run",
				target: body.installPath,
				severity: "warning",
			});
			return { ok: false, steps, failedStep };
		};

		const gitPull = await safeExec("git", ["pull"], { cwd: body.installPath }, 2 * 60_000);
		steps.push({ step: "git pull", ok: gitPull.ok, stdout: gitPull.stdout, stderr: gitPull.stderr });
		if (!gitPull.ok) {
			return recordFailure("git pull");
		}

		const npmInstall = await safeExec("npm", ["install"], { cwd: body.installPath }, 5 * 60_000);
		steps.push({ step: "npm install", ok: npmInstall.ok, stdout: npmInstall.stdout, stderr: npmInstall.stderr });
		if (!npmInstall.ok) {
			return recordFailure("npm install");
		}

		const npmBuild = await safeExec("npm", ["run", "build"], { cwd: body.installPath }, 5 * 60_000);
		steps.push({ step: "npm run build", ok: npmBuild.ok, stdout: npmBuild.stdout, stderr: npmBuild.stderr });
		if (!npmBuild.ok) {
			return recordFailure("npm run build");
		}

		await audit.record({
			actor: "session-user",
			action: "system.api-update.run",
			target: body.installPath,
			severity: "critical",
		});

		setTimeout(() => {
			void safeExec("systemctl", ["restart", body.serviceName]);
		}, 500);

		return { ok: true, steps };
	});
};

export default updateModule;
