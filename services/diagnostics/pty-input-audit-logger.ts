import { appendFileSync, mkdirSync, statSync, truncateSync } from "node:fs";
import { join } from "node:path";
import type {
	PtyInputChunk,
	PtyInputErrorCode,
} from "@ai-creed/command-contract";

export type PtyInputAuditEntry = {
	ts: number;
	// Only XBP injects PTY input today; the field mirrors ActingAuditEntry so
	// a future channel can share the sink without a schema break.
	channel: "xbp";
	capability: string; // "xavier.control.pty-input"
	worktreeId: string;
	agentId: string;
	// Input is atomic: ONE entry per request, no start/result pair (child spec
	// §4). "apply" is recorded only after a successful write; every
	// executor-level refusal is a single "reject" with its code.
	route: "apply" | "reject";
	rejectCode: PtyInputErrorCode | null;
	// Full literal injected content (umbrella §8 decision: forensic
	// completeness for the hottest write surface; accepted secret-persistence
	// tradeoff). Recorded on every entry — spec mandates it for apply; this
	// host includes it on rejects too so a refused attempt is reconstructible.
	chunks: PtyInputChunk[];
};

const MAX_BYTES = 5 * 1024 * 1024;
const FILE_NAME = "pty-input-audit.jsonl";

/**
 * Append-only semantic audit log for phone→PTY input (sibling of
 * ActingAuditLogger). One entry per submitted request. Best-effort: never
 * breaks the app.
 */
export class PtyInputAuditLogger {
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

	append(entry: PtyInputAuditEntry): void {
		if (this.disabled) return;
		try {
			appendFileSync(this.path, `${JSON.stringify(entry)}\n`, "utf8");
		} catch (e) {
			console.warn("[pty-input-audit-logger] failed to append:", e);
			this.disabled = true;
		}
	}
}
