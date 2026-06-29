import type { JSX } from "react";
import type {
	DailyPoint,
	HourlyPoint,
	ProviderTelemetryInfo,
} from "../../../shared/models/usage.js";
import { seriesForRange } from "./rollup.js";

type Props =
	| {
			kind: "daily";
			daily: DailyPoint[];
			providers: ProviderTelemetryInfo[];
			range: "week" | "month";
			nowMs: number;
			height?: number;
			// Render a weekday-label row under the bars with today highlighted. A
			// popover-only affordance — the 120px chip has no room for labels.
			showDayLabels?: boolean;
	  }
	| {
			kind: "hourly";
			hourly: HourlyPoint[];
			providers: ProviderTelemetryInfo[];
			nowMs: number;
			height?: number;
	  };

const WEEKDAY = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as const;
const sameLocalDay = (a: number, b: number): boolean =>
	new Date(a).toDateString() === new Date(b).toDateString();

export function UsageChart(props: Props): JSX.Element | null {
	const height = props.height ?? 34;
	const order = props.providers.map((p) => p.id);
	const slice: readonly (DailyPoint | HourlyPoint)[] =
		props.kind === "daily"
			? seriesForRange(props.daily, props.range, props.nowMs)
			: props.hourly;
	if (slice.length === 0) return null;
	let max = 0;
	for (const pt of slice) {
		let sum = 0;
		for (const id of order) sum += pt.tokens[id] ?? 0;
		if (sum > max) max = sum;
	}
	if (max === 0) return null;

	// Weekday initials only fit the ~7-bar week; the ~30-bar month just marks
	// today's column (the `is-today` tick). The chip never opts in.
	const labelled = props.kind === "daily" && props.showDayLabels === true;
	const showWeekdayLabels = labelled && slice.length <= 8;

	const bars = (
		<div className="usage-chart" style={{ height }}>
			{slice.map((pt, i) => {
				const isToday = labelled && "dayStartMs" in pt && sameLocalDay(pt.dayStartMs, props.nowMs);
				return (
					<div className={isToday ? "usage-chart-bar is-today" : "usage-chart-bar"} key={i}>
						{order.map((id) => {
							const v = pt.tokens[id] ?? 0;
							if (!v) return null;
							return (
								<span
									key={id}
									className="usage-chart-seg"
									style={{ height: `${(v / max) * height}px`, background: `var(--provider-${id})` }}
								/>
							);
						})}
					</div>
				);
			})}
		</div>
	);

	if (!showWeekdayLabels) return bars;

	return (
		<div className="usage-chart-wrap">
			{bars}
			<div className="usage-chart-labels" aria-hidden="true">
				{slice.map((pt, i) => {
					const ds = "dayStartMs" in pt ? pt.dayStartMs : props.nowMs;
					const isToday = sameLocalDay(ds, props.nowMs);
					return (
						<span key={i} className={isToday ? "usage-chart-label is-today" : "usage-chart-label"}>
							{WEEKDAY[new Date(ds).getDay()]}
						</span>
					);
				})}
			</div>
		</div>
	);
}
