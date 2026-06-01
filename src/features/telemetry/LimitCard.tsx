import type { LimitGauge } from "../../../shared/models/usage.js";
import { Gauge } from "./Gauge.js";
import { formatReset, formatTokens } from "./format.js";

function LimitRow({
	label,
	percent,
	detail,
}: {
	label: string;
	percent: number;
	detail: string;
}) {
	return (
		<div className="grid grid-cols-[3rem_auto_3rem_1fr] items-center gap-2">
			<span className="text-muted-foreground">{label}</span>
			<Gauge percent={percent} />
			<span className="text-right font-semibold text-foreground tabular-nums">
				{percent}%
			</span>
			<span className="text-xs text-muted-foreground">{detail}</span>
		</div>
	);
}

export function LimitCard({
	limit,
	now,
}: {
	limit: LimitGauge;
	now: number;
}): React.ReactElement {
	const fhReset = formatReset(limit.fiveHour.resetsAtMs, now);
	const wkReset = formatReset(limit.weekly.resetsAtMs, now);
	const wkDetail = [
		limit.weekly.budget
			? `${formatTokens(limit.weekly.used ?? 0)} / ${formatTokens(limit.weekly.budget)}`
			: "",
		wkReset ? `resets ${wkReset}` : "",
	]
		.filter(Boolean)
		.join(" · ");
	const color =
		limit.provider === "claude"
			? "text-[var(--provider-claude)]"
			: "text-[var(--provider-codex)]";
	return (
		<div className="flex flex-col gap-1.5">
			<span className={`text-sm font-semibold ${color}`}>{limit.provider}</span>
			<LimitRow
				label="5h"
				percent={limit.fiveHour.percent}
				detail={fhReset ? `resets ${fhReset}` : ""}
			/>
			<LimitRow label="week" percent={limit.weekly.percent} detail={wkDetail} />
		</div>
	);
}
