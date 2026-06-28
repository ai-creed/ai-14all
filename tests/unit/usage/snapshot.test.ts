import { describe, expect, it } from "vitest";
import { UsageAggregator } from "../../../services/usage/aggregator.js";
import { buildSnapshot } from "../../../services/usage/snapshot.js";
import type { KnownWorktree } from "../../../shared/models/usage.js";
import { TELEMETRY_DRIVERS } from "../../../services/usage/providers/index.js";

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
		// Untracked rows are always emitted (client filters); totals still exclude them.
		expect(onlyTracked.rows.some((r) => r.workspaceId === null)).toBe(true);
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

const stubRate = (_p: string, model: string) =>
	model === "claude-opus-4"
		? { inputPerM: 15, outputPerM: 75, cacheReadPerM: 1.5 }
		: null;

describe("buildSnapshot analytics surface", () => {
	it("emits providers[], series[], cost, and codexLimits", () => {
		const now = 1000 * HOUR;
		const agg = new UsageAggregator(now - HOUR);
		agg.ingest({
			provider: "claude",
			timestampMs: now,
			cwd: "/Users/me/Dev/app",
			sessionId: "s",
			model: "claude-opus-4",
			input: 1_000_000,
			output: 0,
			billable: 1_000_000,
			raw: 1_000_000,
		});
		agg.ingest({
			provider: "ezio",
			timestampMs: now,
			cwd: "/Users/me/Dev/app",
			sessionId: "s",
			model: "mystery-model", // unpriced
			input: 0,
			output: 0,
			billable: 5000,
			raw: 5000,
		});
		agg.setProviderLimits("codex", {
			capturedAtMs: now,
			planType: "plus",
			primary: { usedPercent: 41, windowMinutes: 300, resetsAtMs: now + HOUR },
			secondary: { usedPercent: 23, windowMinutes: 10080, resetsAtMs: now + 100 * HOUR },
		});

		const snap = buildSnapshot({
			agg,
			known,
			nowMs: now,
			includeUntracked: true,
			range: "week",
			activeWorktreeIds: ["w1"],
			rate: stubRate,
		});

		// providers list reflects all five drivers; only those with data flagged
		expect(snap.providers?.map((p) => p.id)).toEqual(
			TELEMETRY_DRIVERS.map((d) => d.id),
		);
		expect(snap.providers?.find((p) => p.id === "claude")?.hasData).toBe(true);
		const cursor = snap.providers?.find((p) => p.id === "cursor");
		expect(cursor?.hasData).toBe(false);
		expect(cursor?.capabilities.timeSource).toBe("none");
		// daily series present and keyed by provider
		expect((snap.series?.length ?? 0)).toBeGreaterThan(0);
		// cost: claude priced, ezio's unknown model excluded into unpricedTokens
		expect(snap.cost?.perProvider.claude).toBeCloseTo(15, 6);
		expect(snap.cost?.perProvider.ezio).toBeUndefined();
		expect(snap.cost?.unpricedTokens).toBe(5000);
		// native codex gauge present
		expect(snap.codexLimits?.fiveHour.percent).toBe(41);
		expect(snap.codexLimits?.weekly.percent).toBe(23);
	});

	it("always emits untracked rows; config.includeUntracked carries the effective setting", () => {
		const now = 1000 * HOUR;
		const agg = new UsageAggregator(now - HOUR);
		// cwd does NOT match any known worktree => untracked.
		agg.ingest({
			provider: "claude",
			timestampMs: now,
			cwd: "/nowhere/unknown",
			sessionId: "s",
			model: "claude-opus-4",
			input: 10,
			output: 0,
			billable: 10,
			raw: 10,
		});
		const base = { agg, known, nowMs: now, range: "week" as const, activeWorktreeIds: [], rate: stubRate };

		const off = buildSnapshot({ ...base, includeUntracked: false });
		// Untracked rows are emitted regardless of the setting (client filters them).
		expect(off.rows.some((r) => r.workspaceId === null)).toBe(true);
		// Config reflects the SETTING, not a hardcoded value.
		expect(off.config.includeUntracked).toBe(false);

		const on = buildSnapshot({ ...base, includeUntracked: true });
		expect(on.rows.some((r) => r.workspaceId === null)).toBe(true);
		expect(on.config.includeUntracked).toBe(true);
	});
});
