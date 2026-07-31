import type { FastifyPluginAsync } from "fastify";
import si from "systeminformation";
import type { ApiModuleContext } from "../types.js";

/**
 * ストレージ情報の詳細閲覧モジュール。
 * ファイルシステム(マウント済み)・物理ディスク(S.M.A.R.T.等)・ブロックデバイス(lsblk相当)・
 * ディスクI/Oのスループットを提供する。LVM/ソフトウェアRAID等の管理機能はNotion設計の
 * 低優先度項目として別途実装予定(閲覧専用のV1)。
 */
const storageModule: FastifyPluginAsync<{ ctx: ApiModuleContext }> = async (fastify) => {
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

	fastify.get("/io", async () => {
		const io = await si.disksIO();
		return {
			timestamp: new Date().toISOString(),
			readOpsPerSec: io?.rIO_sec ?? null,
			writeOpsPerSec: io?.wIO_sec ?? null,
			totalOpsPerSec: io?.tIO_sec ?? null,
			readWaitPercent: io?.rWaitPercent ?? null,
			writeWaitPercent: io?.wWaitPercent ?? null,
		};
	});
};

export default storageModule;
