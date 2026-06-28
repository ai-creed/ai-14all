import type {
	DailyPoint,
	ProviderTelemetryInfo,
} from "../../../shared/models/usage.js";
import { seriesForRange } from "./rollup.js";

// Daily stacked bar: one column per day, a segment per provider (brand color via
// the --provider-{id} CSS custom property). Inert / zero-data days contribute no
// segments. Shared by the chip (compact) and the popover (taller).
export function UsageChart({
	series,
	providers,
	range,
	nowMs,
	height = 34,
}: {
	series: DailyPoint[];
	providers: ProviderTelemetryInfo[];
	range: "week" | "month";
	nowMs: number;
	height?: number;
}) {
	const slice = seriesForRange(series, range, nowMs);
	const order = providers.filter((p) => p.capabilities.tokenLog).map((p) => p.id);
	const max = Math.max(
		1,
		...slice.map((p) =>
			Object.values(p.tokens).reduce((s, v) => s + (v ?? 0), 0),
		),
	);
	return (
		<div className="usage-chart" style={{ height }}>
			{slice.map((point, i) => (
				<div className="usage-chart-bar" key={i}>
					{order.map((id) => {
						const v = point.tokens[id] ?? 0;
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
			))}
		</div>
	);
}
