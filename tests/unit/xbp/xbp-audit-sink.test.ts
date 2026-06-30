// tests/unit/xbp/xbp-audit-sink.test.ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { XbpAuditSink } from "../../../services/xbp/xbp-audit-sink";

describe("XbpAuditSink", () => {
	it("appends one JSONL line per decision, with a timestamp, readable via entries()", () => {
		const dir = mkdtempSync(join(tmpdir(), "xbp-audit-"));
		let t = 1000;
		const sink = new XbpAuditSink({ dir, now: () => t++ });
		sink.append({
			cap: "xavier.control.session-report",
			risk: "low",
			outcome: "accepted",
		});
		sink.append({
			cap: null,
			risk: null,
			outcome: "rejected",
			reason: "bad-signature",
		});
		const lines = readFileSync(join(dir, "audit.jsonl"), "utf8")
			.trim()
			.split("\n");
		expect(lines).toHaveLength(2);
		expect(JSON.parse(lines[1]).reason).toBe("bad-signature");
		const entries = sink.entries();
		expect(entries.map((e) => e.outcome)).toEqual(["accepted", "rejected"]);
		expect(typeof entries[0].ts).toBe("number");
	});

	it("never throws when the directory is unwritable", () => {
		const sink = new XbpAuditSink({ dir: "/this/cannot/exist\0" });
		expect(() =>
			sink.append({ cap: null, risk: null, outcome: "rejected" }),
		).not.toThrow();
		expect(sink.entries()).toEqual([]);
	});
});
