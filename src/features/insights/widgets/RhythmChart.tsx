// Rhythm widget: 24 local-hour columns of average focused minutes (design
// spec §5, prototype `#rhythm`). Single series on --primary; zero-hours
// render on --muted (glyph/caption-free, since the zero-vs-nonzero signal
// here is a data value, not a completeness state).
import type React from "react";
import { Bar, BarChart, Cell, XAxis } from "recharts";
import {
	ChartContainer,
	type ChartConfig,
} from "../../../components/ui/chart.js";

const CONFIG: ChartConfig = {
	minutes: { label: "focused", color: "var(--primary)" },
};

const HOUR_LABELS = ["00", "06", "12", "18"];

export function RhythmChart({
	rhythm,
}: {
	rhythm: number[] | null;
}): React.ReactElement {
	const hours = rhythm ?? new Array(24).fill(0);
	const data = hours.map((minutes, hour) => ({ hour, minutes }));

	return (
		<div className="idb-cell">
			<div className="idb-cell-h">
				<span className="k">rhythm — focus by hour</span>
			</div>
			<ChartContainer config={CONFIG} className="idb-rhythm">
				<BarChart accessibilityLayer data={data}>
					<XAxis dataKey="hour" hide />
					<Bar dataKey="minutes" isAnimationActive={false}>
						{data.map((d) => (
							<Cell
								key={d.hour}
								fill={d.minutes > 0 ? "var(--primary)" : "var(--muted)"}
							/>
						))}
					</Bar>
				</BarChart>
			</ChartContainer>
			<div className="idb-rlabels">
				{HOUR_LABELS.map((label) => (
					<span
						key={label}
						className="idb-rlabel"
						style={{ flex: 6, textAlign: "left" }}
					>
						{label}
					</span>
				))}
			</div>
		</div>
	);
}
