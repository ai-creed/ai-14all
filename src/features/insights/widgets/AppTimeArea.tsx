// Overview area chart: focused/engaged app time (design spec §5, prototype
// `#area`). Recharts draws the real series; the capture-start marker and the
// per-bucket precapture ticks are rendered as plain chrome elements
// alongside the chart (task-12 brief: "the stub row is not data, it's
// chrome") — Recharts' `ResponsiveContainer` does not size (and so does not
// render its children) in a zero-layout jsdom test environment, so any
// state this widget's tests must observe cannot live only inside the chart.
import type React from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, XAxis } from "recharts";
import {
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
	type ChartConfig,
} from "../../../components/ui/chart.js";
import { dataStartIndex, precaptureFlags } from "./precapture.js";
import { PrecaptureChrome } from "./PrecaptureChrome.js";
import { ChartLabels } from "./ChartLabels.js";
import { fmt } from "./format.js";
import { formatShortDate } from "../coverageCopy.js";
import type { InsightsAppTimeSeries } from "../../../../shared/contracts/commands.js";
import type { Domain } from "../useInsightsDashboardData.js";

// Keyed by the Area components' own dataKeys (focusedMs/engagedMs), not the
// prototype's short names — ChartTooltipContent looks up a series' label via
// config[dataKey], so a mismatched key here silently falls through to the
// raw dataKey in the tooltip. Exported (unusual for this file) so a unit
// test can assert the keys stay in sync with the dataKeys below without
// needing Recharts/ResponsiveContainer to render anything.
export const APP_TIME_CONFIG: ChartConfig = {
	engagedMs: { label: "engaged", color: "var(--primary)" },
	focusedMs: { label: "focused", color: "var(--muted-foreground)" },
};

export function AppTimeArea({
	domain,
	series,
	appRetainedSinceMs,
}: {
	domain: Domain;
	series: InsightsAppTimeSeries | null;
	appRetainedSinceMs: number | null;
}): React.ReactElement {
	// The series read is retention-clamped (useInsightsDashboardData.ts's
	// seriesEdgesFor) and so may cover only a SUFFIX of `domain.edges` for a
	// deep `all` domain — `buckets` must therefore be looked up by its own
	// `startMs` key, never zipped by index against `domain.edges`. Columns
	// outside the clamped window fall back to `undefined` here, which is
	// exactly right: `precaptureFlags` below already marks every one of them
	// (and only them) precapture, since the app's own retention anchor can
	// never predate the SAME 365-day floor the series clamp uses — so those
	// columns render as stubs regardless of what `byStart.get` returns.
	const buckets = series?.buckets ?? [];
	const byStart = new Map(buckets.map((b) => [b.startMs, b] as const));
	const flags = precaptureFlags(domain.edges, appRetainedSinceMs);
	const startIdx = dataStartIndex(flags);

	const data = domain.edges.slice(0, -1).map((startMs, i) => {
		const b = byStart.get(startMs);
		const captured = !flags[i];
		return {
			label: String(startMs),
			focusedMs: captured ? (b?.focusedMs ?? 0) : null,
			engagedMs: captured ? (b?.engagedMs ?? 0) : null,
		};
	});
	// The last bucket always covers "now" (dayEdges/weekEdgesFrom both walk
	// through `now`), so it doubles as the today marker.
	const todayLabel = data[data.length - 1]?.label;

	return (
		<div
			className="idb-cell"
			data-zone="apptime"
			// Test-observable equivalent of the ReferenceLine's own `cap-line`
			// class below: Recharts' ResponsiveContainer does not size (and so
			// does not render its children) in a zero-layout jsdom test
			// environment (module doc above), so a jsdom test cannot observe the
			// ReferenceLine directly — this attribute on the always-rendered
			// wrapper is what stands in for it there.
			data-capture-line={startIdx > 0 ? "true" : undefined}
		>
			<div className="idb-cell-h">
				<span className="k">
					app time — {domain.mode === "week" ? "weekly" : "daily"}
				</span>
				<div className="idb-legend">
					<span>
						<span className="sw sw--eng" />
						engaged
					</span>
					<span>
						<span className="sw sw--foc" />
						focused
					</span>
				</div>
			</div>
			<ChartContainer config={APP_TIME_CONFIG} className="idb-area">
				<AreaChart accessibilityLayer data={data}>
					<CartesianGrid stroke="var(--border)" vertical={false} />
					<XAxis dataKey="label" hide />
					{startIdx > 0 && (
						<ReferenceLine
							className="cap-line"
							x={data[startIdx]?.label}
							stroke="var(--border)"
						/>
					)}
					{todayLabel !== undefined && (
						<ReferenceLine
							className="today-line"
							x={todayLabel}
							stroke="var(--primary)"
						/>
					)}
					<Area
						dataKey="focusedMs"
						stroke="var(--color-focusedMs)"
						fill="var(--color-focusedMs)"
						fillOpacity={0.18}
						strokeWidth={1.5}
						isAnimationActive={false}
						connectNulls={false}
					/>
					<Area
						dataKey="engagedMs"
						stroke="var(--color-engagedMs)"
						fill="var(--color-engagedMs)"
						fillOpacity={0.28}
						strokeWidth={2}
						isAnimationActive={false}
						connectNulls={false}
					/>
					<ChartTooltip
						content={
							<ChartTooltipContent
								config={APP_TIME_CONFIG}
								labelFormatter={(l) => formatShortDate(Number(l))}
								valueFormatter={(v) => (typeof v === "number" ? fmt(v) : "—")}
							/>
						}
					/>
				</AreaChart>
			</ChartContainer>
			<PrecaptureChrome edges={domain.edges} flags={flags} />
			<ChartLabels domain={domain} anchorMs={appRetainedSinceMs} />
		</div>
	);
}
