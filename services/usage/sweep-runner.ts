import { SweepFileError, type SweepState } from "./sweep.js";

/**
 * The usage worker's failure-recovery brain, extracted from the Electron shell
 * so it can be unit-tested directly (mirrors how the insights worker keeps its
 * logic in an electron-free core).
 *
 * It owns three things the shell used to hold inline, none of which were
 * reachable from a test:
 *
 *  1. **Reload on failure.** A sweep can fail after some events reached the
 *     ledger but before their offsets were committed. Keeping that half-applied
 *     state would make the next sweep re-read the same bytes and inflate the
 *     totals without bound, so a failed run discards in-memory state and
 *     reloads the last atomically persisted ledger+offset pair.
 *  2. **Per-file quarantine.** A file that fails `maxFileFailures` times IN A
 *     ROW is skipped from then on, so one poison file degrades to "that file's
 *     data is missing" instead of failing every sweep forever. A clean run
 *     clears the counters — only consecutive failures count.
 *  3. **An honest success signal.** `run()` resolves `true` only when the sweep
 *     AND its persist both completed. The host's re-fork budget keys off this
 *     (via the worker's `ready` message), so reporting success for a run that
 *     recovered from a failure would un-bound the crash loop.
 */
export interface SweepRunnerDeps {
	getState(): SweepState;
	setState(state: SweepState): void;
	/** Run one full pass, skipping any file the runner has quarantined. */
	runSweep(
		state: SweepState,
		skipFile: (file: string) => boolean,
	): Promise<void>;
	/** Persist the state atomically. May throw; that counts as a failed run. */
	persist(state: SweepState): void;
	/** Reload the last atomically persisted state. */
	reload(): SweepState;
	onQuarantine?(file: string, failures: number): void;
	onError?(err: unknown): void;
	maxFileFailures?: number;
}

export const DEFAULT_MAX_FILE_FAILURES = 3;

export interface SweepRunner {
	/** One pass. Resolves true only if the sweep AND the persist both succeeded. */
	run(): Promise<boolean>;
	isQuarantined(file: string): boolean;
	/** Consecutive failures recorded for `file` (0 once it runs clean). */
	failureCount(file: string): number;
}

export function createSweepRunner(deps: SweepRunnerDeps): SweepRunner {
	const max = deps.maxFileFailures ?? DEFAULT_MAX_FILE_FAILURES;
	const failures = new Map<string, number>();
	const quarantined = new Set<string>();

	return {
		isQuarantined: (file) => quarantined.has(file),
		failureCount: (file) => failures.get(file) ?? 0,
		async run(): Promise<boolean> {
			try {
				await deps.runSweep(deps.getState(), (file) => quarantined.has(file));
				// Inside the try on purpose: a persist that throws leaves the
				// on-disk state behind the in-memory one, which is exactly the
				// divergence the reload below exists to correct.
				deps.persist(deps.getState());
				failures.clear();
				return true;
			} catch (err) {
				const file = err instanceof SweepFileError ? err.file : null;
				if (file) {
					const n = (failures.get(file) ?? 0) + 1;
					failures.set(file, n);
					if (n >= max) {
						quarantined.add(file);
						deps.onQuarantine?.(file, n);
					}
				}
				deps.onError?.(err);
				deps.setState(deps.reload());
				return false;
			}
		},
	};
}
