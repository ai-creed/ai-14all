import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	ActingAuditLogger,
	type ActingAuditEntry,
} from "../../../services/diagnostics/acting-audit-logger";

function startEntry(over: Partial<ActingAuditEntry> = {}): ActingAuditEntry {
	return {
		phase: "start",
		ts: 1000,
		worktreeId: "wt1",
		instruction: "add tests",
		route: "collab-tell",
		guard: { tokenValid: true, actingEnabled: true },
		rejectCode: null,
		result: null,
		...over,
	};
}

describe("acting-audit-logger", () => {
	it("appends one JSON line per entry, preserving phase + result", () => {
		const dir = mkdtempSync(join(tmpdir(), "act-audit-"));
		const logger = new ActingAuditLogger({ logsDir: dir });
		logger.append(startEntry());
		logger.append(
			startEntry({ phase: "result", result: { ok: true, detail: "delivered" } }),
		);
		const lines = readFileSync(join(dir, "acting-audit.jsonl"), "utf8")
			.trim()
			.split("\n");
		expect(lines).toHaveLength(2);
		expect(JSON.parse(lines[0]).phase).toBe("start");
		expect(JSON.parse(lines[0]).result).toBeNull();
		expect(JSON.parse(lines[1]).phase).toBe("result");
		expect(JSON.parse(lines[1]).result).toEqual({ ok: true, detail: "delivered" });
	});

	it("never throws when the directory is unwritable", () => {
		const logger = new ActingAuditLogger({ logsDir: "/this/cannot/be/made\0" });
		expect(() => logger.append(startEntry())).not.toThrow();
	});
});
