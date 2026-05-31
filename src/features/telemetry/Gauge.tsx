import { gaugeColor } from "./format.js";

// Gauge level → Tailwind classes for the "on" cells.
// Each level gets a gradient background + glow shadow matching the old CSS.
const levelClasses = {
	ok: "bg-gradient-to-b from-[#b7faff] to-[#7fced2] shadow-[0_0_4px_rgba(127,206,210,0.6)]",
	warn: "bg-gradient-to-b from-[#ffd98a] to-[#d29922] shadow-[0_0_4px_rgba(210,153,34,0.55)]",
	hot: "bg-gradient-to-b from-[#ff9a90] to-[#f85149] shadow-[0_0_5px_rgba(248,81,73,0.6)]",
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
