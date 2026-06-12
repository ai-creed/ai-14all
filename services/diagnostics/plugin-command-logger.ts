import { appendFileSync, mkdirSync, statSync, truncateSync } from "node:fs";
import { join } from "node:path";

export type PluginCommandLogEntry = {
	ts: number;
	plugin: string;
	argv: string[];
	cwd: string;
	exitCode: number | null;
	durationMs: number;
	stderrSample: string;
};

const MAX_BYTES = 5 * 1024 * 1024;
const FILE_NAME = "plugin-commands.jsonl";

/**
 * Append-only audit log for plugin-initiated peer-app commands. Cheap now;
 * load-bearing when external supervisors (ai-samantha) start originating
 * commands and trust classes matter. Best-effort: never breaks the app.
 */
export class PluginCommandLogger {
	private readonly path: string;
	private disabled = false;

	constructor(options: { logsDir: string }) {
		this.path = join(options.logsDir, FILE_NAME);
		try {
			mkdirSync(options.logsDir, { recursive: true });
			// Crude size backstop: reset the file when it exceeds the cap.
			const size = statSync(this.path, { throwIfNoEntry: false })?.size ?? 0;
			if (size > MAX_BYTES) truncateSync(this.path, 0);
		} catch {
			this.disabled = true;
		}
	}

	append(entry: PluginCommandLogEntry): void {
		if (this.disabled) return;
		try {
			appendFileSync(this.path, `${JSON.stringify(entry)}\n`, "utf8");
		} catch (e) {
			console.warn("[plugin-command-logger] failed to append:", e);
			this.disabled = true;
		}
	}
}
