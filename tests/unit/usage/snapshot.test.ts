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
			range: "week",
			activeWorktreeIds: ["w1"],
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
			range: "week",
			activeWorktreeIds: ["w1"],
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
});

// Blended-pricing stub: claude is priced at its exact rate; all other providers
// get a zero rate (so their tokens are priced at $0, not left "unpriced").
const stubRate = (p: string) =>
	p === "claude"
		? { inputPerM: 15, outputPerM: 75, cacheReadPerM: 1.5 }
		: { inputPerM: 0, outputPerM: 0, cacheReadPerM: 0 };

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
		// cost: claude priced at stub rate; ezio tokens are zero-input so cost = $0
		// blended pricing always resolves a rate, so unpricedTokens is always 0
		expect(snap.cost?.perProvider.claude).toBeCloseTo(15, 6);
		expect(snap.cost?.perProvider.ezio).toBe(0); // zero-rate stub → $0, not unpriced
		expect(snap.cost?.unpricedTokens).toBe(0);
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

	it("scopes snapshot cost to this sitting: pre-launch backfilled events are NOT priced", () => {
		const now = 1000 * HOUR;
		const agg = new UsageAggregator(now); // launchMs = now
		// Pre-launch event replayed by the 35-day startup backfill — priced model,
		// but timestamped BEFORE launch. Must NOT contribute to CostSnapshot.
		agg.ingest({
			provider: "claude",
			timestampMs: now - 5 * HOUR,
			cwd: "/Users/me/Dev/app",
			sessionId: "s",
			model: "claude-opus-4",
			input: 1_000_000,
			output: 0,
			billable: 1_000_000,
			raw: 1_000_000,
		});
		// Post-launch "this sitting" event — same priced model.
		agg.ingest({
			provider: "claude",
			timestampMs: now + HOUR,
			cwd: "/Users/me/Dev/app",
			sessionId: "s",
			model: "claude-opus-4",
			input: 100_000,
			output: 0,
			billable: 100_000,
			raw: 100_000,
		});
		const snap = buildSnapshot({
			agg,
			known,
			nowMs: now + HOUR,
			includeUntracked: true,
			range: "week",
			activeWorktreeIds: ["w1"],
			rate: stubRate,
		});
		// Only the post-launch 100k input tokens are priced (stubRate $15/M) => $1.50.
		// The pre-launch 1M tokens ($15) are excluded — CostSnapshot is "this sitting",
		// not the backfilled history. (Lifetime/all-history is deferred to Slice 2.)
		expect(snap.cost?.perProvider.claude).toBeCloseTo(1.5, 6);
		expect(snap.cost?.total).toBeCloseTo(1.5, 6);
		// ...but the range-scoped daily series (the chart) still includes BOTH events.
		const seriesClaude = (snap.series ?? []).reduce(
			(s, p) => s + (p.tokens.claude ?? 0),
			0,
		);
		expect(seriesClaude).toBe(1_100_000);
	});
});
