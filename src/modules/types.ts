import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import type { Env } from "../config/env.js";
import type { AuditLogger } from "../lib/audit.js";

/**
 * バックエンドの機能モジュール定義。
 * クライアント側の ModuleDefinition / registry パターンと対になる設計で、
 * 新しい機能を追加する際は `src/modules/<feature>` を1つ追加し、
 * registry.ts に1行登録するだけで済むようにする。
 */
export interface ApiModuleContext {
	env: Env;
	audit: AuditLogger;
}

export interface ApiModuleDefinition {
	/** モジュールの一意なID (ログ・監査での識別用) */
	id: string;
	/** ルートのURLプレフィックス (例: "/docker") */
	prefix: string;
	/** Fastifyプラグイン本体 */
	plugin: FastifyPluginAsync<{ ctx: ApiModuleContext }>;
}

export type { FastifyInstance };
