import {
	type CommandFrame,
	type CommandResult,
	errorResult,
} from "./command-types";

export type Dispatcher = {
	dispatch: (frame: CommandFrame) => Promise<CommandResult>;
};

type Entry =
	| { state: "in-flight"; promise: Promise<CommandResult> }
	| { state: "done"; result: CommandResult; ts: number };

/**
 * Wrap a command dispatcher so duplicate frames (same `requestId`) never
 * re-execute within the TTL window. An in-flight duplicate coalesces onto the
 * running promise; a completed one replays the cached result (errors included).
 *
 * Eviction is TTL-driven and NEVER removes a still-live entry, so exactly-once
 * holds for the full window. If the cache is ever full of live entries — a
 * pathological burst beyond `max` inside the TTL window — a NEW command is
 * refused with a retryable `internal` result rather than evicting a live entry.
 * Refusing a brand-new command cannot double-execute anything; a re-sent frame
 * for an already-processed command always finds its live entry and replays.
 */
export function createIdempotentDispatcher(
	inner: Dispatcher,
	opts: { ttlMs: number; max: number; now?: () => number },
): Dispatcher {
	const now = opts.now ?? Date.now;
	const cache = new Map<string, Entry>();

	function pruneExpired(): void {
		const t = now();
		for (const [key, entry] of cache) {
			if (entry.state === "done" && entry.ts + opts.ttlMs < t)
				cache.delete(key);
		}
	}

	async function dispatch(frame: CommandFrame): Promise<CommandResult> {
		pruneExpired();
		const existing = cache.get(frame.requestId);
		if (existing) {
			if (existing.state === "in-flight") return existing.promise;
			return existing.result;
		}
		// No entry. pruneExpired already reclaimed any expired slot; if the cache
		// is still full, every resident entry is live — refuse the NEW command
		// rather than evict a live one. Nothing executes, so this cannot
		// double-deliver; the caller retries (a fresh requestId, or this one once
		// the window drains).
		if (cache.size >= opts.max) {
			return errorResult(
				frame.requestId,
				"internal",
				"command cache saturated; retry shortly",
			);
		}
		// Record the in-flight entry synchronously. JS is single-threaded, so a
		// concurrent duplicate (a separate dispatch call) only runs after this
		// synchronous block completes and therefore finds the in-flight entry and
		// coalesces. On settle -> store as `done`. On rejection (a bug; the
		// dispatcher/ActGuard are settle-only by the S3 contract) -> drop the entry
		// so the requestId stays retryable, and propagate. The decorator never
		// fabricates an agent outcome; its only synthesized result is the
		// back-pressure refusal above, where nothing ran.
		const promise = inner.dispatch(frame).then(
			(result) => {
				cache.set(frame.requestId, { state: "done", result, ts: now() });
				return result;
			},
			(error) => {
				const entry = cache.get(frame.requestId);
				if (entry && entry.state === "in-flight") cache.delete(frame.requestId);
				throw error;
			},
		);
		cache.set(frame.requestId, { state: "in-flight", promise });
		return promise;
	}

	return { dispatch };
}
