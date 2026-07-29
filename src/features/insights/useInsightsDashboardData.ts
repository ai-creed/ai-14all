// Data hook for InsightsDashboard (task-12 brief; design spec §4.5/§4.7).
// Fetch orchestration, in this exact order per cycle:
//   1. coverageAnchors() + usage.queryRange(probe) in parallel — PLUS a
//      second usage.queryRange(tileProbe) in the SAME Promise.all when the
//      range is `today`, whose tile window (the trailing day) is narrower
//      than its 7-day domain probe window (AC5): costUsd/byWorkspace have no
//      per-day breakout to filter after the fact, unlike `days` (tokens).
//      Day-mode domains are anchor-independent, so `tileProbe` is knowable
//      up front, before anchors resolve. `probe` itself is ALWAYS a small,
//      bounded window — today/7d/30d probe their own (small) domain size
//      directly; `all` probes the same small window today/7d use, purely to
//      fetch `earliestDayMs` (window-independent — services/usage/range.ts
//      computes it over the WHOLE ledger regardless of the requested span)
//      and the disabled/timeout signal. `all`'s real domain can span back to
//      the earliest retained day — not knowable at this point anyway, since
//      it needs real anchors (the usage-host guard itself no longer rejects
//      wide spans; it's degenerate-input-only — see usage-host.ts). Its own
//      domain-window query is issued later, once the real domain is known
//      (step 3/4 below).
//   2. Any insights read ok:false -> "error" (remembered for retry); usage
//      "disabled" -> usageDisabled (NOT error); usage "timeout" -> "error".
//      The tile probe (when issued) is resolved the same way.
//   3. domain = domainForRange(range, {earliestDayMs, appRetainedSinceMs,
//      runsRetainedSinceMs}, now).
//   4. queryAppTimeSeries(domain.edges) + query(domain window) +
//      queryAppTimeSeries(rhythmEdges(...)) in parallel — PLUS a second
//      usage.queryRange(domain window) in the SAME Promise.all when the
//      range is `all` (its real domain is only knowable now, hence
//      post-domain rather than bundled into step 1 like `today`'s tile
//      probe). Always safe to query directly: the host guard is degenerate-
//      input-only (non-finite bounds, toMs <= fromMs — no span-size check);
//      the worker separately bounds only the CHART's day-point walk, at
//      MAX_RANGE_DAYS (~27 years, services/usage/range.ts) — totals
//      (byWorkspace/byProvider/cost/earliestDayMs) are never clamped there
//      either. Skipped when usage is already known disabled from step 1/2 —
//      a second call would just re-confirm that.
//   5. Empty decision (both retained anchors null AND usage disabled/no
//      ledger days).
//   6. Tiles: filtered to the selected range's tile window; tokens/cost pull
//      from the SECOND usage query's data when one was issued (today's tile
//      probe, or `all`'s domain-window query) — otherwise (7d/30d, whose
//      tile window always equals their step-1 probe window) from the
//      step-1 probe directly.
//   7. workspaceRows from the SAME tile-window-filtered runs AND the SAME
//      usage data tiles use, so the table totals equal the tiles by
//      construction (AC5).
//   7b. The chart (`usage`, exposed to TokenBurnChart) reads from the SAME
//      source as tiles/table for `all` (its step-1 probe is a recent window
//      irrelevant to the weekly chart) — everywhere else (today/7d/30d) it
//      stays on the step-1 probe, which already covers the full domain.
//   8. footer via deriveCoverageFooter.
//   9. 30s poll while document.visibilityState === "visible"; retry = refetch.
import { useCallback, useEffect, useRef, useState } from "react";
import {
	dayEdges,
	domainForRange,
	rhythmEdges,
	type DomainAnchors,
	type RangeKey,
} from "./bucketEdges.js";
import { deriveCoverageFooter } from "./coverageCopy.js";
import {
	countRunOutcomes,
	emptyRunCounts,
	groupRunsByRepo,
	type RunOutcomeCounts,
} from "./runStatus.js";
import { buildWorkspaceRows, type WorkspaceIndex } from "./workspaceRows.js";
import type {
	InsightsAppTimeSeries,
	InsightsCoverageAnchors,
	InsightsWhisperRun,
} from "../../../shared/contracts/commands.js";
import type {
	DailyPoint,
	UsageRangeData,
} from "../../../shared/models/usage.js";

