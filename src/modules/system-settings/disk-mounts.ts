import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { safeExec } from "../../lib/exec.js";
import type { ApiModuleContext } from "../types.js";

const FSTAB_PATH = "/etc/fstab";
const PROTECTED_MOUNT_POINTS = new Set(["/", "/boot", "/boot/efi", "/home", "/var", "/usr", "/etc", "/tmp"]);

const addFstabEntrySchema = z.object({
	device: z.string().trim().min(1),
	mountPoint: z
		.string()
		.trim()
		.min(1)
		.regex(/^\//, "マウントポイントは絶対パス(/から始まるパス)で指定してください。"),
	fsType: z.string().trim().min(1),
	options: z.string().trim().min(1).default("defaults"),
	dump: z.coerce.number().int().min(0).max(1).default(0),
	pass: z.coerce.number().int().min(0).max(2).default(0),
});

const fstabIndexParamsSchema = z.object({
	index: z.coerce.number().int().nonnegative(),
});

interface FstabEntry {
	index: number;
	device: string;
	mountPoint: string;
	fsType: string;
	options: string;
	dump: number;
	pass: number;
	raw: string;
}

interface BlockDeviceInfo {
	name: string;
	path: string;
	fsType: string | null;
	sizeBytes: number;
	mountPoint: string | null;
	type: string;
	uuid: string | null;
	label: string | null;
	model: string | null;
	children: BlockDeviceInfo[];
}

interface RawLsblkDevice {
	name: string;
	path?: string;
	fstype: string | null;
	size: number | string | null;
	mountpoint: string | null;
	type: string;
	uuid: string | null;
	label: string | null;
	model: string | null;
	children?: RawLsblkDevice[];
}

function trimTrailingEmptyLines(lines: string[]): string[] {
	const result = [...lines];
	while (result.length > 0 && (result[result.length - 1] ?? "").trim() === "") {
		result.pop();
	}
	return result;
}

function parseFstab(lines: string[]): FstabEntry[] {
	const entries: FstabEntry[] = [];
	lines.forEach((line, index) => {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) return;
		const tokens = trimmed.split(/\s+/);
		if (tokens.length < 3) return;
		const [device = "", mountPoint = "", fsType = "", options = "defaults", dump = "0", pass = "0"] = tokens;
		entries.push({
			index,
			device,
			mountPoint,
			fsType,
			options,
			dump: Number(dump) || 0,
			pass: Number(pass) || 0,
			raw: line,
		});
	});
	return entries;
}

async function readFstabLines(): Promise<string[]> {
	const raw = await readFile(FSTAB_PATH, "utf8");
	return raw.split("\n");
}

function normalizeLsblkDevice(device: RawLsblkDevice): BlockDeviceInfo {
	return {
		name: device.name,
		path: device.path ?? `/dev/${device.name}`,
		fsType: device.fstype,
		sizeBytes: Number(device.size) || 0,
		mountPoint: device.mountpoint,
		type: device.type,
		uuid: device.uuid,
		label: device.label,
		model: device.model,
		children: (device.children ?? []).map(normalizeLsblkDevice),
	};
}

function flattenBlockDevices(devices: BlockDeviceInfo[]): BlockDeviceInfo[] {
	const flat: BlockDeviceInfo[] = [];
	for (const device of devices) {
		flat.push(device);
		flat.push(...flattenBlockDevices(device.children));
	}
	return flat;
}

async function fetchBlockDevices(): Promise<BlockDeviceInfo[]> {
	const result = await safeExec("lsblk", [
		"-J",
		"-b",
		"-o",
		"NAME,PATH,FSTYPE,SIZE,MOUNTPOINT,TYPE,UUID,LABEL,MODEL",
	]);
	if (!result.ok) {
		throw new Error(result.stderr || "lsblkの実行に失敗しました。");
	}
	const parsed = JSON.parse(result.stdout) as { blockdevices: RawLsblkDevice[] };
	return parsed.blockdevices.map(normalizeLsblkDevice);
}

