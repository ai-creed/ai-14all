// Headline stat tiles (design spec §5/§6, prototype `.idb-stats`). Loading
// shows `· · ·` per §6 copy; the runs/tokens secondary lines carry
// `data-testid`s consumed by the AC2 e2e and this task's rendered five-class
// test.
import type React from "react";
import { fmt, fmtCostUsd, fmtTokens } from "./format.js";
import { RunsBreakdown } from "./RunsBreakdown.js";
import type { RangeKey } from "../bucketEdges.js";
import type { DashboardTiles } from "../useInsightsDashboardData.js";

export function StatTiles({
	status,
	range,
	tiles,
	usageDisabled,
}: {
	status: "loading" | "live" | "empty" | "error";
	range: RangeKey;
	tiles: DashboardTiles;
	usageDisabled: boolean;
}): React.ReactElement {
	const loading = status === "loading";
	const runTotal =
		tiles.runCounts.done +
		tiles.runCounts.halted +
		tiles.runCounts.failed +
		tiles.runCounts.active +
		tiles.runCounts.other;
	const engagedPct =
		tiles.focusedMs > 0
			? Math.round((tiles.engagedMs / tiles.focusedMs) * 100)
			: null;

	return (
		<div className="idb-stats">
			<div className="idb-stat">
				<div className="k">focused</div>
				<div className="v">{loading ? "· · ·" : fmt(tiles.focusedMs)}</div>
				<div className="s">
					{range === "all" ? "since capture" : "app in foreground"}
				</div>
			</div>
			<div className="idb-stat">
				<div className="k">engaged</div>
				<div className="v">{loading ? "· · ·" : fmt(tiles.engagedMs)}</div>
				<div className="s">
					{engagedPct !== null
						? `${engagedPct}% of focused`
						: "keyboard / pointer active"}
				</div>
			</div>
			<div className="idb-stat" data-testid="tile-runs">
				<div className="k">agent runs</div>
				<div className="v">{loading ? "· · ·" : runTotal}</div>
				<div className="s">
					{loading ? "—" : <RunsBreakdown counts={tiles.runCounts} />}
				</div>
			</div>
			<div className="idb-stat" data-testid="tile-tokens">
				<div className="k">tokens</div>
				<div className="v">
					{loading ? "· · ·" : usageDisabled ? "—" : fmtTokens(tiles.tokens)}
				</div>
				<div className="s">
					{
						// The full "usage telemetry off — enable in settings" copy
						// (§6) renders once, in the token-burn chart zone below —
						// duplicating the exact string here would make it
						// non-unique for text queries (and reads redundantly next
						// to that zone in the same view).
						usageDisabled
							? "usage telemetry off"
							: loading
								? "—"
								: `${fmtCostUsd(tiles.costUsd)} · billable`
					}
				</div>
			</div>
		</div>
	);
}
