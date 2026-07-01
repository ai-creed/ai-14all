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
const MONTH = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
] as const;
const sameLocalDay = (a: number, b: number): boolean =>
	new Date(a).toDateString() === new Date(b).toDateString();
// Absolute month index (year*12 + month) so a Dec->Jan roll counts as a boundary
// and the same month a year apart never false-matches.
const monthIndex = (ms: number): number => {
	const d = new Date(ms);
	return d.getFullYear() * 12 + d.getMonth();
};

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

	// The date-label row is a popover-only affordance — the 120px chip has no room
	// for it, so it never opts in.
	const labelled = props.kind === "daily" && props.showDayLabels === true;

	const bars = (
		<div className="usage-chart" style={{ height }}>
			{slice.map((pt, i) => {
				const isToday =
					labelled &&
					"dayStartMs" in pt &&
					sameLocalDay(pt.dayStartMs, props.nowMs);
				return (
					<div
						className={isToday ? "usage-chart-bar is-today" : "usage-chart-bar"}
						key={i}
					>
						{order.map((id) => {
							const v = pt.tokens[id] ?? 0;
							if (!v) return null;
							return (
								<span
									key={id}
									className="usage-chart-seg"
									style={{
										height: `${(v / max) * height}px`,
										background: `var(--provider-${id})`,
									}}
								/>
							);
						})}
					</div>
				);
			})}
		</div>
	);

	if (props.kind !== "daily" || props.showDayLabels !== true) return bars;

	// Week (≤7 bars): a weekday initial under every bar. Month (~31 bars): sparse
	// ticks — the month abbrev at the leftmost bar and each 1st-of-month, plus a
	// dot on today when it isn't already a boundary. Every bar still gets one label
	// slot (blank between ticks) so the ticks stay aligned to their column.
	const monthMode = props.range === "month";
	const nowMs = props.nowMs;
	return (
		<div className="usage-chart-wrap">
			{bars}
			<div
				className={
					monthMode ? "usage-chart-labels is-month" : "usage-chart-labels"
				}
				aria-hidden="true"
			>
				{slice.map((pt, i) => {
					const ds = "dayStartMs" in pt ? pt.dayStartMs : nowMs;
					const isToday = sameLocalDay(ds, nowMs);
					let text = "";
					let align = "";
					if (!monthMode) {
						text = WEEKDAY[new Date(ds).getDay()];
					} else {
						const prev = slice[i - 1];
						const prevDs =
							prev && "dayStartMs" in prev ? prev.dayStartMs : null;
						const boundary =
							i === 0 ||
							(prevDs !== null && monthIndex(prevDs) !== monthIndex(ds));
						if (boundary) {
							text = MONTH[new Date(ds).getMonth()];
							// Anchor the abbrev to its boundary column: flow right normally,
							// but right-align the last column so it never spills off the edge.
							align = i === slice.length - 1 ? " align-right" : " align-left";
						} else if (isToday) {
							text = "•";
						}
					}
					return (
						<span
							key={i}
							className={`usage-chart-label${isToday ? " is-today" : ""}${align}`}
						>
							{text}
						</span>
					);
				})}
			</div>
		</div>
	);
}
