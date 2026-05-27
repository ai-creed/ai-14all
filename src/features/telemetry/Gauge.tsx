import { gaugeColor } from "./format.js";

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
			className={`usage-gauge usage-gauge--${level}`}
			role="progressbar"
			aria-valuenow={Math.round(clamped)}
			aria-valuemin={0}
			aria-valuemax={100}
		>
			{Array.from({ length: cells }, (_, i) => (
				<span
					key={i}
					className={i < on ? "usage-gcell is-on" : "usage-gcell"}
				/>
			))}
		</span>
	);
}
