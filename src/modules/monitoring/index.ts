import si from "systeminformation";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { MonitoringStore } from "../../lib/monitoring-store.js";
import type { ApiModuleContext } from "../types.js";
import { loadRules } from "../alerts/index.js";

export interface MonitoringSnapshot {
	timestamp: string;
	uptimeSeconds: number;
	cpu: { manufacturer: string; brand: string; cores: number; loadPercent: number };
	memory: { totalBytes: number; usedBytes: number; freeBytes: number; usedPercent: number };
	disks: Array<{ mount: string; totalBytes: number; usedBytes: number; usedPercent: number }>;
	network: Array<{ interface: string; rxBytesPerSec: number; txBytesPerSec: number }>;
}

async function collectSnapshot(): Promise<MonitoringSnapshot> {
	const [cpu, mem, fsSize, networkStats, currentLoad, time] = await Promise.all([
		si.cpu(),
		si.mem(),
		si.fsSize(),
		si.networkStats(),
		si.currentLoad(),
		si.time(),
	]);

	return {
		timestamp: new Date().toISOString(),
		uptimeSeconds: time.uptime,
		cpu: {
			manufacturer: cpu.manufacturer,
			brand: cpu.brand,
			cores: cpu.cores,
			loadPercent: Math.round(currentLoad.currentLoad * 100) / 100,
		},
		memory: {
			totalBytes: mem.total,
			usedBytes: mem.active,
			freeBytes: mem.available,
			usedPercent: Math.round((mem.active / mem.total) * 10000) / 100,
		},
		disks: fsSize.map((disk) => ({
			mount: disk.mount,
			totalBytes: disk.size,
			usedBytes: disk.used,
			usedPercent: disk.use,
		})),
		network: networkStats.map((iface) => ({
			interface: iface.iface,
			rxBytesPerSec: iface.rx_sec ?? 0,
			txBytesPerSec: iface.tx_sec ?? 0,
		})),
	};
}

const historyQuerySchema = z.object({
	rangeMinutes: z.coerce
		.number()
		.int()
		.positive()
		.max(60 * 24 * 30)
		.default(60),
	maxPoints: z.coerce.number().int().positive().max(2000).default(300),
});

/**
 * システムモニタリングモジュール。
 * REST(1回分)・WebSocket(継続配信)に加え、クライアントの接続有無とは無関係に
 * サーバー自身が一定間隔でSQLiteへサンプルを記録し、過去の推移を閲覧できるようにする。
 */
const monitoringModule: FastifyPluginAsync<{ ctx: ApiModuleContext }> = async (fastify, { ctx }) => {
	const store = new MonitoringStore();

	const sampleIntervalMs = ctx.env.MONITORING_SAMPLE_INTERVAL_MS;
	const retentionDays = ctx.env.MONITORING_HISTORY_RETENTION_DAYS;

	store.prune(retentionDays);

	const lastNotified = new Map<string, number>();

	async function evaluateAlerts(snapshot: MonitoringSnapshot): Promise<void> {
		if (!ctx.env.DISCORD_WEBHOOK_URL) return;
		const rules = await loadRules().catch(() => []);
		const now = Date.now();

		for (const rule of rules) {
			if (!rule.enabled) continue;

			let currentValue: number | undefined;
			if (rule.metric === "cpu") {
				currentValue = snapshot.cpu.loadPercent;
			} else if (rule.metric === "disk") {
				const disk = snapshot.disks.find((d) => d.mount === (rule.diskPath ?? "/"));
				currentValue = disk?.usedPercent;
			} else if (rule.metric === "memory") {
				currentValue = snapshot.memory.usedPercent;
			}

			if (currentValue === undefined || currentValue <= rule.threshold) continue;

			const cooldownMs = rule.cooldownMinutes * 60 * 1000;
			const lastTime = lastNotified.get(rule.id) ?? 0;
			if (now - lastTime < cooldownMs) continue;

			lastNotified.set(rule.id, now);

			const metricLabel = rule.metric === "cpu" ? "CPU使用率" : rule.metric === "memory" ? "メモリ使用率" : "ディスク使用率";
			const suffix = rule.metric === "disk" ? ` (${rule.diskPath ?? "/"})` : "";
			const message = `🚨 ${metricLabel}${suffix}が${rule.threshold}%を超えました (現在: ${Math.round(currentValue)}%)`;

			await fetch(ctx.env.DISCORD_WEBHOOK_URL, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ content: message }),
			}).catch((error) => fastify.log.warn({ error }, "アラート通知の送信に失敗しました"));
		}
	}

	const recordSample = () => {
		collectSnapshot()
			.then((snapshot) => {
				store.insert(snapshot);
				return evaluateAlerts(snapshot);
			})
			.catch((error) => fastify.log.warn({ error }, "モニタリング履歴の記録に失敗しました"));
	};
	recordSample();
	const sampleInterval = setInterval(recordSample, sampleIntervalMs);
	const pruneInterval = setInterval(() => store.prune(retentionDays), 60 * 60 * 1000);

	fastify.addHook("onClose", () => {
		clearInterval(sampleInterval);
		clearInterval(pruneInterval);
		store.close();
	});

	fastify.get("/summary", async () => collectSnapshot());

	fastify.get("/history", async (request) => {
		const { rangeMinutes, maxPoints } = historyQuerySchema.parse(request.query);
		const from = new Date(Date.now() - rangeMinutes * 60 * 1000).toISOString();
		const samples = store.querySince<MonitoringSnapshot>(from, maxPoints);
		return { samples };
	});

	fastify.get("/stream", { websocket: true }, (socket) => {
		const interval = setInterval(() => {
			collectSnapshot()
				.then((snapshot) => socket.send(JSON.stringify(snapshot)))
				.catch(() => undefined);
		}, 2000);

		socket.on("close", () => clearInterval(interval));
	});
};

export default monitoringModule;
