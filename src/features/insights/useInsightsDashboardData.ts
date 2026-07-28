// Data hook for InsightsDashboard (task-12 brief; design spec §4.5/§4.7).
// Fetch orchestration, in this exact order per cycle:
//   1. coverageAnchors() + usage.queryRange(probe) in parallel.
//   2. Any insights read ok:false -> "error" (remembered for retry); usage
//      "disabled" -> usageDisabled (NOT error); usage "timeout" -> "error".
//   3. domain = domainForRange(range, {earliestDayMs, appRetainedSinceMs,
//      runsRetainedSinceMs}, now).
//   4. queryAppTimeSeries(domain.edges) + query(domain window) +
//      queryAppTimeSeries(rhythmEdges(...)) in parallel.
//   5. Empty decision (both retained anchors null AND usage disabled/no
//      ledger days).
//   6. Tiles: filtered to the selected range's tile window.
//   7. workspaceRows from the SAME tile-window-filtered runs, so the table
//      totals equal the tiles by construction (AC5).
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

		// Step 1: anchors + usage probe, parallel. `all` probes full ledger
		// depth (fromMs: 0) so `earliestDayMs` and `days` cover every source
		// day; other ranges probe exactly the day window the range will render
		// (domainForRange ignores the anchors argument for day-mode ranges).
		const probe =
			currentRange === "all"
				? { fromMs: 0, toMs: dayEdges(now, 1)[1] }
				: (() => {
						const d = domainForRange(
							currentRange,
							{
								earliestDayMs: null,
								appRetainedSinceMs: null,
								runsRetainedSinceMs: null,
							},
							now,
						);
						return { fromMs: d.edges[0], toMs: d.edges[d.edges.length - 1] };
					})();

		const [anchorsResult, usageResult] = await Promise.all([
			api.insights.coverageAnchors(),
			api.usage.queryRange(probe),
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
			usageData = {
				days: usageResult.days,
				byWorkspace: usageResult.byWorkspace,
				byProvider: usageResult.byProvider,
				cost: usageResult.cost,
				earliestDayMs: usageResult.earliestDayMs,
			};
		} else if (usageResult.reason === "disabled") {
			disabled = true;
		} else {
			// "timeout" -> error, per §4.1/§6.
			if (generationRef.current !== my) return; // superseded — discard
			setStatus("error");
			setUpdatedAt(Date.now());
			return;
		}

		// Step 3: one shared bucket domain (decision 12).
		const domainAnchors: DomainAnchors = {
			earliestDayMs: usageData?.earliestDayMs ?? null,
			appRetainedSinceMs: anchorsData.appRetainedSinceMs,
			runsRetainedSinceMs: anchorsData.runsRetainedSinceMs,
		};
		const dom = domainForRange(currentRange, domainAnchors, now);

		// Step 4: series/runs/rhythm, parallel.
		const [seriesResult, runsResult, rhythmResult] = await Promise.all([
			api.insights.queryAppTimeSeries(dom.edges),
			api.insights.query({
				fromMs: dom.edges[0],
				toMs: dom.edges[dom.edges.length - 1],
			}),
			api.insights.queryAppTimeSeries(rhythmEdges(dom.edges[0], now)),
		]);

		if (!seriesResult.ok || !runsResult.ok || !rhythmResult.ok) {
			if (generationRef.current !== my) return; // superseded — discard
			setStatus("error");
			setUpdatedAt(Date.now());
			return;
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
		const tokens = sumDayTokens(usageData?.days ?? [], tileWindow);
		const costUsd = usageData?.cost.total ?? null;

		// Step 7: workspace rows, from the SAME tile-filtered runs used above.
		const rows = buildWorkspaceRows(
			usageData?.byWorkspace ?? [],
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
		setUsage(usageData);
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
