import { readFile } from "node:fs/promises";
import type { FastifyPluginAsync } from "fastify";
import si from "systeminformation";
import { z } from "zod";
import { safeExec } from "../../lib/exec.js";
import type { ApiModuleContext } from "../types.js";

const connectionsQuerySchema = z.object({
	limit: z.coerce.number().int().positive().max(1000).default(200),
});

/**
 * ネットワーク情報の詳細閲覧モジュール。
 * system-settingsの「ネットワーク設定」(将来的なIP/DNS等の変更操作)とは役割を分け、
 * こちらはインターフェース/ルーティング/DNS/アクティブな接続の閲覧に特化する。
 */
const networkModule: FastifyPluginAsync<{ ctx: ApiModuleContext }> = async (fastify) => {
	fastify.get("/interfaces", async () => {
		const interfaces = await si.networkInterfaces();
		return {
			interfaces: interfaces.map((iface) => ({
				name: iface.iface,
				displayName: iface.ifaceName,
				isDefault: iface.default,
				ip4: iface.ip4,
				ip4subnet: iface.ip4subnet,
				ip6: iface.ip6,
				ip6subnet: iface.ip6subnet,
				mac: iface.mac,
				internal: iface.internal,
				virtual: iface.virtual,
				operstate: iface.operstate,
				type: iface.type,
				duplex: iface.duplex,
				mtu: iface.mtu,
				speedMbps: iface.speed,
				dhcp: iface.dhcp,
			})),
		};
	});

	fastify.get("/routes", async (request, reply) => {
		const [routeResult, gateway] = await Promise.all([
			safeExec("ip", ["route"]),
			si.networkGatewayDefault().catch(() => ""),
		]);
		if (!routeResult.ok) {
			return reply.code(500).send({ error: routeResult.stderr });
		}
		return {
			gateway,
			routes: routeResult.stdout
				.split("\n")
				.map((line) => line.trim())
				.filter(Boolean),
		};
	});

	fastify.get("/dns", async () => {
		try {
			const raw = await readFile("/etc/resolv.conf", "utf8");
			const nameservers = raw
				.split("\n")
				.map((line) => line.trim())
				.filter((line) => line.startsWith("nameserver "))
				.map((line) => line.replace("nameserver ", "").trim());
			return { nameservers, raw };
		} catch (error) {
			return { nameservers: [], raw: "", error: (error as Error).message };
		}
	});

	fastify.get("/connections", async (request) => {
		const { limit } = connectionsQuerySchema.parse(request.query);
		const connections = await si.networkConnections();
		return {
			connections: connections.slice(0, limit).map((conn) => ({
				protocol: conn.protocol,
				localAddress: conn.localAddress,
				localPort: conn.localPort,
				peerAddress: conn.peerAddress,
				peerPort: conn.peerPort,
				state: conn.state,
				pid: conn.pid,
				process: conn.process,
			})),
			total: connections.length,
		};
	});
};

export default networkModule;
