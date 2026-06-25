export type ReconnectBackoff = {
	next: () => number;
	reset: () => void;
	readonly attempt: number;
};

/**
 * Capped exponential backoff with equal jitter, for reconnect loops. `next()`
 * returns the next delay (ms) and advances the attempt counter; `reset()` zeroes
 * it (call on a successful connect). Retries are unbounded — there is no max.
 *
 *   raw   = min(capMs, baseMs * factor ** attempt)
 *   delay = raw / 2 + random() * (raw / 2)     // equal jitter -> [raw/2, raw]
 *
 * Equal jitter keeps a sane floor (never reconnects instantly) while still
 * decorrelating reconnect storms. `random` is injected purely so tests can pin
 * the curve.
 */
export function createReconnectBackoff(opts: {
	baseMs: number;
	factor: number;
	capMs: number;
	random?: () => number;
}): ReconnectBackoff {
	const random = opts.random ?? Math.random;
	let attempt = 0;
	return {
		next(): number {
			const raw = Math.min(opts.capMs, opts.baseMs * opts.factor ** attempt);
			attempt += 1;
			return raw / 2 + random() * (raw / 2);
		},
		reset(): void {
			attempt = 0;
		},
		get attempt(): number {
			return attempt;
		},
	};
}
