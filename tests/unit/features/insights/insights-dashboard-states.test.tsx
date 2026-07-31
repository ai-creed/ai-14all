// @vitest-environment jsdom
//
// Component state tests for InsightsDashboard (task-12 brief, spec §6/AC6):
// empty / error+retry / usage-disabled / live states, plus the short-history
// `all`-range six-stub regression (AC3) and the total run-status projection
// rendered-equality regression (AC5/§4.9). Stubbing pattern copied from
// tests/unit/usage/usage-popover.test.tsx.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InsightsDashboard } from "../../../../src/features/insights/InsightsDashboard.js";

const noop = () => {};
const handlers = {
	onClose: noop,
	onDetach: noop,
	onReattach: noop,
	onOpenSettings: noop,
};

interface StubApi {
	insights: {
		coverageAnchors: ReturnType<typeof vi.fn>;
		queryAppTimeSeries: ReturnType<typeof vi.fn>;
		query: ReturnType<typeof vi.fn>;
	};
	usage: { queryRange: ReturnType<typeof vi.fn> };
}

function stubApi(overrides: Partial<StubApi> = {}) {
	(window as unknown as { ai14all: unknown }).ai14all = {
		insights: {
			coverageAnchors: vi.fn().mockResolvedValue({
				ok: true,
				data: {
					firstCaptureAt: null,
					appRetainedSinceMs: null,
					runsRetainedSinceMs: null,
				},
			}),
			queryAppTimeSeries: vi.fn().mockResolvedValue({
				ok: true,
				data: { buckets: [], completeness: "unknown" },
			}),
			query: vi.fn().mockResolvedValue({
				ok: true,
				data: { runs: [], completeness: "unknown" },
			}),
		},
		usage: {
			queryRange: vi.fn().mockResolvedValue({ ok: false, reason: "disabled" }),
		},
		...overrides,
	};
}

