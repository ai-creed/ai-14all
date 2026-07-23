import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	PtyInputAuditLogger,
	type PtyInputAuditEntry,
} from "../../../../services/diagnostics/pty-input-audit-logger";

const entry = (over: Partial<PtyInputAuditEntry> = {}): PtyInputAuditEntry => ({
	ts: 1753221600000,
	channel: "xbp",
	capability: "xavier.control.pty-input",
	worktreeId: "wt-1",
	agentId: "a-1",
	route: "apply",
	rejectCode: null,
	chunks: [{ text: "y" }, { key: "enter" }],
	...over,
});

describe("PtyInputAuditLogger", () => {
	it("appends one JSONL line per entry with the full literal chunks", () => {
		const dir = mkdtempSync(join(tmpdir(), "pty-input-audit-"));
		const logger = new PtyInputAuditLogger({ logsDir: dir });
		logger.append(entry());
		logger.append(entry({ route: "reject", rejectCode: "no-live-agent" }));
		const lines = readFileSync(join(dir, "pty-input-audit.jsonl"), "utf8")
			.trim()
			.split("\n")
			.map((l) => JSON.parse(l) as PtyInputAuditEntry);
		expect(lines).toHaveLength(2);
		expect(lines[0].route).toBe("apply");
		expect(lines[0].chunks).toEqual([{ text: "y" }, { key: "enter" }]);
		expect(lines[1].rejectCode).toBe("no-live-agent");
		expect(lines[1].chunks).toEqual([{ text: "y" }, { key: "enter" }]);
	});

	it("never throws when the logs dir is unwritable (best-effort)", () => {
		const logger = new PtyInputAuditLogger({
			logsDir: "/dev/null/not-a-dir",
		});
		expect(() => logger.append(entry())).not.toThrow();
	});
});
