import { useEffect, useState } from "react";

/**
 * Returns a millisecond timestamp that updates on a fixed interval.
 *
 * Used by sidebar shell summaries to compute "quiet for N seconds" labels
 * without re-rendering on every microtask.
 */
export function useTickingNow(intervalMs = 1_000): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const handle = window.setInterval(() => setNow(Date.now()), intervalMs);
		return () => window.clearInterval(handle);
	}, [intervalMs]);
	return now;
}
