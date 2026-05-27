import { describe, expect, it } from "vitest";
import { UsageAggregator } from "../../../services/usage/aggregator.js";
import { buildSnapshot } from "../../../services/usage/snapshot.js";
import type { KnownWorktree } from "../../../shared/models/usage.js";

const HOUR = 3_600_000;
const known: KnownWorktree[] = [
	{
		worktreeId: "w1",
		workspaceId: "ws1",
		title: "main",
		path: "/Users/me/Dev/app",
	},
];

describe("buildSnapshot", () => {
	it("maps cwds to worktrees, buckets untracked, and totals respect the toggle", () => {
		const now = 1000 * HOUR;
		const agg = new UsageAggregator(now - 10 * HOUR);
		agg.ingest({
			provider: "codex",
			timestampMs: now,
			cwd: "/Users/me/Dev/app",
			sessionId: "s",
			model: "m",
			input: 5,
			output: 2,
			billable: 7,
			raw: 70,
		});
		agg.ingest({
			provider: "claude",
			timestampMs: now,
			cwd: "/Users/me/Dev/other",
			sessionId: "s",
			model: "m",
			input: 2,
			output: 1,
			billable: 3,
			raw: 30,
		});

		const onlyTracked = buildSnapshot({
			agg,
			known,
			nowMs: now,
			includeUntracked: false,
			claudeTier: "default_claude_max_5x",
			fiveHourBudget: 1_500_000,
			weeklyBudget: 9_000_000,
			activeWorktreeIds: ["w1"],
			weeklyResetDay: 1,
			weeklyResetHour: 7,
		});
		expect(onlyTracked.totals).toEqual({
			input: 5,
			output: 2,
			billable: 7,
			raw: 70,
		});
		expect(onlyTracked.rows.some((r) => r.workspaceId === null)).toBe(false);
		expect(
			onlyTracked.rows.find(
				(r) => r.worktreeId === "w1" && r.provider === "codex",
			)?.active,
		).toBe(true);

		const all = buildSnapshot({
			agg,
			known,
			nowMs: now,
			includeUntracked: true,
			claudeTier: "default_claude_max_5x",
			fiveHourBudget: 1_500_000,
			weeklyBudget: 9_000_000,
			activeWorktreeIds: ["w1"],
			weeklyResetDay: 1,
			weeklyResetHour: 7,
		});
		expect(all.totals).toEqual({
			input: 7,
			output: 3,
			billable: 10,
			raw: 100,
		});
		expect(all.rows.find((r) => r.workspaceId === null)?.worktreeTitle).toBe(
			"other (untracked)",
		);
	});
	it("emits codex real limit gauge and claude budget gauge", () => {
		const now = 1000 * HOUR;
		const agg = new UsageAggregator(now);
		agg.setCodexLimits({
			capturedAtMs: now,
			planType: "plus",
			primary: { usedPercent: 3, windowMinutes: 300, resetsAtMs: now + HOUR },
			secondary: {
				usedPercent: 41,
				windowMinutes: 10080,
				resetsAtMs: now + 100 * HOUR,
			},
		});
		agg.ingest({
			provider: "claude",
			timestampMs: now,
			cwd: "/x",
			sessionId: "s",
			model: "m",
			input: 2_000_000,
			output: 500_000,
			billable: 2_500_000,
			raw: 2_500_000,
		});
		const snap = buildSnapshot({
			agg,
			known,
			nowMs: now,
			includeUntracked: true,
			claudeTier: "default_claude_max_5x",
			fiveHourBudget: 1_500_000,
			weeklyBudget: 9_000_000,
			activeWorktreeIds: ["w1"],
			weeklyResetDay: 1,
			weeklyResetHour: 7,
		});
		const codex = snap.limits.find((l) => l.provider === "codex")!;
		expect(codex.real).toBe(true);
		expect(codex.weekly.percent).toBe(41);
		const claude = snap.limits.find((l) => l.provider === "claude")!;
		expect(claude.real).toBe(false);
		expect(claude.weekly.percent).toBe(28); // 2.5M / 9M
	});
});
