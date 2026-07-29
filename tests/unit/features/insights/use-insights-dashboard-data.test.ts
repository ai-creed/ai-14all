// AC5 regression: for the `today` range, the workspace table + cost/token
// tile must derive from a SEPARATE, narrower usage.queryRange(tileWindow)
// probe — not the 7-day domain probe the chart uses. Exercises the hook
// directly (renderHook), stubbing window.ai14all so the two queryRange calls
// (domain-window vs tile-window) can be told apart by their requested span
// and return distinct, deliberately-mismatched data.
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useInsightsDashboardData } from "../../../../src/features/insights/useInsightsDashboardData.js";
import type { UsageRangeQuery } from "../../../../shared/models/usage.js";

interface StubApi {
	insights: {
		coverageAnchors: ReturnType<typeof vi.fn>;
		queryAppTimeSeries: ReturnType<typeof vi.fn>;
		query: ReturnType<typeof vi.fn>;
	};
	usage: { queryRange: ReturnType<typeof vi.fn> };
}

const ONE_DAY_MS = 86_400_000;

// Domain probe (7-day window, feeds the chart) vs tile probe (today's
// window, feeds the tile/table) are told apart by requested span: the tile
// window is exactly one day; the domain window is much wider than that.
function isTileWindow(query: UsageRangeQuery): boolean {
	return query.toMs - query.fromMs <= 2 * ONE_DAY_MS;
}

function stubApi() {
	const now = Date.now();
	const since = now - 3 * ONE_DAY_MS;
	(window as unknown as { ai14all: unknown }).ai14all = {
		insights: {
			coverageAnchors: vi.fn().mockResolvedValue({
				ok: true,
				data: {
					firstCaptureAt: since,
					appRetainedSinceMs: since,
					runsRetainedSinceMs: since,
				},
			}),
			queryAppTimeSeries: vi
				.fn()
				.mockImplementation(async (edges: number[]) => ({
					ok: true,
					data: {
						buckets: edges.slice(0, -1).map((startMs: number) => ({
							startMs,
							focusedMs: 0,
							engagedMs: 0,
						})),
						completeness: "complete",
					},
				})),
			query: vi.fn().mockResolvedValue({
				ok: true,
				data: { runs: [], completeness: "complete" },
			}),
		},
		usage: {
			queryRange: vi.fn().mockImplementation(async (query: UsageRangeQuery) => {
				if (isTileWindow(query)) {
					return {
						ok: true,
						days: [{ dayStartMs: query.fromMs, tokens: { claude: 999_888 } }],
						byWorkspace: [
							{
								workspaceId: "ws-tile",
								worktreeId: null,
								worktreePath: null,
								worktreeTitle: "tile-window row",
								provider: "claude",
								active: false,
								tokens: {
									input: 0,
									output: 0,
									billable: 999_888,
									raw: 999_888,
								},
								costUsd: 0.42,
							},
						],
						byProvider: [],
						cost: {
							perProvider: { claude: 0.42 },
							total: 0.42,
							currency: "USD",
							notional: true,
							unpricedTokens: 0,
						},
						earliestDayMs: query.fromMs,
					};
				}
				// Domain-window (7-day) probe: seven distinct daily values, summing
				// to 2_800 — nowhere near the tile-window's 999_888, so any test
				// value that ends up matching THIS response's totals proves the bug
				// (7-day data leaking into the tile/table) is back.
				const days = Array.from({ length: 7 }, (_, i) => ({
					dayStartMs: query.fromMs + i * ONE_DAY_MS,
					tokens: { claude: (i + 1) * 100 },
				}));
				return {
					ok: true,
					days,
					byWorkspace: [
						{
							workspaceId: "ws-domain",
							worktreeId: null,
							worktreePath: null,
							worktreeTitle: "domain-window row",
							provider: "claude",
							active: false,
							tokens: { input: 0, output: 0, billable: 2_800, raw: 2_800 },
							costUsd: 12.34,
						},
					],
					byProvider: [],
					cost: {
						perProvider: { claude: 12.34 },
						total: 12.34,
						currency: "USD",
						notional: true,
						unpricedTokens: 0,
					},
					earliestDayMs: since,
				};
			}),
		},
	} satisfies StubApi;
}

