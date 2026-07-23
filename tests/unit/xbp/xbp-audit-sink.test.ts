// tests/unit/xbp/xbp-audit-sink.test.ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
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

	it("is append-only: constructing over a pre-seeded log preserves every prior entry (no truncation)", () => {
		const dir = mkdtempSync(join(tmpdir(), "xbp-audit-append-"));
		const path = join(dir, "audit.jsonl");

		// Pre-seed with a large history that exceeds the OLD 5 MiB truncation
		// threshold, so a regression that re-introduces truncation would drop
		// these entries and fail the assertions below.
		const prior: string[] = [];
		for (let i = 0; i < 60_000; i++) {
			prior.push(
				JSON.stringify({
					ts: i,
					cap: "xavier.control.session-report",
					risk: "low",
					outcome: "accepted",
					reason: `seed-${i}`,
				}),
			);
		}
		writeFileSync(path, `${prior.join("\n")}\n`, "utf8");
		expect(statSync(path).size).toBeGreaterThan(5 * 1024 * 1024);

		// A fresh sink over the same dir must NOT delete or truncate the log.
		const sink = new XbpAuditSink({ dir, now: () => 999 });
		sink.append({
			cap: null,
			risk: null,
			outcome: "rejected",
			reason: "fresh",
		});

		const entries = sink.entries();
		// Every pre-seeded entry survives, in order, plus the one new append.
		expect(entries).toHaveLength(prior.length + 1);
		expect(entries[0].reason).toBe("seed-0");
		expect(entries[prior.length - 1].reason).toBe(`seed-${prior.length - 1}`);
		expect(entries[entries.length - 1].reason).toBe("fresh");
	});

	it("never throws when the directory is unwritable", () => {
		const sink = new XbpAuditSink({ dir: "/this/cannot/exist\0" });
		expect(() =>
			sink.append({ cap: null, risk: null, outcome: "rejected" }),
		).not.toThrow();
		expect(sink.entries()).toEqual([]);
	});

	it("round-trips optional event and level fields", () => {
		const dir = mkdtempSync(join(tmpdir(), "xbp-audit-"));
		const sink = new XbpAuditSink({ dir });
		sink.append({
			cap: null,
			risk: null,
			outcome: "accepted",
			level: "info",
			event: "relay-registered",
			reason: "host abc @ wss://relay.example.com",
		});
		const last = sink.entries().at(-1);
		expect(last?.event).toBe("relay-registered");
		expect(last?.level).toBe("info");
	});

	it("legacy entries without event/level still parse", () => {
		const dir = mkdtempSync(join(tmpdir(), "xbp-audit-"));
		const sink = new XbpAuditSink({ dir });
		sink.append({ cap: "pairing", risk: null, outcome: "accepted" });
		expect(sink.entries().at(-1)?.event).toBeUndefined();
	});
});
