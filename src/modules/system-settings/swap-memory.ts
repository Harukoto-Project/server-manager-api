import { appendFile, readFile, unlink, writeFile } from "node:fs/promises";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { safeExec } from "../../lib/exec.js";
import type { ApiModuleContext } from "../types.js";

const SWAP_FILE_PATH = "/swapfile";
const FSTAB_PATH = "/etc/fstab";
const SWAP_FSTAB_LINE = `${SWAP_FILE_PATH} none swap sw 0 0`;
const MIN_FREE_SPACE_MARGIN_BYTES = 512 * 1024 * 1024;

const createSwapSchema = z.object({
	sizeMb: z.coerce.number().int().positive().max(1024 * 1024),
});

interface SwapDeviceInfo {
	name: string;
	type: string;
	sizeBytes: number;
	usedBytes: number;
	priority: number;
}

function parseSwapon(output: string): SwapDeviceInfo[] {
	return output
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			const [name = "", type = "", size = "0", used = "0", priority = "0"] = line.split(/\s+/);
			return {
				name,
				type,
				sizeBytes: Number(size) || 0,
				usedBytes: Number(used) || 0,
				priority: Number(priority) || 0,
			};
		});
}

function parseFreeSwap(output: string): { totalBytes: number; usedBytes: number; freeBytes: number } {
	const swapLine = output.split("\n").find((line) => line.trim().startsWith("Swap:"));
	if (!swapLine) return { totalBytes: 0, usedBytes: 0, freeBytes: 0 };
	const [, total = "0", used = "0", free = "0"] = swapLine.trim().split(/\s+/);
	return {
		totalBytes: Number(total) || 0,
		usedBytes: Number(used) || 0,
		freeBytes: Number(free) || 0,
	};
}

async function isSwapFileConfigured(): Promise<boolean> {
	const fstab = await readFile(FSTAB_PATH, "utf8").catch(() => "");
	return fstab.split("\n").some((line) => {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) return false;
		return trimmed.split(/\s+/)[0] === SWAP_FILE_PATH;
	});
}

const swapMemoryModule: FastifyPluginAsync<{ ctx: ApiModuleContext }> = async (fastify, opts) => {
	const { audit } = opts.ctx;

	fastify.get("/swap", async (request, reply) => {
		const [swapon, free] = await Promise.all([
			safeExec("swapon", ["--show", "--bytes", "--noheadings", "--raw"]),
			safeExec("free", ["-b"]),
		]);
		if (!free.ok) {
			return reply.code(500).send({ error: free.stderr });
		}
		const devices = swapon.ok ? parseSwapon(swapon.stdout) : [];
		const summary = parseFreeSwap(free.stdout);
		return { devices, ...summary };
	});

	fastify.post("/swap", async (request, reply) => {
		const body = createSwapSchema.parse(request.body);

		if (await isSwapFileConfigured()) {
			return reply.code(409).send({ error: "スワップファイルは既に作成されています。" });
		}

		const df = await safeExec("df", ["-B1", "--output=avail", "/"]);
		if (!df.ok) {
			return reply.code(500).send({ error: df.stderr || "空き容量の確認に失敗しました。" });
		}
		const availLine = df.stdout
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)[1];
		const availableBytes = Number(availLine) || 0;
		const requestedBytes = body.sizeMb * 1024 * 1024;
		if (requestedBytes + MIN_FREE_SPACE_MARGIN_BYTES > availableBytes) {
			return reply.code(400).send({
				error: `要求サイズ(${body.sizeMb}MB)がディスクの空き容量(約${Math.floor(availableBytes / 1024 / 1024)}MB)を超えています。`,
			});
		}

		let allocated = await safeExec("fallocate", ["-l", `${body.sizeMb}M`, SWAP_FILE_PATH]);
		if (!allocated.ok) {
			allocated = await safeExec(
				"dd",
				["if=/dev/zero", `of=${SWAP_FILE_PATH}`, "bs=1M", `count=${body.sizeMb}`],
				5 * 60_000,
			);
		}
		if (!allocated.ok) {
			return reply.code(500).send({ error: allocated.stderr || "スワップファイルの作成に失敗しました。" });
		}

		const chmodResult = await safeExec("chmod", ["600", SWAP_FILE_PATH]);
		if (!chmodResult.ok) {
			await unlink(SWAP_FILE_PATH).catch(() => {});
			return reply.code(500).send({ error: chmodResult.stderr });
		}

		const mkswapResult = await safeExec("mkswap", [SWAP_FILE_PATH]);
		if (!mkswapResult.ok) {
			await unlink(SWAP_FILE_PATH).catch(() => {});
			return reply.code(500).send({ error: mkswapResult.stderr });
		}

		const swaponResult = await safeExec("swapon", [SWAP_FILE_PATH]);
		if (!swaponResult.ok) {
			await unlink(SWAP_FILE_PATH).catch(() => {});
			return reply.code(500).send({ error: swaponResult.stderr });
		}

		try {
			const fstabRaw = await readFile(FSTAB_PATH, "utf8").catch(() => "");
			const needsNewline = fstabRaw.length > 0 && !fstabRaw.endsWith("\n");
			await appendFile(FSTAB_PATH, `${needsNewline ? "\n" : ""}${SWAP_FSTAB_LINE}\n`, "utf8");
		} catch (error) {
			return reply.code(500).send({
				error: `スワップは有効化されましたが、/etc/fstabへの追記に失敗しました(再起動後は無効になります): ${(error as Error).message}`,
			});
		}

		await audit.record({
			actor: "session-user",
			action: "system.swap.create",
			target: `${SWAP_FILE_PATH} (${body.sizeMb}MB)`,
			severity: "critical",
		});
		return { ok: true };
	});

	fastify.delete("/swap", async (request, reply) => {
		await safeExec("swapoff", [SWAP_FILE_PATH]);
		await unlink(SWAP_FILE_PATH).catch(() => {});

		try {
			const fstabRaw = await readFile(FSTAB_PATH, "utf8");
			const nextLines = fstabRaw.split("\n").filter((line) => {
				const trimmed = line.trim();
				if (!trimmed || trimmed.startsWith("#")) return true;
				return trimmed.split(/\s+/)[0] !== SWAP_FILE_PATH;
			});
			await writeFile(FSTAB_PATH, nextLines.join("\n"), "utf8");
		} catch (error) {
			return reply.code(500).send({ error: (error as Error).message });
		}

		await audit.record({
			actor: "session-user",
			action: "system.swap.remove",
			target: SWAP_FILE_PATH,
			severity: "warning",
		});
		return { ok: true };
	});
};

export default swapMemoryModule;