describe("useInsightsDashboardData — today range tile/table windowing (AC5)", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.useFakeTimers({ shouldAdvanceTime: true });
		// Pinned away from any DST boundary so day-width arithmetic (the
		// isTileWindow probe-span check above) stays exactly 24h.
		vi.setSystemTime(new Date("2026-07-29T12:00:00"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("tile tokens/cost and ws-totals derive from the tile-window response; the chart keeps the 7-day domain response", async () => {
		stubApi();
		const { result } = renderHook(() => useInsightsDashboardData([]));
		await waitFor(() => expect(result.current.status).toBe("live"));

		act(() => {
			result.current.setRange("today");
		});
		await waitFor(() => expect(result.current.range).toBe("today"));
		await waitFor(() =>
			expect(result.current.workspaceRows.totals.tokens).toBe(999_888),
		);

		// Tile figures: from the tile-window (today) response.
		expect(result.current.tiles.tokens).toBe(999_888);
		expect(result.current.tiles.costUsd).toBe(0.42);

		// Workspace table totals: same tile-window response, so table == tiles
		// by construction (AC5).
		expect(result.current.workspaceRows.totals.tokens).toBe(999_888);
		expect(result.current.workspaceRows.totals.costUsd).toBe(0.42);
		expect(
			result.current.workspaceRows.rows.some((r) => r.key === "ws-tile"),
		).toBe(true);
		expect(
			result.current.workspaceRows.rows.some((r) => r.key === "ws-domain"),
		).toBe(false);

		// The chart's own data source (`usage`) stays the 7-day DOMAIN response,
		// untouched by the tile probe: 7 daily columns, domain totals.
		expect(result.current.domain?.edges.length).toBe(8); // 7 columns
		expect(result.current.usage?.days).toHaveLength(7);
		expect(
			result.current.usage?.byWorkspace.some(
				(r) => r.workspaceId === "ws-domain",
			),
		).toBe(true);
	});
});

// AC3 regression: `all` must never probe usage.queryRange with an unbounded
// (epoch-to-now) window — the host (usage-host.ts) rejects any span over
// 10*366 days as a caller-bug "timeout", and epoch-to-now always exceeds
// that, so selecting `all` with telemetry enabled always rendered the error
// state. The fix: `all`'s step-1 probe is the SAME small, recent window
// today/7d already use (purely to fetch the window-independent
// `earliestDayMs`); its real, potentially-months-back domain window is
// queried SEPARATELY, once known. Distinguishes the two calls by requested
// span (the recent probe is ~7 days; the real domain window here is set up
// to span 40+ days back, so a >10-day threshold cleanly tells them apart)
// and returns deliberately mismatched data, so a leak either direction (the
// bug returning, or a regression routing the wrong response to the wrong
// consumer) shows up as a wrong number rather than silently passing.
describe("useInsightsDashboardData — `all` range: bounded domain probe (AC3)", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.useFakeTimers({ shouldAdvanceTime: true });
		vi.setSystemTime(new Date("2026-07-29T12:00:00"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("never probes from epoch or with an absurd span; chart/tiles/table all derive from the domain-window response", async () => {
		const now = Date.now();
		const EARLIEST_MS = now - 40 * ONE_DAY_MS; // >6 weeks back: a REAL all-range domain, well past the 7-day probe.
		const TEN_YEARS_MS = 10 * 366 * ONE_DAY_MS;
		const calls: UsageRangeQuery[] = [];

		(window as unknown as { ai14all: unknown }).ai14all = {
			insights: {
				coverageAnchors: vi.fn().mockResolvedValue({
					ok: true,
					data: {
						firstCaptureAt: EARLIEST_MS,
						appRetainedSinceMs: EARLIEST_MS,
						runsRetainedSinceMs: EARLIEST_MS,
					},
				}),
				queryAppTimeSeries: vi
					.fn()
					.mockImplementation(async (edges: number[]) => ({
						ok: true,
						data: {
							buckets: edges.slice(0, -1).map((startMs: number) => ({
								startMs,
								focusedMs: 0,
								engagedMs: 0,
							})),
							completeness: "complete",
						},
					})),
				query: vi.fn().mockResolvedValue({
					ok: true,
					data: { runs: [], completeness: "complete" },
				}),
			},
			usage: {
				queryRange: vi
					.fn()
					.mockImplementation(async (query: UsageRangeQuery) => {
						calls.push(query);
						const span = query.toMs - query.fromMs;
						if (span > 10 * ONE_DAY_MS) {
							// The real `all` domain-window query: many weeks back.
							return {
								ok: true,
								days: [
									{ dayStartMs: query.fromMs, tokens: { claude: 12_000_000 } },
								],
								byWorkspace: [
									{
										workspaceId: "ws-all",
										worktreeId: null,
										worktreePath: null,
										worktreeTitle: "all-time row",
										provider: "claude",
										active: false,
										tokens: {
											input: 0,
											output: 0,
											billable: 12_000_000,
											raw: 12_000_000,
										},
										costUsd: 45.6,
									},
								],
								byProvider: [],
								cost: {
									perProvider: { claude: 45.6 },
									total: 45.6,
									currency: "USD",
									notional: true,
									unpricedTokens: 0,
								},
								earliestDayMs: EARLIEST_MS,
							};
						}
						// The cheap step-1 recent probe (~7 days) — must NEVER feed
						// tiles/table/chart for `all`; distinct, smaller numbers so any
						// leak is obvious.
						return {
							ok: true,
							days: [{ dayStartMs: query.fromMs, tokens: { claude: 111 } }],
							byWorkspace: [
								{
									workspaceId: "ws-recent-probe",
									worktreeId: null,
									worktreePath: null,
									worktreeTitle: "recent-probe row",
									provider: "claude",
									active: false,
									tokens: { input: 0, output: 0, billable: 111, raw: 111 },
									costUsd: 0.01,
								},
							],
							byProvider: [],
							cost: {
								perProvider: { claude: 0.01 },
								total: 0.01,
								currency: "USD",
								notional: true,
								unpricedTokens: 0,
							},
							earliestDayMs: EARLIEST_MS,
						};
					}),
			},
		} satisfies StubApi;

		const { result } = renderHook(() => useInsightsDashboardData([]));
		await waitFor(() => expect(result.current.status).toBe("live"));

		act(() => {
			result.current.setRange("all");
		});
		await waitFor(() => expect(result.current.range).toBe("all"));
		await waitFor(() =>
			expect(result.current.workspaceRows.totals.tokens).toBe(12_000_000),
		);

		// (c) no error state — the whole point of the fix.
		expect(result.current.status).toBe("live");

		// (a) no call, ever (mount's `7d` fetch included), probed from epoch or
		// with a span the host's degenerate-range guard would reject.
		expect(calls.length).toBeGreaterThan(0);
		for (const c of calls) {
			expect(c.fromMs).not.toBe(0);
			expect(c.toMs - c.fromMs).toBeLessThanOrEqual(TEN_YEARS_MS);
		}

		// (b) tiles/table derive from the domain-window response, not the
		// recent probe.
		expect(result.current.tiles.tokens).toBe(12_000_000);
		expect(result.current.tiles.costUsd).toBe(45.6);
		expect(result.current.workspaceRows.totals.tokens).toBe(12_000_000);
		expect(result.current.workspaceRows.totals.costUsd).toBe(45.6);
		expect(
			result.current.workspaceRows.rows.some((r) => r.key === "ws-all"),
		).toBe(true);
		expect(
			result.current.workspaceRows.rows.some(
				(r) => r.key === "ws-recent-probe",
			),
		).toBe(false);

		// (b) the token chart's own data source (`usage`) ALSO derives from the
		// domain-window response, not the recent probe.
		expect(
			result.current.usage?.byWorkspace.some((r) => r.workspaceId === "ws-all"),
		).toBe(true);
		expect(
			result.current.usage?.byWorkspace.some(
				(r) => r.workspaceId === "ws-recent-probe",
			),
		).toBe(false);
		expect(
			result.current.usage?.days.some((d) => d.tokens.claude === 111),
		).toBe(false);
	});
});
