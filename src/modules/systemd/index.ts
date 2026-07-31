import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { safeExec } from "../../lib/exec.js";
import type { ApiModuleContext } from "../types.js";

const actionSchema = z.object({
	action: z.enum(["start", "stop", "restart", "enable", "disable"]),
});

interface SystemdUnit {
	unit: string;
	load: string;
	active: string;
	sub: string;
	description: string;
}

function parseUnitList(stdout: string): SystemdUnit[] {
	return stdout
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.endsWith(".service") || line.includes(".service "))
		.map((line) => {
			const [unit, load, active, sub, ...descriptionParts] = line.split(/\s+/);
			return {
				unit: unit ?? "",
				load: load ?? "",
				active: active ?? "",
				sub: sub ?? "",
				description: descriptionParts.join(" "),
			};
		});
}

/** systemdサービス管理モジュール(一覧・起動/停止/再起動・journalログ閲覧) */
const systemdModule: FastifyPluginAsync<{ ctx: ApiModuleContext }> = async (fastify, opts) => {
	const { audit } = opts.ctx;

	fastify.get("/units", async (request, reply) => {
		const result = await safeExec("systemctl", [
			"list-units",
			"--type=service",
			"--all",
			"--no-pager",
			"--no-legend",
		]);
		if (!result.ok) {
			return reply.code(500).send({ error: result.stderr });
		}
		return { units: parseUnitList(result.stdout) };
	});

	fastify.post<{ Params: { unit: string }; Body: z.infer<typeof actionSchema> }>(
		"/units/:unit/action",
		async (request, reply) => {
			const { action } = actionSchema.parse(request.body);
			const unit = request.params.unit;
			const result = await safeExec("systemctl", [action, unit]);
			if (!result.ok) {
				return reply.code(500).send({ error: result.stderr });
			}

			await audit.record({
				actor: "session-user",
				action: `systemd.unit.${action}`,
				target: unit,
				severity: "warning",
			});

			return { ok: true };
		},
	);

	fastify.get<{ Params: { unit: string } }>("/units/:unit/logs", async (request, reply) => {
		const result = await safeExec("journalctl", ["-u", request.params.unit, "-n", "500", "--no-pager"]);
		if (!result.ok) {
			return reply.code(500).send({ error: result.stderr });
		}
		return { logs: result.stdout };
	});
};

export default systemdModule;
