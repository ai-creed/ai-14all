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
import type { InsightsAppTimeSeries } from "../../../../shared/contracts/commands.js";
import type { Domain } from "../useInsightsDashboardData.js";

const CONFIG: ChartConfig = {
	engaged: { label: "engaged", color: "var(--primary)" },
	focused: { label: "focused", color: "var(--muted-foreground)" },
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
	const buckets = series?.buckets ?? [];
	const flags = precaptureFlags(domain.edges, appRetainedSinceMs);
	const startIdx = dataStartIndex(flags);

	const data = domain.edges.slice(0, -1).map((startMs, i) => {
		const b = buckets[i];
		const captured = !flags[i];
		return {
			label: String(startMs),
			focusedMs: captured ? (b?.focusedMs ?? 0) : null,
			engagedMs: captured ? (b?.engagedMs ?? 0) : null,
		};
	});

	return (
		<div className="idb-cell" data-zone="apptime">
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
			<ChartContainer config={CONFIG} className="idb-area">
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
					<Area
						dataKey="focusedMs"
						stroke="var(--color-focused)"
						fill="var(--color-focused)"
						fillOpacity={0.18}
						strokeWidth={1.5}
						isAnimationActive={false}
						connectNulls={false}
					/>
					<Area
						dataKey="engagedMs"
						stroke="var(--color-engaged)"
						fill="var(--color-engaged)"
						fillOpacity={0.28}
						strokeWidth={2}
						isAnimationActive={false}
						connectNulls={false}
					/>
					<ChartTooltip content={<ChartTooltipContent />} />
				</AreaChart>
			</ChartContainer>
			<div className="idb-chrome-ticks" aria-hidden="true">
				{domain.edges.slice(0, -1).map((startMs, i) => (
					<div
						key={startMs}
						className={flags[i] ? "idb-tick is-precapture" : "idb-tick"}
					/>
				))}
			</div>
			{startIdx > 0 && <div className="cap-line" data-testid="capture-line" />}
		</div>
	);
}
