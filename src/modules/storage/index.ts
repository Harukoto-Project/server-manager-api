import si from "systeminformation";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { StorageIoStore } from "../../lib/storage-io-store.js";
import type { ApiModuleContext } from "../types.js";

export interface StorageIoSnapshot {
	timestamp: string;
	readOpsPerSec: number | null;
	writeOpsPerSec: number | null;
	totalOpsPerSec: number | null;
	readWaitPercent: number | null;
	writeWaitPercent: number | null;
}

async function collectIoSnapshot(): Promise<StorageIoSnapshot> {
	const io = await si.disksIO();
	return {
		timestamp: new Date().toISOString(),
		readOpsPerSec: io?.rIO_sec ?? null,
		writeOpsPerSec: io?.wIO_sec ?? null,
		totalOpsPerSec: io?.tIO_sec ?? null,
		readWaitPercent: io?.rWaitPercent ?? null,
		writeWaitPercent: io?.wWaitPercent ?? null,
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
 * ストレージ情報の詳細閲覧モジュール。
 * ファイルシステム(マウント済み)・物理ディスク(S.M.A.R.T.等)・ブロックデバイス(lsblk相当)・
 * ディスクI/Oのスループットを提供する。LVM/ソフトウェアRAID等の管理機能はNotion設計の
 * 低優先度項目として別途実装予定(閲覧専用のV1)。
 *
 * ディスクI/Oは、モニタリングモジュールと同様にクライアントの接続有無とは無関係に
 * サーバー自身が一定間隔でSQLiteへサンプルを記録し、過去の推移を閲覧できるようにする。
 */
const storageModule: FastifyPluginAsync<{ ctx: ApiModuleContext }> = async (fastify, { ctx }) => {
	const ioStore = new StorageIoStore();

	const sampleIntervalMs = ctx.env.STORAGE_IO_SAMPLE_INTERVAL_MS;
	const retentionDays = ctx.env.STORAGE_IO_HISTORY_RETENTION_DAYS;

	ioStore.prune(retentionDays);

	const recordIoSample = () => {
		collectIoSnapshot()
			.then((snapshot) => ioStore.insert(snapshot))
			.catch((error) => fastify.log.warn({ error }, "ディスクI/O履歴の記録に失敗しました"));
	};
	recordIoSample();
	const sampleInterval = setInterval(recordIoSample, sampleIntervalMs);
	const pruneInterval = setInterval(() => ioStore.prune(retentionDays), 60 * 60 * 1000);

	fastify.addHook("onClose", () => {
		clearInterval(sampleInterval);
		clearInterval(pruneInterval);
		ioStore.close();
	});

	fastify.get("/filesystems", async () => {
		const filesystems = await si.fsSize();
		return {
			filesystems: filesystems.map((fs) => ({
				fs: fs.fs,
				type: fs.type,
				mount: fs.mount,
				sizeBytes: fs.size,
				usedBytes: fs.used,
				availableBytes: fs.available,
				usedPercent: fs.use,
				rw: fs.rw,
			})),
		};
	});

	fastify.get("/disks", async () => {
		const disks = await si.diskLayout();
		return {
			disks: disks.map((disk) => ({
				device: disk.device,
				type: disk.type,
				name: disk.name,
				vendor: disk.vendor,
				sizeBytes: disk.size,
				interfaceType: disk.interfaceType,
				smartStatus: disk.smartStatus,
				temperatureCelsius: disk.temperature,
			})),
		};
	});

	fastify.get("/block-devices", async () => {
		const devices = await si.blockDevices();
		return {
			devices: devices.map((device) => ({
				name: device.name,
				identifier: device.identifier,
				type: device.type,
				fsType: device.fsType,
				mount: device.mount,
				sizeBytes: device.size,
				physical: device.physical,
				uuid: device.uuid,
				label: device.label,
				model: device.model,
				removable: device.removable,
			})),
		};
	});

	fastify.get("/io", async () => collectIoSnapshot());

	fastify.get("/io/history", async (request) => {
		const { rangeMinutes, maxPoints } = historyQuerySchema.parse(request.query);
		const from = new Date(Date.now() - rangeMinutes * 60 * 1000).toISOString();
		const samples = ioStore.querySince<StorageIoSnapshot>(from, maxPoints);
		return { samples };
	});
};

export default storageModule;
