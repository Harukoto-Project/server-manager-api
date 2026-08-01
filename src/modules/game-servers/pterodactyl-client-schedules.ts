import type { Env } from "../../config/env.js";
import { pterodactylRequest } from "./pterodactyl-request.js";

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

interface RawScheduleTaskAttributes {
	id: number;
	sequence_id: number;
	action: "command" | "power" | "backup";
	payload: string;
	time_offset: number;
}

interface RawScheduleAttributes {
	id: number;
	name: string;
	cron: { minute: string; hour: string; day_of_week: string; day_of_month: string };
	is_active: boolean;
	is_processing: boolean;
	last_run_at: string | null;
	next_run_at: string | null;
	relationships?: {
		tasks?: { object: "list"; data: Array<{ object: string; attributes: RawScheduleTaskAttributes }> };
	};
}

function toScheduleTask(attrs: RawScheduleTaskAttributes): PterodactylScheduleTask {
	return {
		id: attrs.id,
		sequenceId: attrs.sequence_id,
		action: attrs.action,
		payload: attrs.payload,
		timeOffset: attrs.time_offset,
	};
}

function toSchedule(attrs: RawScheduleAttributes): PterodactylSchedule {
	return {
		id: attrs.id,
		name: attrs.name,
		cron: {
			minute: attrs.cron.minute,
			hour: attrs.cron.hour,
			dayOfWeek: attrs.cron.day_of_week,
			dayOfMonth: attrs.cron.day_of_month,
		},
		isActive: attrs.is_active,
		isProcessing: attrs.is_processing,
		lastRunAt: attrs.last_run_at,
		nextRunAt: attrs.next_run_at,
		tasks: (attrs.relationships?.tasks?.data ?? []).map((entry) => toScheduleTask(entry.attributes)),
	};
}

/**
 * サーバーごとの自動タスク(スケジュール)管理(Pterodactyl Client API `schedule.*`権限に対応)。
 * `/api/client/servers/{server}/schedules`系のエンドポイントをラップする。
 * 参考: https://pterodactyl-api-docs.netvpx.com/docs/intro (Client API Reference / Schedules)
 *
 * Pterodactylの更新系エンドポイントはcronフィールドの全指定(フルリプレース)を要求するため、
 * 部分更新(Partial)を受け取った場合は現在値を取得した上でマージして送信する。
 */
export class PterodactylSchedulesClient {
	constructor(private readonly env: Env) {}

	async list(identifier: string): Promise<PterodactylSchedule[]> {
		const data = await pterodactylRequest<{ data: Array<{ attributes: RawScheduleAttributes }> }>(
			this.env,
			"client",
			`/api/client/servers/${identifier}/schedules`,
		);
		return data.data.map((entry) => toSchedule(entry.attributes));
	}

	private async get(identifier: string, scheduleId: number): Promise<PterodactylSchedule> {
		const data = await pterodactylRequest<{ attributes: RawScheduleAttributes }>(
			this.env,
			"client",
			`/api/client/servers/${identifier}/schedules/${scheduleId}`,
		);
		return toSchedule(data.attributes);
	}

	async create(
		identifier: string,
		input: { name: string; minute: string; hour: string; dayOfWeek: string; dayOfMonth: string; isActive: boolean },
	): Promise<PterodactylSchedule> {
		const data = await pterodactylRequest<{ attributes: RawScheduleAttributes }>(
			this.env,
			"client",
			`/api/client/servers/${identifier}/schedules`,
			{
				method: "POST",
				body: JSON.stringify({
					name: input.name,
					minute: input.minute,
					hour: input.hour,
					day_of_week: input.dayOfWeek,
					day_of_month: input.dayOfMonth,
					is_active: input.isActive,
				}),
			},
		);
		return toSchedule(data.attributes);
	}

	async update(
		identifier: string,
		scheduleId: number,
		input: Partial<{
			name: string;
			minute: string;
			hour: string;
			dayOfWeek: string;
			dayOfMonth: string;
			isActive: boolean;
		}>,
	): Promise<PterodactylSchedule> {
		const current = await this.get(identifier, scheduleId);
		const data = await pterodactylRequest<{ attributes: RawScheduleAttributes }>(
			this.env,
			"client",
			`/api/client/servers/${identifier}/schedules/${scheduleId}`,
			{
				method: "POST",
				body: JSON.stringify({
					name: input.name ?? current.name,
					minute: input.minute ?? current.cron.minute,
					hour: input.hour ?? current.cron.hour,
					day_of_week: input.dayOfWeek ?? current.cron.dayOfWeek,
					day_of_month: input.dayOfMonth ?? current.cron.dayOfMonth,
					is_active: input.isActive ?? current.isActive,
				}),
			},
		);
		return toSchedule(data.attributes);
	}

	async remove(identifier: string, scheduleId: number): Promise<void> {
		await pterodactylRequest(this.env, "client", `/api/client/servers/${identifier}/schedules/${scheduleId}`, {
			method: "DELETE",
		});
	}

	async createTask(
		identifier: string,
		scheduleId: number,
		input: { action: "command" | "power" | "backup"; payload: string; timeOffset: number },
	): Promise<PterodactylScheduleTask> {
		const data = await pterodactylRequest<{ attributes: RawScheduleTaskAttributes }>(
			this.env,
			"client",
			`/api/client/servers/${identifier}/schedules/${scheduleId}/tasks`,
			{
				method: "POST",
				body: JSON.stringify({ action: input.action, payload: input.payload, time_offset: input.timeOffset }),
			},
		);
		return toScheduleTask(data.attributes);
	}

	async updateTask(
		identifier: string,
		scheduleId: number,
		taskId: number,
		input: Partial<{ action: "command" | "power" | "backup"; payload: string; timeOffset: number }>,
	): Promise<PterodactylScheduleTask> {
		const schedule = await this.get(identifier, scheduleId);
		const currentTask = schedule.tasks.find((task) => task.id === taskId);
		const data = await pterodactylRequest<{ attributes: RawScheduleTaskAttributes }>(
			this.env,
			"client",
			`/api/client/servers/${identifier}/schedules/${scheduleId}/tasks/${taskId}`,
			{
				method: "POST",
				body: JSON.stringify({
					action: input.action ?? currentTask?.action ?? "command",
					payload: input.payload ?? currentTask?.payload ?? "",
					time_offset: input.timeOffset ?? currentTask?.timeOffset ?? 0,
				}),
			},
		);
		return toScheduleTask(data.attributes);
	}

	async removeTask(identifier: string, scheduleId: number, taskId: number): Promise<void> {
		await pterodactylRequest(
			this.env,
			"client",
			`/api/client/servers/${identifier}/schedules/${scheduleId}/tasks/${taskId}`,
			{ method: "DELETE" },
		);
	}
}
