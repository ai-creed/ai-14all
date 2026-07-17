import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	InspectAuditLogger,
	type InspectAuditEntry,
} from "../../../../services/diagnostics/inspect-audit-logger";

function makeLogger() {
	const dir = mkdtempSync(join(tmpdir(), "inspect-audit-"));
	return { dir, logger: new InspectAuditLogger({ logsDir: dir }) };
}
const base: Omit<InspectAuditEntry, "op"> = {
	ts: 1,
	cause: null,
	capability: "xavier.control.subscribe-pty",
	worktreeId: "wt-1",
	agentId: "proc-1",
	refusalCode: null,
	rowsServed: null,
};

describe("InspectAuditLogger", () => {
	it("records every op and cause, appending JSONL", () => {
		const { logger } = makeLogger();
		logger.append({ ...base, op: "subscribe" });
		logger.append({ ...base, op: "unsubscribe", rowsServed: 12 });
		logger.append({ ...base, op: "replace", rowsServed: 5 });
		for (const cause of [
			"peer-detach",
			"re-pair",
			"agent-exit",
			"session-teardown",
		] as const) {
			logger.append({ ...base, op: "teardown", cause, capability: null });
		}
		for (const code of ["no-such-pty", "no-live-agent", "internal"] as const) {
			logger.append({ ...base, op: "refusal", refusalCode: code });
		}
		expect(logger.entries()).toHaveLength(10);
	});

	it("serialized entries contain no row content field (spec §4)", () => {
		const { dir, logger } = makeLogger();
		logger.append({ ...base, op: "unsubscribe", rowsServed: 3 });
		const raw = readFileSync(join(dir, "inspect-audit.jsonl"), "utf8");
		const keys = Object.keys(JSON.parse(raw.trim()));
		expect(keys.sort()).toEqual(
			[
				"agentId",
				"capability",
				"cause",
				"op",
				"refusalCode",
				"rowsServed",
				"ts",
				"worktreeId",
			].sort(),
		);
		expect(raw).not.toContain("text");
		expect(raw).not.toContain('rows":[');
	});
});
