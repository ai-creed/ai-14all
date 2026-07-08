import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	PushWakeAuditLogger,
	type PushWakeAuditEntry,
} from "../../../services/diagnostics/push-wake-audit-logger";

const entry: PushWakeAuditEntry = {
	ts: 1751932800000,
	trigger: "workflow-done",
	outcome: "sent",
};

describe("PushWakeAuditLogger", () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "pw-audit-"));
	});

	const readLines = () =>
		readFileSync(join(dir, "push-wake-audit.jsonl"), "utf8")
			.trim()
			.split("\n")
			.map((l) => JSON.parse(l));

	it("appends one JSONL entry per send decision", () => {
		const logger = new PushWakeAuditLogger({ logsDir: dir });
		logger.append(entry);
		logger.append({ ...entry, trigger: "escalated", outcome: "retry-exhausted" });
		expect(readLines()).toEqual([
			entry,
			{ ...entry, trigger: "escalated", outcome: "retry-exhausted" },
		]);
	});

	it("append-only: a new instance does not truncate prior entries", () => {
		new PushWakeAuditLogger({ logsDir: dir }).append(entry);
		new PushWakeAuditLogger({ logsDir: dir }).append({
			...entry,
			outcome: "dead-token-cleared",
		});
		expect(readLines()).toHaveLength(2);
	});

	it("oversized log is truncated at construction (ActingAuditLogger convention)", () => {
		writeFileSync(
			join(dir, "push-wake-audit.jsonl"),
			`${JSON.stringify(entry)}\n`.repeat(120_000),
		);
		new PushWakeAuditLogger({ logsDir: dir }).append(entry);
		expect(readLines()).toEqual([entry]);
	});
});