describe("InsightsDashboard", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("empty: no anchors, no ledger days → the ◌ empty state", async () => {
		stubApi();
		render(<InsightsDashboard host="overlay" workspaces={[]} {...handlers} />);
		expect(await screen.findByText("no insights data yet")).toBeInTheDocument();
	});

	it("error + retry: a query-failed read shows the error state; retry refetches and recovers", async () => {
		stubApi();
		const api = (window as unknown as { ai14all: StubApi }).ai14all;
		api.insights.queryAppTimeSeries
			.mockResolvedValueOnce({ ok: false, reason: "query-failed" })
			.mockResolvedValue({
				ok: true,
				data: { buckets: [], completeness: "unknown" },
			});
		api.insights.coverageAnchors.mockResolvedValue({
			ok: true,
			data: {
				firstCaptureAt: 1,
				appRetainedSinceMs: 1,
				runsRetainedSinceMs: null,
			},
		});
		render(<InsightsDashboard host="overlay" workspaces={[]} {...handlers} />);
		expect(
			await screen.findByText("insights store unavailable"),
		).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "retry" }));
		await waitFor(() =>
			expect(
				screen.queryByText("insights store unavailable"),
			).not.toBeInTheDocument(),
		);
	});

	// The panel must name the store that ACTUALLY failed. Three of the hook's
	// five error branches are usage reads, and blaming "the local insights
	// database" for those sent a real bug report at the wrong subsystem while
	// the insights store was healthy throughout.
	it("a USAGE read failure blames token usage, not the insights database", async () => {
		stubApi();
		const api = (window as unknown as { ai14all: StubApi }).ai14all;
		api.usage.queryRange
			.mockResolvedValueOnce({ ok: false, reason: "timeout" })
			.mockResolvedValue({
				ok: true,
				days: [],
				byWorkspace: [],
				byProvider: [],
				cost: {
					perProvider: {},
					total: 0,
					currency: "USD",
					notional: true,
					unpricedTokens: 0,
				},
				earliestDayMs: null,
			});
		render(<InsightsDashboard host="overlay" workspaces={[]} {...handlers} />);

		expect(
			await screen.findByText("token usage unavailable"),
		).toBeInTheDocument();
		expect(
			screen.queryByText("insights store unavailable"),
		).not.toBeInTheDocument();
		expect(
			screen.getByText(/the local token-usage store could not be read/),
		).toBeInTheDocument();

		// Retry recovers, and the copy does not linger once it does.
		fireEvent.click(screen.getByRole("button", { name: "retry" }));
		await waitFor(() =>
			expect(
				screen.queryByText("token usage unavailable"),
			).not.toBeInTheDocument(),
		);
	});

	it("usage disabled: quiet caption, NOT the error state and not zeros", async () => {
		stubApi();
		const api = (window as unknown as { ai14all: StubApi }).ai14all;
		api.insights.coverageAnchors.mockResolvedValue({
			ok: true,
			data: {
				firstCaptureAt: 1,
				appRetainedSinceMs: 1,
				runsRetainedSinceMs: null,
			},
		});
		render(<InsightsDashboard host="overlay" workspaces={[]} {...handlers} />);
		expect(
			await screen.findByText("usage telemetry off — enable in settings"),
		).toBeInTheDocument();
		expect(
			screen.queryByText("insights store unavailable"),
		).not.toBeInTheDocument();
	});

	it("live session (e): anchors non-null → NOT empty; tiles render", async () => {
		stubApi();
		const api = (window as unknown as { ai14all: StubApi }).ai14all;
		const now = Date.now();
		const since = now - 3 * 86_400_000;
		api.insights.coverageAnchors.mockResolvedValue({
			ok: true,
			data: {
				firstCaptureAt: since,
				appRetainedSinceMs: since,
				runsRetainedSinceMs: since,
			},
		});
		api.insights.queryAppTimeSeries.mockImplementation(
			async (edges: number[]) => ({
				ok: true,
				data: {
					buckets: edges
						.slice(0, -1)
						.map((startMs: number, i: number, arr: number[]) => ({
							startMs,
							focusedMs: i === arr.length - 1 ? 2 * 3_600_000 : 0,
							engagedMs: i === arr.length - 1 ? 3_600_000 : 0,
						})),
					completeness: "complete",
				},
			}),
		);
		api.insights.query.mockResolvedValue({
			ok: true,
			data: {
				runs: [
					{
						runId: "r1",
						collabId: "c",
						repoId: null,
						workspaceRel: null,
						workflowType: "sdd",
						status: "done",
						haltReason: null,
						startedAt: now - 3_600_000,
						endedAt: now - 1_800_000,
						durationMs: 1_800_000,
						phaseCount: 1,
					},
				],
				completeness: "complete",
			},
		});
		api.usage.queryRange.mockResolvedValue({
			ok: true,
			days: [],
			byWorkspace: [],
			byProvider: [],
			cost: {
				perProvider: {},
				total: 0,
				currency: "USD",
				notional: true,
				unpricedTokens: 0,
			},
			earliestDayMs: since,
		});
		render(<InsightsDashboard host="overlay" workspaces={[]} {...handlers} />);
		expect(await screen.findByText("2h 00m")).toBeInTheDocument();
		expect(screen.queryByText("no insights data yet")).not.toBeInTheDocument();
	});

	it("(a, render half) short-history `all`: SIX rendered stubs per capture-bound zone, not seven plain zero columns", async () => {
		// anchors put the first data inside the CURRENT week → 7-week floor
		// domain. The precapture count depends on which local weekday `now`
		// falls on (a Monday `now` puts "yesterday" in the PREVIOUS Monday-start
		// week, shifting the count to 5) — pin the clock to a known Wednesday so
		// the hardcoded 6 is deterministic regardless of the real run date.
		vi.useFakeTimers({ shouldAdvanceTime: true });
		vi.setSystemTime(new Date("2026-07-29T12:00:00"));
		stubApi();
		const api = (window as unknown as { ai14all: StubApi }).ai14all;
		const now = Date.now();
		api.insights.coverageAnchors.mockResolvedValue({
			ok: true,
			data: {
				firstCaptureAt: now - 86_400_000,
				appRetainedSinceMs: now - 86_400_000,
				runsRetainedSinceMs: now - 86_400_000,
			},
		});
		api.insights.queryAppTimeSeries.mockImplementation(
			async (edges: number[]) => ({
				ok: true,
				data: {
					buckets: edges.slice(0, -1).map((startMs: number) => ({
						startMs,
						focusedMs: 0,
						engagedMs: 0,
					})),
					completeness: "partial",
				},
			}),
		);
		api.insights.query.mockResolvedValue({
			ok: true,
			data: { runs: [], completeness: "partial" },
		});
		api.usage.queryRange.mockResolvedValue({
			ok: true,
			days: [],
			byWorkspace: [],
			byProvider: [],
			cost: {
				perProvider: {},
				total: 0,
				currency: "USD",
				notional: true,
				unpricedTokens: 0,
			},
			earliestDayMs: now - 86_400_000,
		});
		const { container } = render(
			<InsightsDashboard host="overlay" workspaces={[]} {...handlers} />,
		);
		fireEvent.click(await screen.findByRole("button", { name: "all" }));
		// The padded weeks are STUB chrome (is-precapture), not ordinary zero bars —
		// §4.7/AC3: EVERY source stubs, app time included, 6 per zone:
		await waitFor(() => {
			expect(
				container.querySelectorAll("[data-zone='apptime'] .is-precapture"),
			).toHaveLength(6);
			expect(
				container.querySelectorAll("[data-zone='runs'] .is-precapture"),
			).toHaveLength(6);
			expect(
				container.querySelectorAll("[data-zone='tokens'] .is-precapture"),
			).toHaveLength(6);
		});
		// and the area chart draws its series only from the data-start column
		// (the capture-start marker is present — either Recharts' own
		// ReferenceLine, when it renders, or the wrapper's own attribute, which
		// is what actually renders in this zero-layout jsdom env):
		expect(
			container.querySelector(
				".cap-line, [data-zone='apptime'][data-capture-line='true']",
			),
		).not.toBeNull();
	});

	it("(h, rendered) tiles AND table render all five run classes and agree exactly", async () => {
		stubApi();
		const api = (window as unknown as { ai14all: StubApi }).ai14all;
		const now = Date.now();
		api.insights.coverageAnchors.mockResolvedValue({
			ok: true,
			data: {
				firstCaptureAt: now - 86_400_000,
				appRetainedSinceMs: now - 86_400_000,
				runsRetainedSinceMs: now - 86_400_000,
			},
		});
		api.insights.queryAppTimeSeries.mockImplementation(
			async (edges: number[]) => ({
				ok: true,
				data: {
					buckets: edges.slice(0, -1).map((startMs: number) => ({
						startMs,
						focusedMs: 0,
						engagedMs: 0,
					})),
					completeness: "partial",
				},
			}),
		);
		// one run of EVERY known status + one unknown, all inside the range, repoId null:
		const statuses = [
			"done",
			"halted",
			"failed",
			"running",
			"paused",
			"canceled",
			"archived-v2",
		];
		api.insights.query.mockResolvedValue({
			ok: true,
			data: {
				runs: statuses.map((status, i) => ({
					runId: `r${i}`,
					collabId: "c",
					repoId: null,
					workspaceRel: null,
					workflowType: "sdd",
					status,
					haltReason: null,
					startedAt: now - 3_600_000,
					endedAt: now - 1_800_000,
					durationMs: 1_800_000,
					phaseCount: 1,
				})),
				completeness: "partial",
			},
		});
		api.usage.queryRange.mockResolvedValue({
			ok: true,
			days: [],
			byWorkspace: [],
			byProvider: [],
			cost: {
				perProvider: {},
				total: 0,
				currency: "USD",
				notional: true,
				unpricedTokens: 0,
			},
			earliestDayMs: now - 86_400_000,
		});
		render(<InsightsDashboard host="overlay" workspaces={[]} {...handlers} />);
		// RENDERED tile: total counts every run; breakdown carries all five classes:
		expect(await screen.findByText("7")).toBeInTheDocument(); // runs tile value
		const tile = screen.getByTestId("tile-runs");
		expect(tile.textContent).toContain(
			"1 done · 2 halted · 1 failed · 2 active · 1 other",
		);
		// RENDERED table: the untracked row carries the same five-class counts,
		// and the totals row equals the tile class by class:
		fireEvent.click(screen.getByRole("button", { name: "workspaces" }));
		const totals = await screen.findByTestId("ws-totals");
		expect(totals.textContent).toContain(
			"1 done · 2 halted · 1 failed · 2 active · 1 other",
		);
	});

	it("stale-response guard: a superseded fetch cycle does not clobber the latest range's data", async () => {
		stubApi();
		const api = (window as unknown as { ai14all: StubApi }).ai14all;
		// Non-null anchors so the dashboard reaches "live" (not "empty") status
		// in both cycles — the empty state hides the runs zone entirely, which
		// would make the DOM assertion below vacuous.
		api.insights.coverageAnchors.mockResolvedValue({
			ok: true,
			data: {
				firstCaptureAt: Date.now() - 30 * 86_400_000,
				appRetainedSinceMs: Date.now() - 30 * 86_400_000,
				runsRetainedSinceMs: Date.now() - 30 * 86_400_000,
			},
		});

		function deferred<T>() {
			let resolve!: (value: T) => void;
			const promise = new Promise<T>((res) => {
				resolve = res;
			});
			return { promise, resolve };
		}

		// Gate the two ranges' MAIN series calls independently by their own
		// bucket count (7 for the initial 7d mount, 30 for the range we switch
		// to) — robust regardless of which cycle's queries happen to resolve
		// first; every OTHER call (both cycles' rhythm reads, which are hourly
		// and never land on exactly 7 or 30 buckets) resolves immediately.
		const sevenDay = deferred<void>();
		const thirtyDay = deferred<void>();
		api.insights.queryAppTimeSeries.mockImplementation(
			async (edges: number[]) => {
				const bucketCount = edges.length - 1;
				if (bucketCount === 7) await sevenDay.promise;
				else if (bucketCount === 30) await thirtyDay.promise;
				return {
					ok: true,
					data: {
						buckets: edges.slice(0, -1).map((startMs: number) => ({
							startMs,
							focusedMs: 0,
							engagedMs: 0,
						})),
						completeness: "unknown",
					},
				};
			},
		);

		const { container } = render(
			<InsightsDashboard host="overlay" workspaces={[]} {...handlers} />,
		);
		// The initial 7d mount's fetch is now in-flight, blocked before its main
		// series resolves. Switch to 30d before it does — this starts a second,
		// independent fetch cycle for the SAME hook instance.
		fireEvent.click(screen.getByRole("button", { name: "30d" }));

		// Resolve the NEWER (30d) cycle first, then the STALE (7d) cycle after —
		// out of order. Without the generation guard, the 7d cycle's response
		// (arriving last) would overwrite the 30d result when it finally lands.
		thirtyDay.resolve();
		await waitFor(() => {
			expect(
				container.querySelectorAll("[data-zone='runs'] .idb-bcol").length,
			).toBe(30);
		});

		sevenDay.resolve();
		// Give the stale 7d resolution a turn to (wrongly) land, if it were
		// going to — then re-assert the displayed domain is still the latest
		// (30d) range's, not clobbered back to 7.
		await new Promise((r) => setTimeout(r, 10));
		expect(
			container.querySelectorAll("[data-zone='runs'] .idb-bcol").length,
		).toBe(30);
		expect(screen.getByRole("button", { name: "30d" }).className).toContain(
			"on",
		);
	});

	// Round-6 boundary regression: a deep TOKEN ledger (spanning far more
	// than app-time ever could — app-time physically cannot predate
	// OBSERVATION_RETENTION_DAYS = 365) drags `all`'s WHOLE domain back with
	// it (domainForRange takes min(earliestDayMs, anchors)). Requesting the
	// app-time SERIES over that full domain would trip the host's
	// 2..9001 bucket-edges cap (spec §4.3) — this mock enforces that same
	// cap, so the test genuinely exercises the failure mode (fails with
	// seriesEdgesFor's fix reverted, passes with it applied). The runs and
	// tokens zones have no such cap (runs.query takes a plain fromMs/toMs
	// range; usage.queryRange has no edge-count limit at all, Addendum 5) so
	// their chrome renders the FULL domain's column count; the app-time
	// zone's own chrome ALSO renders the full domain's column count (it is
	// driven by `domain.edges`, not by the clamped series — PrecaptureChrome)
	// with everything before the app's own (recent) retention anchor
	// stubbed, same as any other precapture regime.
	it("~174-year-deep token ledger: no error state; runs/tokens/apptime zones all render full-domain columns; apptime's series stays within the host's edge cap", async () => {
		// Rendering ~9,080 PrecaptureChrome columns x3 zones (~27k DOM nodes)
		// is inherently slower than this suite's usual fixtures — the default
		// 5s per-test timeout isn't about correctness here, just jsdom's raw
		// node-creation cost at this deliberately-extreme depth.
		stubApi();
		const api = (window as unknown as { ai14all: StubApi }).ai14all;
		const now = Date.now();
		const ONE_DAY_MS = 86_400_000;
		const DEEP_EARLIEST_MS = now - 174 * 365 * ONE_DAY_MS;
		const RECENT_MS = now - 100 * ONE_DAY_MS; // app/runs anchors stay realistic
		const seriesCalls: number[][] = [];

		api.insights.coverageAnchors.mockResolvedValue({
			ok: true,
			data: {
				firstCaptureAt: RECENT_MS,
				appRetainedSinceMs: RECENT_MS,
				runsRetainedSinceMs: RECENT_MS,
			},
		});
		api.insights.queryAppTimeSeries.mockImplementation(
			async (edges: number[]) => {
				seriesCalls.push(edges);
				// Mirrors insights-host.ts's isValidBucketEdges (spec §4.3) — the
				// real regression signal this test depends on.
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
			},
		);
		api.insights.query.mockResolvedValue({
			ok: true,
			data: { runs: [], completeness: "complete" },
		});
		// Every window (the small step-1 probe AND the wide `all` domain-window
		// query) gets the same response here — this test isn't exercising
		// token VALUES (that's the hook test's job), only that the app-time
		// series clamp doesn't error the dashboard or leak into the other
		// zones' column counts.
		api.usage.queryRange.mockResolvedValue({
			ok: true,
			days: [],
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
		});

		const { container } = render(
			<InsightsDashboard host="overlay" workspaces={[]} {...handlers} />,
		);
		fireEvent.click(await screen.findByRole("button", { name: "all" }));

		// No error state — the whole point.
		await waitFor(() => {
			expect(screen.queryByText("insights store unavailable")).toBeNull();
		});

		// The three zones' chrome all agree on the FULL domain's column count
		// (PrecaptureChrome is driven by `domain.edges`, never by the
		// series/usage data each zone separately reads) — proof the app-time
		// clamp didn't leak into (or truncate) anything structural.
		await waitFor(() => {
			const runsCols = container.querySelectorAll(
				"[data-zone='runs'] .idb-bcol",
			).length;
			const tokenCols = container.querySelectorAll(
				"[data-zone='tokens'] .idb-bcol",
			).length;
			const apptimeCols = container.querySelectorAll(
				"[data-zone='apptime'] .idb-bcol",
			).length;
			expect(runsCols).toBeGreaterThan(9001); // sanity: genuinely past the cap
			expect(tokenCols).toBe(runsCols);
			expect(apptimeCols).toBe(runsCols);
		});

		// Every queryAppTimeSeries call (the domain series AND the rhythm read
		// share this mock) stayed within the host's cap, including at least
		// one call genuinely narrowed by seriesEdgesFor.
		expect(seriesCalls.length).toBeGreaterThan(0);
		for (const edges of seriesCalls) {
			expect(edges.length).toBeGreaterThanOrEqual(2);
			expect(edges.length).toBeLessThanOrEqual(9001);
		}
		expect(seriesCalls.some((edges) => edges.length <= 60)).toBe(true);
	}, 20_000);
});
