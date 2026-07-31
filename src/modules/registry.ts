import authModule from "./auth/index.js";
import dockerModule from "./docker/index.js";
import gameServersModule from "./game-servers/index.js";
import healthModule from "./health/index.js";
import monitoringModule from "./monitoring/index.js";
import networkModule from "./network/index.js";
import processManagerModule from "./process-manager/index.js";
import storageModule from "./storage/index.js";
import adminPrivilegesModule from "./system-settings/admin-privileges.js";
import autoSecurityUpdatesModule from "./system-settings/auto-security-updates.js";
import diskMountsModule from "./system-settings/disk-mounts.js";
import systemSettingsModule from "./system-settings/index.js";
import intrusionPreventionModule from "./system-settings/intrusion-prevention.js";
import logManagementModule from "./system-settings/log-management.js";
import nameResolutionModule from "./system-settings/name-resolution.js";
import networkConfigModule from "./system-settings/network-config.js";
import powerScheduleModule from "./system-settings/power-schedule.js";
import remoteAccessModule from "./system-settings/remote-access.js";
import scheduledTasksModule from "./system-settings/scheduled-tasks.js";
import sshKeysModule from "./system-settings/ssh-keys.js";
import swapMemoryModule from "./system-settings/swap-memory.js";
import usersGroupsModule from "./system-settings/users-groups.js";
import systemdModule from "./systemd/index.js";
import terminalModule from "./terminal/index.js";
import type { ApiModuleDefinition } from "./types.js";
import updateModule from "./update/index.js";

/**
 * バックエンドの機能モジュール一覧。
 * 新しい機能を追加する場合は `src/modules/<feature>/index.ts` を作成し、
 * ここに1エントリ追加するだけでよい(クライアント側のregistryパターンと対称)。
 */
export const moduleRegistry: ApiModuleDefinition[] = [
	{ id: "health", prefix: "/health", plugin: healthModule },
	{ id: "auth", prefix: "/auth", plugin: authModule },
	{ id: "monitoring", prefix: "/monitoring", plugin: monitoringModule },
	{ id: "docker", prefix: "/docker", plugin: dockerModule },
	{ id: "systemd", prefix: "/systemd", plugin: systemdModule },
	{ id: "network", prefix: "/network", plugin: networkModule },
	{ id: "storage", prefix: "/storage", plugin: storageModule },
	{ id: "system-settings", prefix: "/system-settings", plugin: systemSettingsModule },
	{ id: "system-settings-users-groups", prefix: "/system-settings/users-groups", plugin: usersGroupsModule },
	{ id: "system-settings-admin-privileges", prefix: "/system-settings/admin-privileges", plugin: adminPrivilegesModule },
	{ id: "system-settings-ssh-keys", prefix: "/system-settings/ssh-keys", plugin: sshKeysModule },
	{ id: "system-settings-remote-access", prefix: "/system-settings/remote-access", plugin: remoteAccessModule },
	{
		id: "system-settings-auto-security-updates",
		prefix: "/system-settings/auto-security-updates",
		plugin: autoSecurityUpdatesModule,
	},
	{
		id: "system-settings-intrusion-prevention",
		prefix: "/system-settings/intrusion-prevention",
		plugin: intrusionPreventionModule,
	},
	{ id: "system-settings-network-config", prefix: "/system-settings/network-config", plugin: networkConfigModule },
	{ id: "system-settings-name-resolution", prefix: "/system-settings/name-resolution", plugin: nameResolutionModule },
	{ id: "system-settings-scheduled-tasks", prefix: "/system-settings/scheduled-tasks", plugin: scheduledTasksModule },
	{ id: "system-settings-log-management", prefix: "/system-settings/log-management", plugin: logManagementModule },
	{ id: "system-settings-swap-memory", prefix: "/system-settings/swap-memory", plugin: swapMemoryModule },
	{ id: "system-settings-disk-mounts", prefix: "/system-settings/disk-mounts", plugin: diskMountsModule },
	{ id: "system-settings-power-schedule", prefix: "/system-settings/power-schedule", plugin: powerScheduleModule },
	{ id: "game-servers", prefix: "/game-servers", plugin: gameServersModule },
	{ id: "process-manager", prefix: "/process-manager", plugin: processManagerModule },
	{ id: "terminal", prefix: "/terminal", plugin: terminalModule },
	{ id: "update", prefix: "/update", plugin: updateModule },
];
