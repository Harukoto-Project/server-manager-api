import authModule from "./auth/index.js";
import dockerModule from "./docker/index.js";
import gameServersModule from "./game-servers/index.js";
import healthModule from "./health/index.js";
import monitoringModule from "./monitoring/index.js";
import networkModule from "./network/index.js";
import processManagerModule from "./process-manager/index.js";
import storageModule from "./storage/index.js";
import systemSettingsModule from "./system-settings/index.js";
import systemdModule from "./systemd/index.js";
import type { ApiModuleDefinition } from "./types.js";

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
	{ id: "game-servers", prefix: "/game-servers", plugin: gameServersModule },
	{ id: "process-manager", prefix: "/process-manager", plugin: processManagerModule },
];
