// services/xbp/xbp-audit-sink.ts
import { appendFileSync, mkdirSync, readFileSync, statSync, truncateSync } from "node:fs";
import { join } from "node:path";

const FILE_NAME = "audit.jsonl";
const MAX_BYTES = 5 * 1024 * 1024;

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
    try {
      mkdirSync(opts.dir, { recursive: true });
      const size = statSync(this.path, { throwIfNoEntry: false })?.size ?? 0;
      if (size > MAX_BYTES) truncateSync(this.path, 0);
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
