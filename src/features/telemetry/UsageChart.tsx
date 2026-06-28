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
	  }
	| {
			kind: "hourly";
			hourly: HourlyPoint[];
			providers: ProviderTelemetryInfo[];
			nowMs: number;
			height?: number;
	  };

export function UsageChart(props: Props): JSX.Element | null {
	const height = props.height ?? 34;
	const order = props.providers.map((p) => p.id);
	const slice =
		props.kind === "daily"
			? seriesForRange(props.daily, props.range, props.nowMs).map((p) => p.tokens)
			: props.hourly.map((p) => p.tokens);
	if (slice.length === 0) return null;
	let max = 0;
	for (const point of slice) {
		let sum = 0;
		for (const id of order) sum += point[id] ?? 0;
		if (sum > max) max = sum;
	}
	if (max === 0) return null;
	return (
		<div className="usage-chart" style={{ height }}>
			{slice.map((tokens, i) => (
				<div className="usage-chart-bar" key={i}>
					{order.map((id) => {
						const v = tokens[id] ?? 0;
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
			))}
		</div>
	);
}
