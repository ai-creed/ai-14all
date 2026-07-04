import { appendFileSync, mkdirSync, statSync, truncateSync } from "node:fs";
import { join } from "node:path";

export type ActingAuditEntry = {
	phase: "start" | "result";
	ts: number;
	// Originating acting channel. Historical JSONL lines predate this field;
	// readers treat absence as "samantha".
	channel: "samantha" | "xbp";
	worktreeId: string;
	// The requested action: free-text instruction on the samantha channel,
	// capability id (e.g. "xavier.control.pause-session") on the XBP channel.
	instruction: string;
	route:
		| "collab-tell"
		| "workflow-resume"
		| "send-input"
		| "workflow-pause"
		| "workflow-cancel"
		| "reject";
	guard: { tokenValid: boolean; actingEnabled: boolean };
	rejectCode: string | null;
	result: { ok: boolean; detail: string } | null;
};

const MAX_BYTES = 5 * 1024 * 1024;
const FILE_NAME = "acting-audit.jsonl";

/**
 * Append-only semantic audit log for acting commands from both channels
 * (samantha instruct-session and XBP lifecycle capabilities) — one canonical
 * log. The guard writes a `start` entry before executing and a `result` entry
 * after, plus a single `result` entry for gate denials/rejects. Best-effort:
 * never breaks the app.
 */
export class ActingAuditLogger {
	private readonly path: string;
	private disabled = false;

	constructor(options: { logsDir: string }) {
		this.path = join(options.logsDir, FILE_NAME);
		try {
			mkdirSync(options.logsDir, { recursive: true });
			const size = statSync(this.path, { throwIfNoEntry: false })?.size ?? 0;
			if (size > MAX_BYTES) truncateSync(this.path, 0);
		} catch {
			this.disabled = true;
		}
	}

	append(entry: ActingAuditEntry): void {
		if (this.disabled) return;
		try {
			appendFileSync(this.path, `${JSON.stringify(entry)}\n`, "utf8");
		} catch (e) {
			console.warn("[acting-audit-logger] failed to append:", e);
			this.disabled = true;
		}
	}
}
