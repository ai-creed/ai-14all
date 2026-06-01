import { gaugeColor } from "./format.js";

// Gauge level → Tailwind classes for the "on" cells. Theme-aware: each level is
// driven by a theme token (nominal=--gauge-ok teal, warn=--warning, hot=
// --destructive) so the gauge adapts across the light/dark/warm palettes. The
// glow is a low-opacity mix of the same token.
const levelClasses = {
	ok: "bg-[var(--gauge-ok)] shadow-[0_0_4px_color-mix(in_oklab,var(--gauge-ok)_60%,transparent)]",
	warn: "bg-warning shadow-[0_0_4px_color-mix(in_oklab,var(--warning)_55%,transparent)]",
	hot: "bg-destructive shadow-[0_0_5px_color-mix(in_oklab,var(--destructive)_60%,transparent)]",
} as const;

// Retro-terminal segmented progress bar: discrete cells, dark→glow gradient on
// the filled portion. Threshold-colored (teal → amber → red) so it still
// signals "approaching limit". Style reference: retro-terminal-progress.html.
export function Gauge({
	percent,
	cells = 20, // 20 cells => each cell = 5%
}: {
	percent: number;
	cells?: number;
}) {
	const clamped = Math.max(0, Math.min(percent, 100));
	const on = Math.round((clamped / 100) * cells);
	const level = gaugeColor(clamped);
	return (
		<span
			className="inline-grid grid-flow-col auto-cols-[4px] gap-px h-[5px] items-stretch align-middle"
			role="progressbar"
			aria-valuenow={Math.round(clamped)}
			aria-valuemin={0}
			aria-valuemax={100}
		>
			{Array.from({ length: cells }, (_, i) => (
				<span
					key={i}
					className={
						i < on
							? `w-1 h-[5px] rounded-[1px] opacity-100 ${levelClasses[level]}`
							: "w-1 h-[5px] rounded-[1px] bg-border opacity-60"
					}
				/>
			))}
		</span>
	);
}