const diskMountsModule: FastifyPluginAsync<{ ctx: ApiModuleContext }> = async (fastify, opts) => {
	const { audit } = opts.ctx;

	fastify.get("/fstab", async (request, reply) => {
		try {
			const lines = await readFstabLines();
			return { entries: parseFstab(lines) };
		} catch (error) {
			return reply.code(500).send({ error: (error as Error).message });
		}
	});

	fastify.get("/block-devices", async (request, reply) => {
		try {
			const devices = await fetchBlockDevices();
			return { devices: flattenBlockDevices(devices) };
		} catch (error) {
			return reply.code(500).send({ error: (error as Error).message });
		}
	});

	fastify.post("/fstab", async (request, reply) => {
		const body = addFstabEntrySchema.parse(request.body);

		if (PROTECTED_MOUNT_POINTS.has(body.mountPoint)) {
			return reply.code(400).send({
				error: `${body.mountPoint} は重要なシステムマウントポイントのため、この画面から追加できません。`,
			});
		}

		let lines: string[];
		try {
			lines = await readFstabLines();
		} catch (error) {
			return reply.code(500).send({ error: (error as Error).message });
		}
		const existingEntries = parseFstab(lines);
		if (existingEntries.some((entry) => entry.mountPoint === body.mountPoint)) {
			return reply.code(409).send({ error: `マウントポイント ${body.mountPoint} は既に/etc/fstabに存在します。` });
		}

		let blockDevices: BlockDeviceInfo[];
		try {
			blockDevices = flattenBlockDevices(await fetchBlockDevices());
		} catch (error) {
			return reply.code(500).send({ error: (error as Error).message });
		}
		const deviceExists = blockDevices.some(
			(device) => device.path === body.device || `/dev/${device.name}` === body.device,
		);
		if (!deviceExists) {
			return reply.code(400).send({
				error: `デバイス ${body.device} はこのサーバー上のブロックデバイス一覧に見つかりません。`,
			});
		}

		const newLine = `${body.device}\t${body.mountPoint}\t${body.fsType}\t${body.options}\t${body.dump}\t${body.pass}`;
		const originalRaw = lines.join("\n");
		const nextLines = trimTrailingEmptyLines(lines);
		nextLines.push(newLine);

		try {
			await mkdir(body.mountPoint, { recursive: true });
		} catch (error) {
			return reply.code(500).send({ error: `マウントポイントの作成に失敗しました: ${(error as Error).message}` });
		}

		try {
			await writeFile(FSTAB_PATH, `${nextLines.join("\n")}\n`, "utf8");
		} catch (error) {
			return reply.code(500).send({ error: (error as Error).message });
		}

		const mountResult = await safeExec("mount", [body.mountPoint]);
		if (!mountResult.ok) {
			try {
				await writeFile(FSTAB_PATH, originalRaw, "utf8");
			} catch (rollbackError) {
				return reply.code(500).send({
					error: `マウントに失敗し、さらに/etc/fstabのロールバックにも失敗しました。手動確認が必要です: ${mountResult.stderr} / ${(rollbackError as Error).message}`,
				});
			}
			return reply.code(400).send({
				error: `マウントの検証に失敗したため、/etc/fstabへの追記を取り消しました: ${mountResult.stderr}`,
			});
		}

		await audit.record({
			actor: "session-user",
			action: "system.fstab.add",
			target: newLine,
			severity: "critical",
		});
		return { ok: true, index: nextLines.length - 1 };
	});

	fastify.delete("/fstab/:index", async (request, reply) => {
		const params = fstabIndexParamsSchema.parse(request.params);
		let lines: string[];
		try {
			lines = await readFstabLines();
		} catch (error) {
			return reply.code(500).send({ error: (error as Error).message });
		}
		const entries = parseFstab(lines);
		const target = entries.find((entry) => entry.index === params.index);
		if (!target) {
			return reply.code(404).send({ error: "指定されたエントリが見つかりません。" });
		}
		if (PROTECTED_MOUNT_POINTS.has(target.mountPoint) || target.mountPoint === "none") {
			return reply.code(403).send({
				error: `${target.mountPoint} は重要なシステムマウントポイントのため削除できません。`,
			});
		}

		const nextLines = lines.filter((_, index) => index !== params.index);
		try {
			await writeFile(FSTAB_PATH, `${trimTrailingEmptyLines(nextLines).join("\n")}\n`, "utf8");
		} catch (error) {
			return reply.code(500).send({ error: (error as Error).message });
		}

		await audit.record({
			actor: "session-user",
			action: "system.fstab.delete",
			target: target.raw.trim(),
			severity: "critical",
		});
		return { ok: true };
	});
};

export default diskMountsModule;
