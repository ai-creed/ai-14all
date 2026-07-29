import * as React from "react";
import { ResponsiveContainer, Tooltip } from "recharts";

export type ChartConfig = Record<string, { label: string; color: string }>;

// shadcn chart pattern, minimal vendored subset (spec §2.8): config colors are
// existing app tokens (var(--primary), var(--provider-claude), …) exposed as
// --color-<key> for series fills/strokes. NO --chart-* palette.
export function ChartContainer({
	config,
	className,
	children,
}: {
	config: ChartConfig;
	className?: string;
	children: React.ComponentProps<typeof ResponsiveContainer>["children"];
}) {
	const style = Object.fromEntries(
		Object.entries(config).map(([k, v]) => [`--color-${k}`, v.color]),
	) as React.CSSProperties;
	return (
		<div data-chart className={className} style={style}>
			<ResponsiveContainer width="100%" height="100%">
				{children}
			</ResponsiveContainer>
		</div>
	);
}

export function ChartTooltip(props: React.ComponentProps<typeof Tooltip>) {
	return (
		<Tooltip {...props} cursor={false} wrapperStyle={{ outline: "none" }} />
	);
}

export interface ChartTooltipPayloadItem {
	dataKey?: string;
	name?: string;
	value?: number | string;
	color?: string;
}

// Recharts hands this raw internals by default: whatever the axis' dataKey
// value is (here, a stringified epoch-ms bucket start) as `label`, and each
// series' bare dataKey (e.g. "focusedMs", a provider id) as `name` — neither
// is fit for display. Callers supply `config` to translate a dataKey into
// its human series label (the SAME ChartConfig ChartContainer already reads
// colors from), plus `labelFormatter`/`valueFormatter` to turn the raw axis
// label and per-row values into display text. All three are optional so a
// bare `<ChartTooltipContent />` still renders (falls back to the raw
// values), but every real widget in this app supplies them.
export function ChartTooltipContent({
	active,
	payload,
	label,
	config,
	labelFormatter,
	valueFormatter,
}: {
	active?: boolean;
	payload?: ChartTooltipPayloadItem[];
	label?: string | number;
	config?: ChartConfig;
	labelFormatter?: (label: string | number | undefined) => string;
	valueFormatter?: (
		value: number | string | undefined,
		dataKey: string,
	) => string;
}) {
	if (!active || !payload?.length) return null;
	const displayLabel = labelFormatter ? labelFormatter(label) : label;
	return (
		<div className="idb-tooltip">
			{displayLabel !== undefined && displayLabel !== "" ? (
				<div className="idb-tooltip__label">{displayLabel}</div>
			) : null}
			{payload.map((p, i) => {
				const key = p.dataKey ?? p.name ?? String(i);
				const name = (key && config?.[key]?.label) || p.name || key;
				const value = valueFormatter
					? valueFormatter(p.value, key)
					: typeof p.value === "number"
						? p.value.toLocaleString("en-US")
						: p.value;
				return (
					<div key={key} className="idb-tooltip__row">
						<span className="idb-tooltip__sw" style={{ background: p.color }} />
						{name}: {value}
					</div>
				);
			})}
		</div>
	);
}