export interface Domain {
	mode: "day" | "week";
	edges: number[];
}

export interface DashboardTiles {
	focusedMs: number;
	engagedMs: number;
	runCounts: RunOutcomeCounts;
	tokens: number;
	costUsd: number | null;
}

export interface DashboardFooter {
	glyph: "●" | "◐";
	framing: string;
	text: string;
}

export interface DashboardData {
	status: "loading" | "live" | "empty" | "error";
	range: RangeKey;
	setRange(r: RangeKey): void;
	view: "overview" | "workspaces";
	setView(v: "overview" | "workspaces"): void;
	retry(): void;
	updatedAt: number | null;
	domain: Domain | null;
	series: InsightsAppTimeSeries | null;
	rhythm: number[] | null;
	runs: InsightsWhisperRun[] | null;
	anchors: InsightsCoverageAnchors | null;
	usage: UsageRangeData | null;
	usageDisabled: boolean;
	tiles: DashboardTiles;
	workspaceRows: ReturnType<typeof buildWorkspaceRows>;
	footer: DashboardFooter;
}

const POLL_MS = 30_000;

function emptyTiles(): DashboardTiles {
	return {
		focusedMs: 0,
		engagedMs: 0,
		runCounts: emptyRunCounts(),
		tokens: 0,
		costUsd: null,
	};
}

function emptyFooter(): DashboardFooter {
	return { glyph: "◐", framing: "", text: "" };
}

// Local-hour rhythm fold (prototype semantics, §4.7 step 4): average focused
// minutes across every covered day for each of the 24 local hours-of-day.
function computeRhythm(
	buckets: Array<{ startMs: number; focusedMs: number }>,
): number[] {
	const sums = new Array(24).fill(0) as number[];
	const counts = new Array(24).fill(0) as number[];
	for (const b of buckets) {
		const hour = new Date(b.startMs).getHours();
		sums[hour] += b.focusedMs / 60_000;
		counts[hour] += 1;
	}
	return sums.map((s, i) => (counts[i] > 0 ? s / counts[i] : 0));
}

function tileWindowFor(
	range: RangeKey,
	domain: Domain,
): { fromMs: number; toMs: number } {
	if (range === "today") {
		return {
			fromMs: domain.edges[domain.edges.length - 2],
			toMs: domain.edges[domain.edges.length - 1],
		};
	}
	return {
		fromMs: domain.edges[0],
		toMs: domain.edges[domain.edges.length - 1],
	};
}

function sumBucketField(
	buckets: Array<{ startMs: number; focusedMs: number; engagedMs: number }>,
	window: { fromMs: number; toMs: number },
	key: "focusedMs" | "engagedMs",
): number {
	let sum = 0;
	for (const b of buckets) {
		if (b.startMs >= window.fromMs && b.startMs < window.toMs) sum += b[key];
	}
	return sum;
}

function sumDayTokens(
	days: DailyPoint[],
	window: { fromMs: number; toMs: number },
): number {
	let sum = 0;
	for (const d of days) {
		if (d.dayStartMs >= window.fromMs && d.dayStartMs < window.toMs) {
			for (const v of Object.values(d.tokens)) sum += v ?? 0;
		}
	}
	return sum;
}

// A successful usage.queryRange result carries `ok: true` alongside the
// UsageRangeData fields directly (not nested) — this just strips the `ok`
// discriminant. Shared by every usage.queryRange call site below (the step-1
// probe, `today`'s tile probe, and `all`'s domain-window query).
function toUsageRangeData(r: { ok: true } & UsageRangeData): UsageRangeData {
	return {
		days: r.days,
		byWorkspace: r.byWorkspace,
		byProvider: r.byProvider,
		cost: r.cost,
		earliestDayMs: r.earliestDayMs,
	};
}

