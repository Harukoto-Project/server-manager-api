import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { ApiModuleContext } from "../types.js";

export type AlertMetric = "cpu" | "memory" | "disk";

export interface AlertRule {
	id: string;
	metric: AlertMetric;
	threshold: number;
	diskPath?: string;
	enabled: boolean;
	cooldownMinutes: number;
}

const RULES_FILE = path.resolve("data", "alert-rules.json");

const alertRuleSchema = z.object({
	metric: z.enum(["cpu", "memory", "disk"]),
	threshold: z.number().min(0).max(100),
	diskPath: z.string().optional(),
	enabled: z.boolean().default(true),
	cooldownMinutes: z.coerce.number().int().positive().default(15),
});

async function loadRules(): Promise<AlertRule[]> {
	try {
		const raw = await readFile(RULES_FILE, "utf8");
		return JSON.parse(raw) as AlertRule[];
	} catch {
		return [];
	}
}

async function saveRules(rules: AlertRule[]): Promise<void> {
	await mkdir(path.dirname(RULES_FILE), { recursive: true });
	await writeFile(RULES_FILE, JSON.stringify(rules, null, 2), "utf8");
}

const alertsModule: FastifyPluginAsync<{ ctx: ApiModuleContext }> = async (fastify, { ctx }) => {
	fastify.get("/rules", async () => {
		const rules = await loadRules();
		return { rules };
	});

	fastify.post("/rules", async (request, reply) => {
		const parsed = alertRuleSchema.safeParse(request.body);
		if (!parsed.success) {
			return reply.badRequest(parsed.error.message);
		}
		const rules = await loadRules();
		const newRule: AlertRule = { id: randomUUID(), ...parsed.data };
		rules.push(newRule);
		await saveRules(rules);
		return reply.code(201).send(newRule);
	});

	fastify.put("/rules/:id", async (request, reply) => {
		const { id } = request.params as { id: string };
		const parsed = alertRuleSchema.partial().safeParse(request.body);
		if (!parsed.success) {
			return reply.badRequest(parsed.error.message);
		}
		const rules = await loadRules();
		const index = rules.findIndex((r) => r.id === id);
		if (index === -1) {
			return reply.notFound("指定されたルールが見つかりません");
		}
		const updated: AlertRule = { ...rules[index]!, ...parsed.data } as AlertRule;
		rules[index] = updated;
		await saveRules(rules);
		return updated;
	});

	fastify.delete("/rules/:id", async (request, reply) => {
		const { id } = request.params as { id: string };
		const rules = await loadRules();
		const filtered = rules.filter((r) => r.id !== id);
		if (filtered.length === rules.length) {
			return reply.notFound("指定されたルールが見つかりません");
		}
		await saveRules(filtered);
		return reply.code(204).send();
	});

	void ctx;
};

export { loadRules };
export default alertsModule;
