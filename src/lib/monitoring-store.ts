import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const DATA_DIR = path.resolve("data");
const DB_FILE = path.join(DATA_DIR, "monitoring-history.db");

/**
 * モニタリングsnapshot(概要ページのCPU/メモリ/ディスク/ネットワーク使用率など)を
 * SQLiteに記録し、過去の推移を閲覧できるようにする。
 *
 * スキーマはあえて正規化せず、`collectSnapshot()`が返すオブジェクトをそのまま
 * JSON文字列として1サンプル=1行で保存する。ディスクのマウント数やネットワーク
 * インターフェース数は環境によって変わるため、これが最もシンプルで壊れにくい。
 */
export class MonitoringStore {
	private readonly db: Database.Database;

	constructor() {
		mkdirSync(DATA_DIR, { recursive: true });
		this.db = new Database(DB_FILE);
		this.db.pragma("journal_mode = WAL");
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS samples (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				timestamp TEXT NOT NULL UNIQUE,
				payload TEXT NOT NULL
			);
			CREATE INDEX IF NOT EXISTS idx_samples_timestamp ON samples (timestamp);
		`);
	}

	insert(snapshot: { timestamp: string }): void {
		try {
			this.db
				.prepare("INSERT OR IGNORE INTO samples (timestamp, payload) VALUES (?, ?)")
				.run(snapshot.timestamp, JSON.stringify(snapshot));
		} catch {
			// 書き込み失敗(ディスク容量等)はモニタリング自体を止めないよう握りつぶす
		}
	}

	/**
	 * `fromIso`以降のサンプルを、最大`maxPoints`件になるよう間引いて時系列順に返す。
	 * 該当件数が`maxPoints`以下ならそのまま全件返す。
	 */
	querySince<T>(fromIso: string, maxPoints: number): T[] {
		const { count } = this.db
			.prepare("SELECT COUNT(*) AS count FROM samples WHERE timestamp >= ?")
			.get(fromIso) as { count: number };
		if (count === 0) return [];

		const stride = Math.max(1, Math.ceil(count / maxPoints));
		const rows = this.db
			.prepare(`
				SELECT payload FROM (
					SELECT payload, timestamp, (ROW_NUMBER() OVER (ORDER BY timestamp ASC) - 1) AS rn
					FROM samples
					WHERE timestamp >= ?
				)
				WHERE rn % ? = 0
				ORDER BY timestamp ASC
			`)
			.all(fromIso, stride) as Array<{ payload: string }>;

		return rows.map((row) => JSON.parse(row.payload) as T);
	}

	prune(retentionDays: number): void {
		const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
		this.db.prepare("DELETE FROM samples WHERE timestamp < ?").run(cutoff);
	}

	close(): void {
		this.db.close();
	}
}
