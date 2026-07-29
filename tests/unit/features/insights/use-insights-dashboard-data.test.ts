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
// (epoch-to-now, `fromMs: 0`) window — the hook has no business ever
// constructing one, regardless of whether anything downstream would reject
// it (the host USED to reject wide spans outright; a worker-side day-walk
// clamp briefly replaced that rejection; both were removed entirely — see
// usage-host.ts and services/usage/range.ts, which now emits `days`
// SPARSELY, one point per ledger day with data, with no span-size limit
// anywhere — because §4.7/AC3 require `all` to start at the real
// min(earliestDayMs, anchors) with NO exception, however deep the ledger
// goes). The fix: `all`'s step-1 probe is the SAME small,
// recent window today/7d already use (purely to fetch the window-independent
// `earliestDayMs`); its real, potentially-years-back domain window is
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

		// (a) no call, ever (mount's `7d` fetch included), probed from epoch —
		// the hook itself must never construct one, independent of whatever
		// span the host would or wouldn't accept (there is no span cap
		// anymore; see the module comment above).
		expect(calls.length).toBeGreaterThan(0);
		for (const c of calls) {
			expect(c.fromMs).not.toBe(0);
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

	// §4.7/AC3/AC5, no exception: `all` must start at the real
	// min(earliestDayMs, anchors), however deep the ledger goes — there is no
	// span cap and no day-count clamp anywhere in this path anymore (both were
	// tried and removed as misplaced policy; services/usage/range.ts now
	// emits `days` sparsely instead, with no depth limit). 30 years is
	// deliberately past the old, now-removed ~27-year walk clamp, so this
	// also stands as the hook-layer half of the reviewer's round-4 demand:
	// the tokens TILE and the workspace TABLE must still agree exactly (AC5)
	// at this depth, not just each individually be "live".
	it("a 30-year-deep ledger (past the old, now-removed clamp): `all` queries the FULL domain window; status live; tokens tile === workspace table exactly", async () => {
		const now = Date.now();
		const THIRTY_YEARS_MS = 30 * 366 * ONE_DAY_MS;
		const EARLIEST_MS = now - THIRTY_YEARS_MS;
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
						if (span > 365 * ONE_DAY_MS) {
							// The real, ~30-year `all` domain-window query.
							return {
								ok: true,
								days: [
									{ dayStartMs: query.fromMs, tokens: { claude: 3_000_000 } },
								],
								byWorkspace: [
									{
										workspaceId: "ws-longledger",
										worktreeId: null,
										worktreePath: null,
										worktreeTitle: "30-year row",
										provider: "claude",
										active: false,
										tokens: {
											input: 0,
											output: 0,
											billable: 3_000_000,
											raw: 3_000_000,
										},
										costUsd: 9.99,
									},
								],
								byProvider: [],
								cost: {
									perProvider: { claude: 9.99 },
									total: 9.99,
									currency: "USD",
									notional: true,
									unpricedTokens: 0,
								},
								earliestDayMs: EARLIEST_MS,
							};
						}
						// The cheap step-1 recent probe (~7 days) — a small, distinct
						// response so a leak into tiles/table/chart would be obvious.
						return {
							ok: true,
							days: [{ dayStartMs: query.fromMs, tokens: { claude: 1 } }],
							byWorkspace: [],
							byProvider: [],
							cost: {
								perProvider: {},
								total: 0,
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
			expect(result.current.workspaceRows.totals.tokens).toBe(3_000_000),
		);

		// Status live — the whole point: a 30-year-deep ledger must NOT error.
		expect(result.current.status).toBe("live");

		// The domain-window query genuinely spans ~30 years — well past the
		// old, now-removed ~27-year clamp — and nothing truncated or rejected
		// it.
		const wideCalls = calls.filter((c) => c.toMs - c.fromMs > 365 * ONE_DAY_MS);
		expect(wideCalls.length).toBeGreaterThan(0);
		for (const c of wideCalls) {
			expect(c.toMs - c.fromMs).toBeGreaterThan(25 * 365 * ONE_DAY_MS);
			expect(c.fromMs).not.toBe(0);
		}

		// chart/tiles/table all derive from the (wide) domain response.
		expect(result.current.tiles.tokens).toBe(3_000_000);
		expect(result.current.tiles.costUsd).toBe(9.99);
		expect(result.current.workspaceRows.totals.tokens).toBe(3_000_000);
		expect(
			result.current.usage?.byWorkspace.some(
				(r) => r.workspaceId === "ws-longledger",
			),
		).toBe(true);

		// AC5, explicitly: the tokens TILE and the workspace TABLE must agree
		// EXACTLY at this depth — not merely each independently match the
		// mocked response, but be structurally equal to each other, which is
		// what AC5 actually requires.
		expect(result.current.tiles.tokens).toBe(
			result.current.workspaceRows.totals.tokens,
		);
		expect(result.current.tiles.costUsd).toBe(
			result.current.workspaceRows.totals.costUsd,
		);
	});

	// Round-6 boundary regression: the TOKEN ledger can run far deeper than
	// app-time ever could (app-time physically cannot predate
	// OBSERVATION_RETENTION_DAYS = 365, bucketEdges.ts) — a `queryAppTimeSeries`
	// call over the FULL `all` domain would eventually trip the host's
	// 2..9001 bucket-edges cap (spec §4.3) for a deep-enough TOKEN history,
	// converting genuine token history into the error state for a reason
	// that has nothing to do with app-time. `seriesEdgesFor` (bucketEdges.ts)
	// clamps the series request to the retention floor instead. This mock's
	// `queryAppTimeSeries` enforces the SAME 2..9001 bound the real host does
	// (electron/main/services/insights-host.ts's isValidBucketEdges), so this
	// test genuinely exercises the failure mode: it fails with the fix
	// reverted (a >9001-edge series request gets `bad-request` back, which
	// the hook turns into the error state) and passes with it applied.
	it("a ~174-year-deep token ledger: queryAppTimeSeries never exceeds the host's 9,001-edge cap; status live; token chart/tiles/table from the FULL-domain usage response", async () => {
		const now = Date.now();
		const ONE_HUNDRED_SEVENTY_FOUR_YEARS_MS = 174 * 365 * ONE_DAY_MS;
		const DEEP_EARLIEST_MS = now - ONE_HUNDRED_SEVENTY_FOUR_YEARS_MS;
		// App-time/runs anchors stay REALISTIC (recent, within the 365-day
		// floor) — only the TOKEN ledger (earliestDayMs, from the usage probe)
		// runs impossibly deep. domainForRange takes min(earliestDayMs,
		// appRetainedSinceMs, runsRetainedSinceMs), so the domain still
		// stretches back ~174 years regardless — exactly the scenario the bug
		// describes: deep TOKEN history dragging the WHOLE domain (and so the
		// app-time series request) down with it.
		const RECENT_MS = now - 100 * ONE_DAY_MS;
		const seriesCalls: number[][] = [];

		(window as unknown as { ai14all: unknown }).ai14all = {
			insights: {
				coverageAnchors: vi.fn().mockResolvedValue({
					ok: true,
					data: {
						firstCaptureAt: RECENT_MS,
						appRetainedSinceMs: RECENT_MS,
						runsRetainedSinceMs: RECENT_MS,
					},
				}),
				queryAppTimeSeries: vi
					.fn()
					.mockImplementation(async (edges: number[]) => {
						seriesCalls.push(edges);
						// Mirrors insights-host.ts's isValidBucketEdges (spec §4.3):
						// 2..9001 entries, WITHOUT ever "forwarding" past that check —
						// the real regression signal this test depends on.
						if (edges.length < 2 || edges.length > 9001) {
							return { ok: false, reason: "bad-request" };
						}
						return {
							ok: true,
							data: {
								buckets: edges.slice(0, -1).map((startMs: number) => ({
									startMs,
									focusedMs: 0,
									engagedMs: 0,
								})),
								completeness: "complete",
							},
						};
					}),
				query: vi.fn().mockResolvedValue({
					ok: true,
					data: { runs: [], completeness: "complete" },
				}),
			},
			usage: {
				queryRange: vi
					.fn()
					.mockImplementation(async (query: UsageRangeQuery) => {
						const span = query.toMs - query.fromMs;
						if (span > 365 * ONE_DAY_MS) {
							// The real, ~174-year `all` domain-window query — usage.
							// queryRange has no edge-count cap (Addendum 5: sparse
							// emission), so this must still succeed at full depth.
							return {
								ok: true,
								days: [
									{
										dayStartMs: query.fromMs,
										tokens: { claude: 20_000_000 },
									},
								],
								byWorkspace: [
									{
										workspaceId: "ws-deep-tokens",
										worktreeId: null,
										worktreePath: null,
										worktreeTitle: "174-year row",
										provider: "claude",
										active: false,
										tokens: {
											input: 0,
											output: 0,
											billable: 20_000_000,
											raw: 20_000_000,
										},
										costUsd: 77.77,
									},
								],
								byProvider: [],
								cost: {
									perProvider: { claude: 77.77 },
									total: 77.77,
									currency: "USD",
									notional: true,
									unpricedTokens: 0,
								},
								earliestDayMs: DEEP_EARLIEST_MS,
							};
						}
						// The cheap step-1 recent probe (~7 days) — small, distinct
						// numbers so a leak into tiles/table/chart would be obvious.
						return {
							ok: true,
							days: [{ dayStartMs: query.fromMs, tokens: { claude: 1 } }],
							byWorkspace: [],
							byProvider: [],
							cost: {
								perProvider: {},
								total: 0,
								currency: "USD",
								notional: true,
								unpricedTokens: 0,
							},
							earliestDayMs: DEEP_EARLIEST_MS,
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
			expect(result.current.workspaceRows.totals.tokens).toBe(20_000_000),
		);

		// Status live — the whole point: a deep token ledger must never turn
		// the app-time series request into a `bad-request` -> error state.
		expect(result.current.status).toBe("live");

		// Every queryAppTimeSeries call (both the domain series AND the
		// rhythm read share this same mock, across BOTH the mount's initial
		// `7d` fetch and the `all`-range fetch that follows it) stayed within
		// the host's cap.
		expect(seriesCalls.length).toBeGreaterThan(0);
		for (const edges of seriesCalls) {
			expect(edges.length).toBeGreaterThanOrEqual(2);
			expect(edges.length).toBeLessThanOrEqual(9001);
		}
		// At least one call was genuinely narrowed by seriesEdgesFor to the
		// `all`-domain's clamped weekly series — distinguished from the
		// mount's small `7d` series (8 edges, dayEdges(now,7), unclamped
		// identity) and either range's always-large hourly rhythm read (169
		// edges for `7d`; ~8,761 for the clamped `all` rhythm) by falling
		// strictly BETWEEN those: roughly 365/7 + 1 ≈ 53 weekly edges. THAT
		// call never starts AFTER the real appRetainedSinceMs anchor
		// (round-7 hardening: the clamp honors min(the 365-day floor,
		// appAnchorMs), so it can never exclude a retained, non-precapture
		// column — see bucketEdges.ts's doc).
		const wideSeriesCalls = seriesCalls.filter(
			(edges) => edges.length > 10 && edges.length <= 60,
		);
		expect(wideSeriesCalls.length).toBeGreaterThan(0);
		for (const edges of wideSeriesCalls) {
			expect(edges[0]).toBeLessThanOrEqual(RECENT_MS);
		}

		// Token chart/tiles/table all derive from the FULL-domain usage
		// response — the app-time clamp is a completely separate read and
		// must not affect token data at all.
		expect(result.current.tiles.tokens).toBe(20_000_000);
		expect(result.current.tiles.costUsd).toBe(77.77);
		expect(result.current.workspaceRows.totals.tokens).toBe(20_000_000);
		expect(
			result.current.usage?.byWorkspace.some(
				(r) => r.workspaceId === "ws-deep-tokens",
			),
		).toBe(true);
	});
});
