// Token-burn-by-bucket stacked bar chart (design spec §5, prototype
// `#tok-bars`). Day-mode buckets match `usage.days` 1:1 by day start;
// week-mode ("all") folds day points via the shared `foldDaysToWeeks`
// (bucketEdges.ts) so weekly sums stay exact. Swaps to the §6 quiet caption
// when usage telemetry is disabled, never a fake zero.
import type React from "react";
import { Bar, BarChart, XAxis } from "recharts";
import {
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
	type ChartConfig,
} from "../../../components/ui/chart.js";
import { foldDaysToWeeks } from "../bucketEdges.js";
import type { Domain } from "../useInsightsDashboardData.js";
import { precaptureFlags } from "./precapture.js";
import { PrecaptureChrome } from "./PrecaptureChrome.js";
import { ChartLabels } from "./ChartLabels.js";
import { fmtTokens } from "./format.js";
import { formatShortDate } from "../coverageCopy.js";
import { AGENT_PROVIDERS } from "../../../../shared/models/agent-provider.js";
import type { DailyPoint } from "../../../../shared/models/usage.js";

function bucketTokens(
	days: DailyPoint[],
	domain: Domain,
): Array<Partial<Record<string, number>>> {
	if (domain.mode === "week") {
		return foldDaysToWeeks(
			days.map((d) => ({ dayStartMs: d.dayStartMs, tokens: d.tokens })),
			domain.edges,
		);
	}
	const byDay = new Map(days.map((d) => [d.dayStartMs, d.tokens] as const));
	return domain.edges.slice(0, -1).map((startMs) => byDay.get(startMs) ?? {});
}

export function TokenBurnChart({
	domain,
	days,
	earliestDayMs,
	usageDisabled,
}: {
	domain: Domain;
	days: DailyPoint[];
	earliestDayMs: number | null;
	usageDisabled: boolean;
}): React.ReactElement {
	const buckets = bucketTokens(days, domain);
	const flags = precaptureFlags(domain.edges, earliestDayMs);
	const providers = [...new Set(buckets.flatMap((b) => Object.keys(b)))];
	const config: ChartConfig = Object.fromEntries(
		AGENT_PROVIDERS.map((p) => [
			p.id,
			{ label: p.label.toLowerCase(), color: p.brand },
		]),
	);
	const data = domain.edges.slice(0, -1).map((startMs, i) => ({
		label: String(startMs),
		...buckets[i],
	}));

	return (
		<div className="idb-cell" data-zone="tokens">
			<div className="idb-cell-h">
				<span className="k">
					token burn — {domain.mode === "week" ? "weekly" : "daily"}, est.
				</span>
				<div className="idb-legend">
					{AGENT_PROVIDERS.slice(0, 3).map((p) => (
						<span key={p.id}>
							<span className="sw" style={{ background: p.brand }} />
							{p.label.toLowerCase()}
						</span>
					))}
				</div>
			</div>
			{usageDisabled ? (
				<p className="idb-cell-caption">
					usage telemetry off — enable in settings
				</p>
			) : (
				<>
					<ChartContainer config={config} className="idb-bars">
						<BarChart accessibilityLayer data={data}>
							<XAxis dataKey="label" hide />
							{providers.map((p) => (
								<Bar
									key={p}
									dataKey={p}
									stackId="tokens"
									fill={`var(--color-${p})`}
									isAnimationActive={false}
								/>
							))}
							<ChartTooltip
								content={
									<ChartTooltipContent
										config={config}
										labelFormatter={(l) => formatShortDate(Number(l))}
										valueFormatter={(v) =>
											typeof v === "number" ? fmtTokens(v) : "—"
										}
									/>
								}
							/>
						</BarChart>
					</ChartContainer>
					<PrecaptureChrome edges={domain.edges} flags={flags} />
					<ChartLabels domain={domain} anchorMs={earliestDayMs} />
				</>
			)}
		</div>
	);
}
