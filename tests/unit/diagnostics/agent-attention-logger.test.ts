import { describe, it, expect, beforeEach } from "vitest";
import {
	mkdtempSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentAttentionLogger } from "../../../services/diagnostics/agent-attention-logger";

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
		const lines = readFileSync(
			join(tmpDir, "agent-attention-2026-05-15.jsonl"),
			"utf8",
		)
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
		const sampledLines = readFileSync(
			join(tmpDir, "agent-attention-2026-05-15.jsonl"),
			"utf8",
		)
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
		const fullEvent = readFileSync(
			join(tmpDir, "agent-attention-2026-05-15.jsonl"),
			"utf8",
		)
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
			readFileSync(
				join(sampledDir, "agent-attention-2026-05-15.jsonl"),
				"utf8",
			).trim(),
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

	it("rotates files when daily rotation threshold crosses date boundary", async () => {
		let current = new Date("2026-05-15T10:00:00.000Z");
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
		current = new Date("2026-05-16T09:00:00.000Z");
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
		expect(files).toEqual([
			"agent-attention-2026-05-15.jsonl",
			"agent-attention-2026-05-16.jsonl",
		]);
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
		expect(files).toContain("agent-attention-2026-05-15.jsonl");
		expect(files).toContain("agent-attention-2026-05-15.1.jsonl");
	});

	it("prunes files older than 7 days on init", async () => {
		const now = new Date("2026-05-15T10:00:00.000Z");
		// Seed dates spanning >7 days old to recent.
		const seeded: { name: string; daysAgo: number }[] = [
			{ name: "agent-attention-2026-05-01.jsonl", daysAgo: 14 },
			{ name: "agent-attention-2026-05-04.jsonl", daysAgo: 11 },
			{ name: "agent-attention-2026-05-06.jsonl", daysAgo: 9 },
			{ name: "agent-attention-2026-05-07.jsonl", daysAgo: 8 },
			{ name: "agent-attention-2026-05-08.jsonl", daysAgo: 7 },
			{ name: "agent-attention-2026-05-09.jsonl", daysAgo: 6 },
			{ name: "agent-attention-2026-05-10.jsonl", daysAgo: 5 },
			{ name: "agent-attention-2026-05-12.jsonl", daysAgo: 3 },
			{ name: "agent-attention-2026-05-14.jsonl", daysAgo: 1 },
			{ name: "agent-attention-2026-05-15.jsonl", daysAgo: 0 },
			{ name: "agent-attention-2026-05-14.1.jsonl", daysAgo: 1 },
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
		expect(remaining.has("agent-attention-2026-05-01.jsonl")).toBe(false);
		expect(remaining.has("agent-attention-2026-05-04.jsonl")).toBe(false);
		expect(remaining.has("agent-attention-2026-05-06.jsonl")).toBe(false);
		expect(remaining.has("agent-attention-2026-05-07.jsonl")).toBe(false);
		// Within 7 days are kept.
		expect(remaining.has("agent-attention-2026-05-08.jsonl")).toBe(true);
		expect(remaining.has("agent-attention-2026-05-09.jsonl")).toBe(true);
		expect(remaining.has("agent-attention-2026-05-10.jsonl")).toBe(true);
		expect(remaining.has("agent-attention-2026-05-12.jsonl")).toBe(true);
		expect(remaining.has("agent-attention-2026-05-14.jsonl")).toBe(true);
		expect(remaining.has("agent-attention-2026-05-15.jsonl")).toBe(true);
		expect(remaining.has("agent-attention-2026-05-14.1.jsonl")).toBe(true);
		// Unrelated file untouched.
		expect(remaining.has("other.log")).toBe(true);
	});
});
