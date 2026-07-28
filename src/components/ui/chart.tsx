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

export function ChartTooltipContent({
	active,
	payload,
	label,
}: {
	active?: boolean;
	payload?: Array<{ name?: string; value?: number | string; color?: string }>;
	label?: string;
}) {
	if (!active || !payload?.length) return null;
	return (
		<div className="idb-tooltip">
			{label ? <div className="idb-tooltip__label">{label}</div> : null}
			{payload.map((p) => (
				<div key={p.name} className="idb-tooltip__row">
					<span className="idb-tooltip__sw" style={{ background: p.color }} />
					{p.name}:{" "}
					{typeof p.value === "number"
						? p.value.toLocaleString("en-US")
						: p.value}
				</div>
			))}
		</div>
	);
}
