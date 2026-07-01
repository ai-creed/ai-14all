// services/xbp/xbp-audit-sink.ts
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const FILE_NAME = "audit.jsonl";

export interface XbpAuditEntry {
	ts: number;
	cap: string | null;
	risk: "low" | "medium" | "high" | null;
	outcome: "accepted" | "rejected";
	reason?: string;
}

export class XbpAuditSink {
	private readonly path: string;
	private readonly now: () => number;
	private disabled = false;

	constructor(opts: { dir: string; now?: () => number }) {
		this.path = join(opts.dir, FILE_NAME);
		this.now = opts.now ?? Date.now;
		// Append-only audit (spec §5/AC6): the constructor must only ensure the
		// directory exists. It must NEVER truncate or delete prior entries.
		try {
			mkdirSync(opts.dir, { recursive: true });
		} catch {
			this.disabled = true;
		}
	}

	append(entry: Omit<XbpAuditEntry, "ts">): void {
		if (this.disabled) return;
		try {
			const line = JSON.stringify({ ts: this.now(), ...entry });
			appendFileSync(this.path, `${line}\n`, "utf8");
		} catch (e) {
			console.warn("[xbp-audit] failed to append:", e);
			this.disabled = true;
		}
	}

	entries(): XbpAuditEntry[] {
		try {
			return readFileSync(this.path, "utf8")
				.trim()
				.split("\n")
				.filter(Boolean)
				.map((l) => JSON.parse(l) as XbpAuditEntry);
		} catch {
			return [];
		}
	}
}
