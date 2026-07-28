// Runs-by-bucket stacked bar chart (design spec §5, prototype `#runs-bars`).
// Buckets a run by its `startedAt` against the shared domain edges, then
// projects statuses via the SAME `countRunOutcomes` the stat tile and
// workspace table use (runStatus.ts, §4.9) — one projection, everywhere.
import type React from "react";
import { Bar, BarChart, XAxis } from "recharts";
import {
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
	type ChartConfig,
} from "../../../components/ui/chart.js";
import { countRunOutcomes, type RunOutcomeCounts } from "../runStatus.js";
import type { Domain } from "../useInsightsDashboardData.js";
import { dataStartIndex, precaptureFlags } from "./precapture.js";
import type { InsightsWhisperRun } from "../../../../shared/contracts/commands.js";

const CONFIG: ChartConfig = {
	done: { label: "done", color: "var(--success)" },
	halted: { label: "halted", color: "var(--warning)" },
	failed: { label: "failed", color: "var(--danger)" },
	active: { label: "active", color: "var(--info)" },
	other: { label: "other", color: "var(--muted-foreground)" },
};

function bucketRuns(
	runs: InsightsWhisperRun[],
	edges: number[],
): RunOutcomeCounts[] {
	const bucketCount = Math.max(edges.length - 1, 0);
	const statusesByBucket: string[][] = Array.from(
		{ length: bucketCount },
		() => [],
	);
	for (const r of runs) {
		if (r.startedAt === null) continue;
		for (let i = 0; i < bucketCount; i++) {
			if (r.startedAt >= edges[i] && r.startedAt < edges[i + 1]) {
				statusesByBucket[i].push(r.status);
				break;
			}
		}
	}
	return statusesByBucket.map((statuses) => countRunOutcomes(statuses));
}

export function RunsChart({
	domain,
	runs,
	runsRetainedSinceMs,
}: {
	domain: Domain;
	runs: InsightsWhisperRun[] | null;
	runsRetainedSinceMs: number | null;
}): React.ReactElement {
	const buckets = bucketRuns(runs ?? [], domain.edges);
	const flags = precaptureFlags(domain.edges, runsRetainedSinceMs);
	const startIdx = dataStartIndex(flags);
	const hasActive = buckets.some((b) => b.active > 0);
	const hasOther = buckets.some((b) => b.other > 0);
	const data = domain.edges.slice(0, -1).map((startMs, i) => ({
		label: String(startMs),
		...(startIdx !== -1 && i >= startIdx ? buckets[i] : {}),
	}));

	return (
		<div className="idb-cell" data-zone="runs">
			<div className="idb-cell-h">
				<span className="k">agent workflows — runs</span>
				<div className="idb-legend">
					<span>
						<span className="sw sw--done" />
						done
					</span>
					<span>
						<span className="sw sw--halted" />
						halted
					</span>
					<span>
						<span className="sw sw--failed" />
						failed
					</span>
				</div>
			</div>
			<ChartContainer config={CONFIG} className="idb-bars">
				<BarChart accessibilityLayer data={data}>
					<XAxis dataKey="label" hide />
					<Bar
						dataKey="done"
						stackId="runs"
						fill="var(--color-done)"
						isAnimationActive={false}
					/>
					<Bar
						dataKey="halted"
						stackId="runs"
						fill="var(--color-halted)"
						isAnimationActive={false}
					/>
					<Bar
						dataKey="failed"
						stackId="runs"
						fill="var(--color-failed)"
						isAnimationActive={false}
					/>
					{hasActive && (
						<Bar
							dataKey="active"
							stackId="runs"
							fill="var(--color-active)"
							isAnimationActive={false}
						/>
					)}
					{hasOther && (
						<Bar
							dataKey="other"
							stackId="runs"
							fill="var(--color-other)"
							isAnimationActive={false}
						/>
					)}
					<ChartTooltip content={<ChartTooltipContent />} />
				</BarChart>
			</ChartContainer>
			<div className="idb-bars-chrome" aria-hidden="true">
				{domain.edges.slice(0, -1).map((startMs, i) => (
					<div
						key={startMs}
						className={flags[i] ? "idb-bcol is-precapture" : "idb-bcol"}
					/>
				))}
			</div>
		</div>
	);
}
