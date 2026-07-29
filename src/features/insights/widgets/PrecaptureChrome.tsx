// Shared precapture/today chrome row for the three capture-bound zones
// (design spec §2.9/AC3/AC4, prototype `.idb-bars`/`.idb-bcol`). Renders the
// SAME `.idb-bars`/`.idb-bcol` markup the prototype's bar zones use — the
// apptime zone deliberately reuses this rather than a bespoke element, per
// the task-12 review: "the same baseline-tick chrome the bar zones use".
// `.idb-bars--chrome` (insights.css) collapses it to a thin baseline strip
// so it reads as a marker row under the real Recharts chart, not a second
// bar chart.
import type React from "react";

export function PrecaptureChrome({
	edges,
	flags,
}: {
	edges: number[];
	flags: boolean[];
}): React.ReactElement {
	const buckets = edges.slice(0, -1);
	const lastIdx = buckets.length - 1;
	return (
		<div className="idb-bars idb-bars--chrome" aria-hidden="true">
			{buckets.map((startMs, i) => {
				const classes = ["idb-bcol"];
				if (flags[i]) classes.push("is-precapture");
				// The last bucket always covers "now" (dayEdges/weekEdgesFrom both
				// walk through `now`), so it is always the current/"today" column.
				if (i === lastIdx) classes.push("is-today");
				return <div key={startMs} className={classes.join(" ")} />;
			})}
		</div>
	);
}
