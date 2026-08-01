import type { Env } from "../../config/env.js";
import { PterodactylNotImplementedError } from "./pterodactyl-request.js";

export interface PterodactylScheduleTask {
	id: number;
	sequenceId: number;
	action: "command" | "power" | "backup";
	payload: string;
	timeOffset: number;
}

export interface PterodactylSchedule {
	id: number;
	name: string;
	cron: { minute: string; hour: string; dayOfWeek: string; dayOfMonth: string };
	isActive: boolean;
	isProcessing: boolean;
	lastRunAt: string | null;
	nextRunAt: string | null;
	tasks: PterodactylScheduleTask[];
}

/**
 * サーバーごとの自動タスク(スケジュール)管理(Pterodactyl Client API `schedule.*`権限に対応)。
 * `/api/client/servers/{server}/schedules`系のエンドポイントをラップする。
 */
export class PterodactylSchedulesClient {
	constructor(private readonly env: Env) {}

	async list(_identifier: string): Promise<PterodactylSchedule[]> {
		throw new PterodactylNotImplementedError("game-servers.schedules.list");
	}

	async create(
		_identifier: string,
		_input: { name: string; minute: string; hour: string; dayOfWeek: string; dayOfMonth: string; isActive: boolean },
	): Promise<PterodactylSchedule> {
		throw new PterodactylNotImplementedError("game-servers.schedules.create");
	}

	async update(
		_identifier: string,
		_scheduleId: number,
		_input: Partial<{
			name: string;
			minute: string;
			hour: string;
			dayOfWeek: string;
			dayOfMonth: string;
			isActive: boolean;
		}>,
	): Promise<PterodactylSchedule> {
		throw new PterodactylNotImplementedError("game-servers.schedules.update");
	}

	async remove(_identifier: string, _scheduleId: number): Promise<void> {
		throw new PterodactylNotImplementedError("game-servers.schedules.remove");
	}

	async createTask(
		_identifier: string,
		_scheduleId: number,
		_input: { action: "command" | "power" | "backup"; payload: string; timeOffset: number },
	): Promise<PterodactylScheduleTask> {
		throw new PterodactylNotImplementedError("game-servers.schedules.createTask");
	}

	async updateTask(
		_identifier: string,
		_scheduleId: number,
		_taskId: number,
		_input: Partial<{ action: "command" | "power" | "backup"; payload: string; timeOffset: number }>,
	): Promise<PterodactylScheduleTask> {
		throw new PterodactylNotImplementedError("game-servers.schedules.updateTask");
	}

	async removeTask(_identifier: string, _scheduleId: number, _taskId: number): Promise<void> {
		throw new PterodactylNotImplementedError("game-servers.schedules.removeTask");
	}
}
