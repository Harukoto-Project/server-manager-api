import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface StoredPasskey {
	credentialId: string;
	publicKey: string; // base64url
	counter: number;
	transports?: AuthenticatorTransportFuture[];
}

export interface AuthState {
	/** 単一ユーザー運用のため、登録済みパスキーを配列で保持する(メイン+予備) */
	passkeys: StoredPasskey[];
	/** 初回セットアップ用の登録エンドポイントが有効かどうか。登録完了後は恒久的にfalseになる */
	registrationEnabled: boolean;
	currentChallenge?: string;
}

type AuthenticatorTransportFuture = "ble" | "hybrid" | "internal" | "nfc" | "usb";

const STATE_DIR = path.resolve("data");
const STATE_FILE = path.join(STATE_DIR, "auth-state.json");

const defaultState: AuthState = {
	passkeys: [],
	registrationEnabled: true,
};

/**
 * TODO: 本実装では暗号化や権限を絞ったストレージ(例: SQLite + ファイル権限600)への
 * 置き換えを検討する。現状はスキャフォールドとしてJSONファイルに平文保存する。
 */
export async function loadAuthState(): Promise<AuthState> {
	try {
		const raw = await readFile(STATE_FILE, "utf8");
		return { ...defaultState, ...JSON.parse(raw) } as AuthState;
	} catch {
		return { ...defaultState };
	}
}

export async function saveAuthState(state: AuthState): Promise<void> {
	await mkdir(STATE_DIR, { recursive: true });
	await writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}
