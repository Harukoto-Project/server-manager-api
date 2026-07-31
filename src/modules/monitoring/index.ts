import si from "systeminformation";
import type { FastifyPluginAsync } from "fastify";
import type { ApiModuleContext } from "../types.js";

async function collectSnapshot() {
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

/** システムモニタリングモジュール: REST(1回分)とWebSocket(継続配信)の両方を提供 */
const monitoringModule: FastifyPluginAsync<{ ctx: ApiModuleContext }> = async (fastify) => {
	fastify.get("/summary", async () => collectSnapshot());

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
