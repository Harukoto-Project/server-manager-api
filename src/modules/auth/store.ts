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
	/**
	 * 登録エンドポイントの有効フラグ。
	 * - 初期状態: true (SETUP_MODE=true 時に使用可能)
	 * - 初回登録完了後: false に設定する
	 * - リカバリーコード使用後: true に一時復帰させる
	 */
	registrationEnabled: boolean;
	currentChallenge?: string;
	/** リカバリーコードのSHA-256ハッシュ(初回登録時に生成) */
	recoveryCodeHash?: string;
	/** リカバリーコードが使用済みかどうか */
	recoveryCodeUsed?: boolean;
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
