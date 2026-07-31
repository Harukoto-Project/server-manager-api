import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { Env } from "../config/env.js";
import type { Logger } from "./logger.js";

export interface AuditEvent {
	actor: string;
	action: string;
	target?: string;
	detail?: Record<string, unknown>;
	severity?: "info" | "warning" | "critical";
}

const AUDIT_LOG_DIR = path.resolve("data", "audit");
const AUDIT_LOG_FILE = path.join(AUDIT_LOG_DIR, "audit.log");

export class AuditLogger {
	constructor(
		private readonly env: Env,
		private readonly logger: Logger,
	) {}

	async record(event: AuditEvent): Promise<void> {
		const entry = {
			timestamp: new Date().toISOString(),
			severity: event.severity ?? "info",
			...event,
		};

		this.logger.info({ audit: entry }, "audit event");

		await mkdir(AUDIT_LOG_DIR, { recursive: true });
		await appendFile(AUDIT_LOG_FILE, `${JSON.stringify(entry)}\n`, "utf8");

		if (entry.severity === "critical" && this.env.DISCORD_WEBHOOK_URL) {
			await this.notifyDiscord(entry).catch((error) => {
				this.logger.error({ error }, "Discord Webhook通知に失敗しました");
			});
		}
	}

	private async notifyDiscord(entry: AuditEvent & { timestamp: string }): Promise<void> {
		if (!this.env.DISCORD_WEBHOOK_URL) return;
		await fetch(this.env.DISCORD_WEBHOOK_URL, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				content: `**[重大操作]** ${entry.actor} が \`${entry.action}\` を実行 (${entry.target ?? "-"}) @ ${entry.timestamp}`,
			}),
		});
	}
}
