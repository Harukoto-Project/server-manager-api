import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Env } from "../config/env.js";
import type { Logger } from "./logger.js";

const TOKEN_DIR = path.resolve("data");
const TOKEN_FILE = path.join(TOKEN_DIR, "access-token.txt");

/**
 * クライアント⇔ノード間の暫定認証(V1)用アクセストークンを解決する。
 * `API_ACCESS_TOKEN` が環境変数で指定されていればそれを使い、なければ
 * 前回生成したトークンをファイルから読み込み、それも無ければ新規生成して保存する。
 *
 * TODO: これはパスキー(WebAuthn)によるノード個別登録が本実装されるまでの暫定策。
 * auth/index.ts のWebAuthnモジュールはそのまま残してあるので、将来はそちらに置き換える。
 */
export async function resolveAccessToken(env: Env, logger: Logger): Promise<string> {
	if (env.API_ACCESS_TOKEN) {
		return env.API_ACCESS_TOKEN;
	}

	try {
		const existing = (await readFile(TOKEN_FILE, "utf8")).trim();
		if (existing) return existing;
	} catch {
		// 初回起動時はファイルが存在しない
	}

	const token = randomBytes(32).toString("hex");
	await mkdir(TOKEN_DIR, { recursive: true });
	await writeFile(TOKEN_FILE, `${token}\n`, { encoding: "utf8", mode: 0o600 });

	logger.warn(
		`アクセストークンを新規生成しました。クライアントの「ノードを追加」画面にこのトークンを入力してください:\n\n    ${token}\n`,
	);

	return token;
}
