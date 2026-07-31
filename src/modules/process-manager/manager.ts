import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WebSocket } from "ws";

export interface ManagedProject {
	id: string;
	name: string;
	/** "node" | "python" | "custom" - 将来のテンプレート(Egg相当)の起点 */
	kind: "node" | "python" | "custom";
	cwd: string;
	command: string;
	args: string[];
	env: Record<string, string>;
	autoStart: boolean;
}

interface RuntimeState {
	child?: ChildProcess;
	logBuffer: string[];
	subscribers: Set<WebSocket>;
	status: "stopped" | "running" | "crashed";
}

const PROJECTS_FILE = path.resolve("data", "process-manager-projects.json");
const LOG_BUFFER_LIMIT = 1000;

export class ProcessManager {
	private projects = new Map<string, ManagedProject>();
	private runtime = new Map<string, RuntimeState>();

	async init(): Promise<void> {
		try {
			const raw = await readFile(PROJECTS_FILE, "utf8");
			const saved = JSON.parse(raw) as ManagedProject[];
			for (const project of saved) {
				this.projects.set(project.id, project);
				this.runtime.set(project.id, { logBuffer: [], subscribers: new Set(), status: "stopped" });
			}
		} catch {
			// 初回起動時はファイルが存在しない
		}
	}

	private async persist(): Promise<void> {
		await mkdir(path.dirname(PROJECTS_FILE), { recursive: true });
		await writeFile(PROJECTS_FILE, JSON.stringify([...this.projects.values()], null, 2), "utf8");
	}

	list(): Array<ManagedProject & { status: RuntimeState["status"] }> {
		return [...this.projects.values()].map((project) => ({
			...project,
			status: this.runtime.get(project.id)?.status ?? "stopped",
		}));
	}

	async register(project: ManagedProject): Promise<void> {
		this.projects.set(project.id, project);
		this.runtime.set(project.id, { logBuffer: [], subscribers: new Set(), status: "stopped" });
		await this.persist();
	}

	async remove(id: string): Promise<void> {
		await this.stop(id);
		this.projects.delete(id);
		this.runtime.delete(id);
		await this.persist();
	}

	private appendLog(id: string, line: string): void {
		const state = this.runtime.get(id);
		if (!state) return;
		state.logBuffer.push(line);
		if (state.logBuffer.length > LOG_BUFFER_LIMIT) state.logBuffer.shift();
		for (const socket of state.subscribers) {
			if (socket.readyState === socket.OPEN) socket.send(line);
		}
	}

	start(id: string): void {
		const project = this.projects.get(id);
		const state = this.runtime.get(id);
		if (!project || !state || state.child) return;

		const child = spawn(project.command, project.args, {
			cwd: project.cwd,
			env: { ...process.env, ...project.env },
			shell: false,
		});

		state.child = child;
		state.status = "running";
		this.appendLog(id, `[server-manager] プロセスを起動しました (pid=${child.pid})`);

		child.stdout?.on("data", (chunk: Buffer) => this.appendLog(id, chunk.toString("utf8")));
		child.stderr?.on("data", (chunk: Buffer) => this.appendLog(id, chunk.toString("utf8")));
		child.on("exit", (code) => {
			state.status = code === 0 ? "stopped" : "crashed";
			state.child = undefined;
			this.appendLog(id, `[server-manager] プロセスが終了しました (code=${code})`);
		});
	}

	stop(id: string): void {
		const state = this.runtime.get(id);
		if (!state?.child) return;
		state.child.kill();
		state.status = "stopped";
	}

	restart(id: string): void {
		this.stop(id);
		setTimeout(() => this.start(id), 300);
	}

	subscribe(id: string, socket: WebSocket): void {
		const state = this.runtime.get(id);
		if (!state) return;
		for (const line of state.logBuffer) socket.send(line);
		state.subscribers.add(socket);
		socket.on("close", () => state.subscribers.delete(socket));
	}
}
