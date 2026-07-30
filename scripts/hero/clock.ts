export type ClockSample = { cdpTimestamp: number; wallClockAtReceipt: number };
export type Calibration = { offsetMs: number; residualSpreadMs: number };

/**
 * Map CDP frame timestamps (protocol origin deliberately not assumed —
 * TimeSinceEpoch or MonotonicTime both reduce to a constant offset) onto the
 * recorder wall clock. Median rejects outlier receipt latencies. Spec §5.
 */
export function calibrateClock(samples: ClockSample[]): Calibration {
	if (samples.length < 5) {
		throw new Error(
			`clock calibration needs >=5 warmup samples, got ${samples.length}`,
		);
	}
	const diffs = samples
		.map((s) => s.wallClockAtReceipt - s.cdpTimestamp * 1000)
		.sort((a, b) => a - b);
	const mid = Math.floor(diffs.length / 2);
	const offsetMs =
		diffs.length % 2 === 1 ? diffs[mid] : (diffs[mid - 1] + diffs[mid]) / 2;
	const residualSpreadMs = Math.max(
		...diffs.map((d) => Math.abs(d - offsetMs)),
	);
	return { offsetMs, residualSpreadMs };
}

export function cdpToWallMs(cdpTimestamp: number, cal: Calibration): number {
	return cdpTimestamp * 1000 + cal.offsetMs;
}
