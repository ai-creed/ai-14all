import { describe, it, expect, beforeEach } from "vitest";
import {
	mkdtempSync,
	readFileSync,
	readdirSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentAttentionLogger } from "../../../services/diagnostics/agent-attention-logger";

// Mirror the logger's local-date filename stamp. Tests must assert filenames
// in LOCAL-calendar terms (the impl rotates by local date), and computing the
// expected stamp from the injected `now` the same way the impl does keeps
// these assertions deterministic regardless of the machine's timezone.
function localStamp(d: Date): string {
	const y = d.getFullYear();
	const m = `${d.getMonth() + 1}`.padStart(2, "0");
	const day = `${d.getDate()}`.padStart(2, "0");
	return `${y}-${m}-${day}`;
}
function localFile(d: Date, roll?: number): string {
	const suffix = roll === undefined ? "" : `.${roll}`;
	return `agent-attention-${localStamp(d)}${suffix}.jsonl`;
}

describe("AgentAttentionLogger", () => {
	let tmpDir: string;
	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "agent-attn-log-"));
	});

	it("is a no-op when mode = off", async () => {
		const logger = new AgentAttentionLogger({ logsDir: tmpDir, mode: "off" });
		await logger.append({
			type: "classifier",
			ts: 1000,
			worktreeId: "wt-1",
			processId: "p1",
			provider: "claude",
			state: "failed",
			matchedPattern: "error",
			inputSample: "Error: foo",
			inputPrev: "preceding",
		});
		expect(readdirSync(tmpDir)).toHaveLength(0);
	});

	it("writes events as JSONL when mode = full", async () => {
		const logger = new AgentAttentionLogger({ logsDir: tmpDir, mode: "full" });
		await logger.append({
			type: "classifier",
			ts: 1700000000000,
			worktreeId: "wt-1",
			processId: "p1",
			provider: "claude",
			state: "failed",
			matchedPattern: "error",
			inputSample: "Error: foo",
			inputPrev: "preceding",
		});
		const files = readdirSync(tmpDir);
		expect(files).toHaveLength(1);
		const records = readFileSync(join(tmpDir, files[0]), "utf8")
			.split("\n")
			.filter((l) => l.trim().length > 0)
			.map((l) => JSON.parse(l));
		const event = records.find((r) => r.type !== "_meta");
		expect(event.type).toBe("classifier");
		expect(event.inputSample).toBe("Error: foo");
	});

	it("full mode writes a _meta header warning as the first line", async () => {
		const now = new Date("2026-05-15T10:00:00.000Z");
		const logger = new AgentAttentionLogger({
			logsDir: tmpDir,
			mode: "full",
			now: () => now,
		});
		await logger.append({
			type: "classifier",
			ts: now.getTime(),
			worktreeId: "wt-1",
			processId: "p1",
			provider: "claude",
			state: "failed",
			matchedPattern: "error",
			inputSample: "Error: foo",
			inputPrev: "preceding",
		});
		const lines = readFileSync(join(tmpDir, localFile(now)), "utf8")
			.split("\n")
			.filter((l) => l.trim().length > 0);
		const header = JSON.parse(lines[0]);
		expect(header.type).toBe("_meta");
		expect(header.warning).toMatch(/raw terminal output is being captured/);
		expect(header.ts).toBe(now.getTime());
		// The header lands in the same dated file the events go to.
		const event = JSON.parse(lines[1]);
		expect(event.type).toBe("classifier");
	});

	it("does not write a _meta header in sampled or off mode", async () => {
		const now = new Date("2026-05-15T10:00:00.000Z");
		const sampled = new AgentAttentionLogger({
			logsDir: tmpDir,
			mode: "sampled",
			now: () => now,
		});
		await sampled.append({
			type: "classifier",
			ts: now.getTime(),
			worktreeId: "wt-1",
			processId: "p1",
			provider: "claude",
			state: "failed",
			matchedPattern: "error",
			inputSample: "Error: foo",
			inputPrev: "preceding",
		});
		const sampledLines = readFileSync(join(tmpDir, localFile(now)), "utf8")
			.split("\n")
			.filter((l) => l.trim().length > 0)
			.map((l) => JSON.parse(l));
		expect(sampledLines.some((r) => r.type === "_meta")).toBe(false);

		const offDir = mkdtempSync(join(tmpdir(), "agent-attn-log-off-"));
		const off = new AgentAttentionLogger({
			logsDir: offDir,
			mode: "off",
			now: () => now,
		});
		await off.append({
			type: "classifier",
			ts: now.getTime(),
			worktreeId: "wt-1",
			processId: "p1",
			provider: "claude",
			state: "failed",
			matchedPattern: "error",
			inputSample: "Error: foo",
			inputPrev: "preceding",
		});
		expect(readdirSync(offDir)).toHaveLength(0);
	});

	it("writes a non-classifier event verbatim in full and does not redact it in sampled", async () => {
		const now = new Date("2026-05-15T10:00:00.000Z");
		const full = new AgentAttentionLogger({
			logsDir: tmpDir,
			mode: "full",
			now: () => now,
		});
		await full.append({
			type: "mcp",
			ts: now.getTime(),
			worktreeId: "wt-1",
			provider: "claude",
			state: "waiting",
			summary: "awaiting answer on caching strategy",
			task: "implement cache layer",
			nextAction: "answer question above",
		});
		const fullEvent = readFileSync(join(tmpDir, localFile(now)), "utf8")
			.split("\n")
			.filter((l) => l.trim().length > 0)
			.map((l) => JSON.parse(l))
			.find((r) => r.type === "mcp");
		expect(fullEvent.summary).toBe("awaiting answer on caching strategy");
		expect(fullEvent.task).toBe("implement cache layer");

		const sampledDir = mkdtempSync(join(tmpdir(), "agent-attn-log-s-"));
		const sampled = new AgentAttentionLogger({
			logsDir: sampledDir,
			mode: "sampled",
			now: () => now,
		});
		await sampled.append({
			type: "mcp",
			ts: now.getTime(),
			worktreeId: "wt-1",
			provider: "claude",
			state: "waiting",
			summary: "awaiting answer on caching strategy",
			task: "implement cache layer",
			nextAction: "answer question above",
		});
		const sampledEvent = JSON.parse(
			readFileSync(join(sampledDir, localFile(now)), "utf8").trim(),
		);
		// Only classifier events get redacted; mcp passes through unchanged.
		expect(sampledEvent.summary).toBe("awaiting answer on caching strategy");
		expect(sampledEvent.task).toBe("implement cache layer");
	});

	it("redacts inputSample and inputPrev when mode = sampled", async () => {
		const logger = new AgentAttentionLogger({
			logsDir: tmpDir,
			mode: "sampled",
		});
		await logger.append({
			type: "classifier",
			ts: 1700000000000,
			worktreeId: "wt-1",
			processId: "p1",
			provider: "claude",
			state: "failed",
			matchedPattern: "error",
			inputSample: "Error: foo",
			inputPrev: "preceding",
		});
		const event = JSON.parse(
			readFileSync(join(tmpDir, readdirSync(tmpDir)[0]), "utf8").trim(),
		);
		expect(event.inputSample).toMatch(/^<redacted, length=\d+>$/);
		expect(event.inputPrev).toMatch(/^<redacted, length=\d+>$/);
	});

	it("rotates files by LOCAL date when the day boundary is crossed", async () => {
		// Two instants exactly 24h apart at local noon: they are guaranteed to
		// be two distinct LOCAL calendar days in any timezone. Expected
		// filenames are derived from the injected clocks the same way the impl
		// computes them, so the assertion holds regardless of the machine TZ.
		let current = new Date(2026, 4, 15, 12, 0, 0); // local noon, May 15
		const day1 = current;
		const logger = new AgentAttentionLogger({
			logsDir: tmpDir,
			mode: "full",
			now: () => current,
		});
		await logger.append({
			type: "classifier",
			ts: current.getTime(),
			worktreeId: "wt-1",
			processId: "p1",
			provider: "claude",
			state: "failed",
			matchedPattern: "error",
			inputSample: "Error: day1",
			inputPrev: "prev1",
		});
		current = new Date(day1.getTime() + 24 * 60 * 60 * 1000); // next local day
		const day2 = current;
		await logger.append({
			type: "classifier",
			ts: current.getTime(),
			worktreeId: "wt-1",
			processId: "p1",
			provider: "claude",
			state: "failed",
			matchedPattern: "error",
			inputSample: "Error: day2",
			inputPrev: "prev2",
		});
		const files = readdirSync(tmpDir).sort();
		expect(files).toEqual([localFile(day1), localFile(day2)].sort());
	});

	it("rolls over to .N file when current file exceeds cap", async () => {
		const now = new Date("2026-05-15T10:00:00.000Z");
		const logger = new AgentAttentionLogger({
			logsDir: tmpDir,
			mode: "full",
			now: () => now,
			fileCapBytes: 200,
		});
		for (let i = 0; i < 20; i += 1) {
			await logger.append({
				type: "classifier",
				ts: now.getTime(),
				worktreeId: "wt-1",
				processId: "p1",
				provider: "claude",
				state: "failed",
				matchedPattern: "error",
				inputSample: `Error: iteration ${i}`,
				inputPrev: `prev ${i}`,
			});
		}
		const files = readdirSync(tmpDir).sort();
		// The active base file is always present...
		expect(files).toContain(localFile(now));
		// ...and rollover produced at least one `.N` sibling. (The exact index
		// is not asserted: the total-size backstop legitimately evicts the
		// OLDEST `.N` chunks first, so a low index like `.1` may already be
		// gone — what matters is that rollover-to-`.N` happened.)
		const stamp = localFile(now).replace(".jsonl", "");
		const rolled = files.filter((f) =>
			new RegExp(`^${stamp}\\.\\d+\\.jsonl$`).test(f),
		);
		expect(rolled.length).toBeGreaterThanOrEqual(1);
	});

	it("prunes files older than 7 LOCAL days on init", async () => {
		// Anchor `now` to a fixed LOCAL noon so the local-date prune cutoff is
		// deterministic in any timezone. Seeded filenames are derived as
		// local-day offsets from that anchor (each step = 24h back, taken at
		// local noon so DST shifts can't flip the calendar day).
		const now = new Date(2026, 4, 15, 12, 0, 0); // local noon, May 15
		const dayFile = (daysAgo: number, roll?: number): string =>
			localFile(
				new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000),
				roll,
			);
		const seeded: { name: string; daysAgo: number }[] = [
			{ name: dayFile(14), daysAgo: 14 },
			{ name: dayFile(11), daysAgo: 11 },
			{ name: dayFile(9), daysAgo: 9 },
			{ name: dayFile(8), daysAgo: 8 },
			{ name: dayFile(7), daysAgo: 7 },
			{ name: dayFile(6), daysAgo: 6 },
			{ name: dayFile(5), daysAgo: 5 },
			{ name: dayFile(3), daysAgo: 3 },
			{ name: dayFile(1), daysAgo: 1 },
			{ name: dayFile(0), daysAgo: 0 },
			{ name: dayFile(1, 1), daysAgo: 1 },
		];
		for (const f of seeded) {
			writeFileSync(join(tmpDir, f.name), "{}\n", "utf8");
		}
		// Unrelated files must not be touched.
		writeFileSync(join(tmpDir, "other.log"), "x", "utf8");

		new AgentAttentionLogger({
			logsDir: tmpDir,
			mode: "full",
			now: () => now,
		});

		const remaining = new Set(readdirSync(tmpDir));
		// Older than 7 days (strictly) are deleted.
		expect(remaining.has(dayFile(14))).toBe(false);
		expect(remaining.has(dayFile(11))).toBe(false);
		expect(remaining.has(dayFile(9))).toBe(false);
		expect(remaining.has(dayFile(8))).toBe(false);
		// Within 7 days are kept.
		expect(remaining.has(dayFile(7))).toBe(true);
		expect(remaining.has(dayFile(6))).toBe(true);
		expect(remaining.has(dayFile(5))).toBe(true);
		expect(remaining.has(dayFile(3))).toBe(true);
		expect(remaining.has(dayFile(1))).toBe(true);
		expect(remaining.has(dayFile(0))).toBe(true);
		expect(remaining.has(dayFile(1, 1))).toBe(true);
		// Unrelated file untouched.
		expect(remaining.has("other.log")).toBe(true);
	});

	it("enforces a hard total-size budget, evicting oldest chunks first", async () => {
		const now = new Date(2026, 4, 15, 12, 0, 0); // local noon, May 15
		const fileCapBytes = 256;
		// Budget = 7 * fileCapBytes (MAX_TOTAL_BYTES_FACTOR), matching the
		// spec's ~70 MB worst case scaled down to a testable size.
		const maxTotalBytes = 7 * fileCapBytes;
		const logger = new AgentAttentionLogger({
			logsDir: tmpDir,
			mode: "full",
			now: () => now,
			fileCapBytes,
		});

		// Write enough events to force many same-day rollovers, far exceeding
		// the total budget. The LAST marker is the freshest event written.
		for (let i = 0; i < 400; i += 1) {
			await logger.append({
				type: "classifier",
				ts: now.getTime(),
				worktreeId: "wt-1",
				processId: "p1",
				provider: "claude",
				state: "failed",
				matchedPattern: "error",
				inputSample: `MARKER-${i} ${"x".repeat(40)}`,
				inputPrev: `prev ${i}`,
			});
		}

		const files = readdirSync(tmpDir).filter((f) =>
			f.startsWith("agent-attention-"),
		);
		const total = files.reduce(
			(sum, f) => sum + statSync(join(tmpDir, f)).size,
			0,
		);
		// Hard bound holds (allow the in-progress base file headroom: the
		// budget is enforced on rollover, before the next chunk fills).
		expect(total).toBeLessThanOrEqual(maxTotalBytes + fileCapBytes);

		// Newest events preserved: the base file (freshest) still holds a
		// recently-written marker near the end of the run.
		const basePath = join(tmpDir, localFile(now));
		const baseContent = readFileSync(basePath, "utf8");
		expect(baseContent).toContain("MARKER-399");

		// Oldest chunks evicted: MARKER-0 (written first, in the oldest
		// rolled-out chunk) is gone from every surviving file.
		const allContent = files
			.map((f) => readFileSync(join(tmpDir, f), "utf8"))
			.join("\n");
		expect(allContent).not.toContain("MARKER-0 ");
	});
});
