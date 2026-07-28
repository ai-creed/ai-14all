// Shared X-label row for the three capture-bound zones (design spec §5,
// prototype `chartLabels()`), ported rule-for-rule: day letters (+ today
// marked "M·"-style) for the 7-column day mode; sparse today/capture-start/
// month labels for the 30-day and week modes. `anchorMs` is the zone's OWN
// retained anchor (same one `precaptureFlags` uses), which is what drives
// the "capture ▸" label in 30-day mode.
import type React from "react";
import { startOfLocalDayMs } from "../bucketEdges.js";
import type { Domain } from "../useInsightsDashboardData.js";

const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"]; // Date#getDay(): 0=Sun..6=Sat

export type LabelMode = "day7" | "day30" | "week";

// day7 (today/7d, 7 daily columns) vs day30 (30 daily columns) vs week
// (`all`) — inferred from the domain shape rather than threading `range`
// through every widget.
export function labelModeFor(domain: Domain): LabelMode {
	if (domain.mode === "week") return "week";
	return domain.edges.length - 1 === 7 ? "day7" : "day30";
}

export function ChartLabels({
	domain,
	anchorMs,
}: {
	domain: Domain;
	anchorMs: number | null;
}): React.ReactElement {
	const mode = labelModeFor(domain);
	const buckets = domain.edges.slice(0, -1);
	const lastIdx = buckets.length - 1;
	const anchorDayMs = anchorMs === null ? null : startOfLocalDayMs(anchorMs);
	// Month labels render only when the week crosses into a new month vs the
	// PREVIOUS bucket (prototype technique: the very first column never gets
	// one, since there is no prior bucket to compare against).
	let prevMonth = buckets.length > 0 ? new Date(buckets[0]).getMonth() : null;

	return (
		<div className={mode === "day7" ? "idb-labels" : "idb-labels is-sparse"}>
			{buckets.map((startMs, i) => {
				const isLast = i === lastIdx;
				let text = "";
				let today = false;
				if (mode === "day7") {
					text = DAY_LETTERS[new Date(startMs).getDay()];
					if (isLast) {
						text += "·";
						today = true;
					}
				} else if (isLast) {
					text = mode === "week" ? "now" : "today";
					today = true;
				} else if (
					mode === "day30" &&
					anchorDayMs !== null &&
					startMs === anchorDayMs
				) {
					text = "capture ▸";
				} else if (mode === "week" && i > 0) {
					const month = new Date(startMs).getMonth();
					if (month !== prevMonth) {
						text = new Date(startMs)
							.toLocaleDateString("en-US", { month: "short" })
							.toLowerCase();
					}
					prevMonth = month;
				}
				return (
					<div
						key={startMs}
						className={today ? "idb-label is-today" : "idb-label"}
					>
						{text}
					</div>
				);
			})}
		</div>
	);
}
