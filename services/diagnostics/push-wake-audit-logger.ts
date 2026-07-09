import { appendFileSync, mkdirSync, statSync, truncateSync } from "node:fs";
import { join } from "node:path";

export type PushWakeAuditEntry = {
	ts: number;
	trigger: "workflow-done" | "workflow-halted" | "escalated";
	outcome: "sent" | "dead-token-cleared" | "retry-exhausted";
};

const MAX_BYTES = 5 * 1024 * 1024;
const FILE_NAME = "push-wake-audit.jsonl";

/**
 * Append-only semantic audit for host-initiated push sends — one entry per
 * send decision (spec Deliverable 5). Register/deregister are dispatched XBP
 * requests and are audited by the protocol layer instead. Best-effort: never
 * breaks the app; contains no token and no content.
 */
export class PushWakeAuditLogger {
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

	append(entry: PushWakeAuditEntry): void {
		if (this.disabled) return;
		try {
			appendFileSync(this.path, `${JSON.stringify(entry)}\n`, "utf8");
		} catch (e) {
			console.warn("[push-wake-audit] failed to append:", e);
			this.disabled = true;
		}
	}
}
