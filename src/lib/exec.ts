import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFileCb);

/**
 * コマンドインジェクション対策のための実行ラッパー。
 * シェル展開を一切行わず、コマンドと引数を配列で分離して渡す。
 * (Notion設計「主なリスクと対策」のコマンドインジェクション対策に対応)
 */
export async function safeExec(command: string, args: string[] = [], timeoutMs = 15_000) {
	try {
		const { stdout, stderr } = await execFileAsync(command, args, {
			timeout: timeoutMs,
			shell: false,
			windowsHide: true,
		});
		return { ok: true as const, stdout: stdout.toString(), stderr: stderr.toString() };
	} catch (error) {
		const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
		return {
			ok: false as const,
			stdout: err.stdout?.toString() ?? "",
			stderr: err.stderr?.toString() ?? err.message,
		};
	}
}
