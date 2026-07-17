import { appendFileSync, mkdirSync, readFileSync, statSync, truncateSync } from "node:fs";
import { join } from "node:path";

export type InspectAuditEntry = {
	ts: number;
	op: "subscribe" | "unsubscribe" | "replace" | "teardown" | "refusal";
	cause: "peer-detach" | "re-pair" | "agent-exit" | "session-teardown" | null;
	capability: string | null;
	worktreeId: string;
	agentId: string | null;
	refusalCode: "no-such-pty" | "no-live-agent" | "internal" | null;
	rowsServed: number | null;
};

const MAX_BYTES = 5 * 1024 * 1024;
const FILE_NAME = "inspect-audit.jsonl";

/**
 * Append-only semantic audit log for PTY inspect operations (spec §4).
 * Content-free by schema: there is no field that can carry row text; the
 * only pull metric is the cumulative rowsServed on the entry that ends a
 * subscription. Best-effort: never breaks the app.
 */
export class InspectAuditLogger {
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

	append(entry: InspectAuditEntry): void {
		if (this.disabled) return;
		try {
			appendFileSync(this.path, `${JSON.stringify(entry)}\n`, "utf8");
		} catch (e) {
			console.warn("[inspect-audit-logger] failed to append:", e);
			this.disabled = true;
		}
	}

	entries(): InspectAuditEntry[] {
		try {
			return readFileSync(this.path, "utf8")
				.trim()
				.split("\n")
				.filter(Boolean)
				.map((l) => JSON.parse(l) as InspectAuditEntry);
		} catch {
			return [];
		}
	}
}