export function useInsightsDashboardData(
	workspaces: WorkspaceIndex,
): DashboardData {
	const [range, setRange] = useState<RangeKey>("7d");
	const [view, setView] = useState<"overview" | "workspaces">("overview");
	const [status, setStatus] = useState<DashboardData["status"]>("loading");
	const [updatedAt, setUpdatedAt] = useState<number | null>(null);
	const [domain, setDomain] = useState<Domain | null>(null);
	const [series, setSeries] = useState<InsightsAppTimeSeries | null>(null);
	const [rhythm, setRhythm] = useState<number[] | null>(null);
	const [runs, setRuns] = useState<InsightsWhisperRun[] | null>(null);
	const [anchors, setAnchors] = useState<InsightsCoverageAnchors | null>(null);
	const [usage, setUsage] = useState<UsageRangeData | null>(null);
	const [usageDisabled, setUsageDisabled] = useState(false);
	const [tiles, setTiles] = useState<DashboardTiles>(emptyTiles());
	const [wsRows, setWsRows] = useState<ReturnType<typeof buildWorkspaceRows>>(
		() => buildWorkspaceRows([], new Map(), workspaces),
	);
	const [footer, setFooter] = useState<DashboardFooter>(emptyFooter());

	// Read inside the async fetch cycle without re-subscribing the poll effect
	// (fetchAll below has a stable identity — the poll effect's dependency —
	// so `range`/`workspaces` must be read via refs, not captured by closure).
	const rangeRef = useRef(range);
	rangeRef.current = range;
	const workspacesRef = useRef(workspaces);
	workspacesRef.current = workspaces;

	// Stale-response guard: a range switch, the 30s poll, and retry can all
	// start a NEW fetch cycle while an older one is still awaiting its
	// network round-trip. Promises don't resolve in start order, so without
	// this a slow, superseded cycle (e.g. the pre-switch range's queries)
	// can land AFTER the fresh one and clobber it with stale data/status.
	// Every `set*` call below is gated on `generationRef.current === my`,
	// checked immediately before use (never cached across an `await`); the
	// unmount effect also bumps the generation, so an in-flight cycle whose
	// component has already unmounted is discarded the same way.
	const generationRef = useRef(0);
	useEffect(() => {
		return () => {
			generationRef.current += 1;
		};
	}, []);

	const fetchAll = useCallback(async () => {
		const my = ++generationRef.current;
		const now = Date.now();
		const currentRange = rangeRef.current;
		const api = window.ai14all;

		// Step 1: anchors + a cheap, always-bounded usage probe, parallel
		// (module doc, step 1). today/7d/30d probe their own (small,
		// anchor-independent) domain size directly; `all` probes the SAME
		// small window today/7d use — its real, potentially-much-larger domain
		// window isn't knowable yet (needs real anchors) and is queried
		// separately once it is (step 4 below).
		const probeDomain: Domain =
			currentRange === "all"
				? { mode: "day", edges: dayEdges(now, 7) }
				: domainForRange(
						currentRange,
						{
							earliestDayMs: null,
							appRetainedSinceMs: null,
							runsRetainedSinceMs: null,
						},
						now,
					);
		const probe = {
			fromMs: probeDomain.edges[0],
			toMs: probeDomain.edges[probeDomain.edges.length - 1],
		};
		// `today` is the only range whose tile window is narrower than its
		// domain probe window (module doc, step 1) — every other range's tile
		// window either already equals the probe window above (7d/30d) or is
		// resolved by its own later, post-domain query (`all`; step 4), so no
		// second fetch is needed here for them.
		const tileProbe =
			currentRange === "today"
				? tileWindowFor(currentRange, probeDomain)
				: null;

		const [anchorsResult, usageResult, tileUsageResult] = await Promise.all([
			api.insights.coverageAnchors(),
			api.usage.queryRange(probe),
			tileProbe ? api.usage.queryRange(tileProbe) : Promise.resolve(null),
		]);

		if (!anchorsResult.ok) {
			if (generationRef.current !== my) return; // superseded — discard
			setStatus("error");
			setUpdatedAt(Date.now());
			return;
		}
		const anchorsData = anchorsResult.data;

		let usageData: UsageRangeData | null = null;
		let disabled = false;
		if (usageResult.ok) {
			usageData = toUsageRangeData(usageResult);
		} else if (usageResult.reason === "disabled") {
			disabled = true;
		} else {
			// "timeout" -> error, per §4.1/§6.
			if (generationRef.current !== my) return; // superseded — discard
			setStatus("error");
			setUpdatedAt(Date.now());
			return;
		}

		// Tile/table (and, for `all`, chart) figures read from the narrower
		// tile probe when one was issued (today, per Step 1); every other
		// range's tile window equals its step-1 probe window, so `usageData`
		// already IS the tile/chart data and no second result needs folding
		// in yet (`all` gets its own second result below, once its domain is
		// known).
		let tileUsageData = usageData;
		let chartUsageData = usageData;
		if (tileProbe && tileUsageResult) {
			if (tileUsageResult.ok) {
				tileUsageData = toUsageRangeData(tileUsageResult);
			} else if (tileUsageResult.reason === "disabled") {
				tileUsageData = null;
			} else {
				// "timeout" -> error, mirroring the domain probe's handling above.
				if (generationRef.current !== my) return; // superseded — discard
				setStatus("error");
				setUpdatedAt(Date.now());
				return;
			}
		}

		// Step 3: one shared bucket domain (decision 12).
		const domainAnchors: DomainAnchors = {
			earliestDayMs: usageData?.earliestDayMs ?? null,
			appRetainedSinceMs: anchorsData.appRetainedSinceMs,
			runsRetainedSinceMs: anchorsData.runsRetainedSinceMs,
		};
		const dom = domainForRange(currentRange, domainAnchors, now);

		// `all`'s real domain-window usage query (module doc, step 4): only
		// knowable now (needs the real anchors `dom` was just built from), and
		// skipped when usage is already known disabled above (a second call
		// would just re-confirm that).
		const domainWindow =
			currentRange === "all" && !disabled
				? { fromMs: dom.edges[0], toMs: dom.edges[dom.edges.length - 1] }
				: null;

		// Step 4: series/runs/rhythm — PLUS `all`'s domain-window usage query
		// when there is one — parallel.
		const [seriesResult, runsResult, rhythmResult, domainUsageResult] =
			await Promise.all([
				api.insights.queryAppTimeSeries(dom.edges),
				api.insights.query({
					fromMs: dom.edges[0],
					toMs: dom.edges[dom.edges.length - 1],
				}),
				api.insights.queryAppTimeSeries(rhythmEdges(dom.edges[0], now)),
				domainWindow
					? api.usage.queryRange(domainWindow)
					: Promise.resolve(null),
			]);

		if (!seriesResult.ok || !runsResult.ok || !rhythmResult.ok) {
			if (generationRef.current !== my) return; // superseded — discard
			setStatus("error");
			setUpdatedAt(Date.now());
			return;
		}

		// `all`: chart AND tiles AND table all read from this domain-window
		// result (module doc, step 4/6/7b) — its step-1 probe was only ever a
		// cheap, recent window used to fetch `earliestDayMs`, irrelevant to
		// the actual (weekly, potentially months-back) domain being rendered.
		if (domainWindow && domainUsageResult) {
			if (domainUsageResult.ok) {
				const resolved = toUsageRangeData(domainUsageResult);
				tileUsageData = resolved;
				chartUsageData = resolved;
			} else if (domainUsageResult.reason === "disabled") {
				// Rare race (telemetry disabled between step 1 and here, since a
				// known-disabled step 1 skips this query entirely): keep
				// `usageDisabled` consistent with the now-absent data.
				disabled = true;
				tileUsageData = null;
				chartUsageData = null;
			} else {
				// "timeout" -> error, mirroring the other usage reads above.
				if (generationRef.current !== my) return; // superseded — discard
				setStatus("error");
				setUpdatedAt(Date.now());
				return;
			}
		}

		const seriesData = seriesResult.data;
		const runsData = runsResult.data.runs;
		const rhythmData = computeRhythm(rhythmResult.data.buckets);

		// Step 5: empty decision.
		const isEmpty =
			anchorsData.appRetainedSinceMs === null &&
			anchorsData.runsRetainedSinceMs === null &&
			(disabled || usageData?.earliestDayMs === null);

		// Step 6: tiles, filtered to the selected range's tile window.
		const tileWindow = tileWindowFor(currentRange, dom);
		const focusedMs = sumBucketField(
			seriesData.buckets,
			tileWindow,
			"focusedMs",
		);
		const engagedMs = sumBucketField(
			seriesData.buckets,
			tileWindow,
			"engagedMs",
		);
		const runsInRange = runsData.filter(
			(r) =>
				r.startedAt !== null &&
				r.startedAt >= tileWindow.fromMs &&
				r.startedAt < tileWindow.toMs,
		);
		const runCounts = countRunOutcomes(runsInRange.map((r) => r.status));
		// AC5: tokens/cost read from `tileUsageData` — the SECOND usage query's
		// data when one was issued (today's tile probe; `all`'s domain-window
		// query), otherwise (7d/30d) the step-1 probe directly, per module doc
		// step 6.
		const tokens = sumDayTokens(tileUsageData?.days ?? [], tileWindow);
		const costUsd = tileUsageData?.cost.total ?? null;

		// Step 7: workspace rows, from the SAME tile-filtered runs AND the
		// SAME usage data tiles used above, so the table totals equal the
		// tiles by construction (AC5).
		const rows = buildWorkspaceRows(
			tileUsageData?.byWorkspace ?? [],
			groupRunsByRepo(runsInRange),
			workspacesRef.current,
		);

		// Step 8: footer. `deriveCoverageFooter` wants the merged DomainAnchors
		// (it reads earliestDayMs for the tokens clause too), not the bare
		// InsightsCoverageAnchors read result — reuse the same merged object
		// step 3 built for domainForRange.
		const footerData = deriveCoverageFooter({
			anchors: domainAnchors,
			firstCaptureAt: anchorsData.firstCaptureAt,
			windowFromMs: dom.edges[0],
			windowToMs: dom.edges[dom.edges.length - 1],
			appComplete: seriesData.completeness === "complete",
			mode: dom.mode,
		});

		if (generationRef.current !== my) return; // superseded — discard
		setAnchors(anchorsData);
		// The chart (TokenBurnChart, via `usage`) reads `chartUsageData` —
		// `usageData` itself for every range except `all` (module doc, step
		// 7b), whose step-1 probe is a recent window irrelevant to its actual
		// (weekly, domain-window) chart data.
		setUsage(chartUsageData);
		setUsageDisabled(disabled);
		setDomain(dom);
		setSeries(seriesData);
		setRhythm(rhythmData);
		setRuns(runsData);
		setTiles({ focusedMs, engagedMs, runCounts, tokens, costUsd });
		setWsRows(rows);
		setFooter(footerData);
		setStatus(isEmpty ? "empty" : "live");
		setUpdatedAt(Date.now());
	}, []);

	// Mount + range-change refetch. `view` deliberately is NOT a dependency:
	// it never feeds any fetched query (overview vs workspaces is a pure
	// render-time split over already-fetched data), so switching it must not
	// trigger a refetch.
	useEffect(() => {
		void fetchAll();
	}, [fetchAll, range]);

	// 30s poll, only while the document is visible (§4.7 fetch cadence).
	useEffect(() => {
		let interval: ReturnType<typeof setInterval> | null = null;
		const start = () => {
			if (interval !== null) return;
			interval = setInterval(() => void fetchAll(), POLL_MS);
		};
		const stop = () => {
			if (interval !== null) {
				clearInterval(interval);
				interval = null;
			}
		};
		const onVisibilityChange = () => {
			if (document.visibilityState === "visible") start();
			else stop();
		};
		if (document.visibilityState === "visible") start();
		document.addEventListener("visibilitychange", onVisibilityChange);
		return () => {
			stop();
			document.removeEventListener("visibilitychange", onVisibilityChange);
		};
	}, [fetchAll]);

	const retry = useCallback(() => {
		void fetchAll();
	}, [fetchAll]);

	return {
		status,
		range,
		setRange,
		view,
		setView,
		retry,
		updatedAt,
		domain,
		series,
		rhythm,
		runs,
		anchors,
		usage,
		usageDisabled,
		tiles,
		workspaceRows: wsRows,
		footer,
	};
}
