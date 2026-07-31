import { describe, expect, it, vi } from "vitest";
import {
	createSweepRunner,
	DEFAULT_MAX_FILE_FAILURES,
} from "../../../services/usage/sweep-runner.js";
import {
	SweepFileError,
	createSweepState,
} from "../../../services/usage/sweep.js";
import { ingestEvent } from "../../../services/usage/ledger.js";
import { buildSnapshot } from "../../../services/usage/snapshot.js";
import type { SweepState } from "../../../services/usage/sweep.js";
import type {
	UsageEvent,
	UsageSnapshot,
} from "../../../shared/models/usage.js";

// These pin the worker's OWN recovery behaviour, which previously lived inline
// in the Electron shell where no test could reach it: removing the reload
// assignment, the failure counter, or the success signal left every test green.

const event = (billable: number): UsageEvent =>
	({
		provider: "claude",
		cwd: "/Users/me/Dev/app",
		model: "m",
		sessionId: "s1",
		timestampMs: Date.parse("2026-05-01T00:00:00.000Z"),
		input: 0,
		output: billable,
		billable,
		raw: billable,
	}) as UsageEvent;

// A state carrying `billable` tokens, standing in for "what is on disk".
function stateWith(billable: number): SweepState {
	const s = createSweepState();
	if (billable > 0) ingestEvent(s.ledger, s.session, event(billable), 0);
	return s;
}

const total = (s: SweepState): number => {
	let n = 0;
	for (const buckets of s.ledger.days.values())
		for (const t of buckets.values()) n += t.billable;
	return n;
};

interface Harness {
	runner: ReturnType<typeof createSweepRunner>;
	current: () => SweepState;
	persisted: () => number;
	reloads: () => number;
	quarantines: string[];
}

/**
 * `persistedTotal` is the last atomically-written state. `runSweep` mutates the
 * live state the way a real pass does (dirtying it) before optionally throwing,
 * so "did the runner throw the dirty state away?" is directly observable.
 */
function harness(opts: {
	persistedTotal: number;
	runSweep: (
		s: SweepState,
		onFileDone: (file: string) => void,
	) => Promise<void>;
	persist?: () => void;
	maxFileFailures?: number;
}): Harness {
	let live = stateWith(opts.persistedTotal);
	let reloads = 0;
	const quarantines: string[] = [];
	const runner = createSweepRunner({
		getState: () => live,
		setState: (s) => {
			live = s;
		},
		runSweep: (s, _skip, onFileDone) => opts.runSweep(s, onFileDone),
		persist: opts.persist ?? ((): void => {}),
		reload: () => {
			reloads++;
			return stateWith(opts.persistedTotal); // the durable pair, always
		},
		onQuarantine: (file) => void quarantines.push(file),
		maxFileFailures: opts.maxFileFailures,
	});
	return {
		runner,
		current: () => live,
		persisted: () => opts.persistedTotal,
		reloads: () => reloads,
		quarantines,
	};
}

describe("createSweepRunner", () => {
	it("a clean run resolves true and leaves the swept state in place", async () => {
		const h = harness({
			persistedTotal: 10,
			runSweep: async (s) => {
				ingestEvent(s.ledger, s.session, event(7), 0); // new bytes this pass
			},
		});
		await expect(h.runner.run()).resolves.toBe(true);
		expect(total(h.current())).toBe(17);
		expect(h.reloads()).toBe(0);
	});

	it("a failed sweep resolves false and RELOADS, discarding the half-applied state", async () => {
		const h = harness({
			persistedTotal: 10,
			runSweep: async (s) => {
				// Events reached the ledger before the failure — the exact
				// half-applied state that compounds if it is kept.
				ingestEvent(s.ledger, s.session, event(7), 0);
				throw new SweepFileError("/logs/a.jsonl", new Error("ENOENT"));
			},
		});
		await expect(h.runner.run()).resolves.toBe(false);
		expect(h.reloads()).toBe(1);
		expect(total(h.current())).toBe(10); // back to the durable pair, not 17
	});

	it("repeated failures never inflate the total, however many times they retry", async () => {
		const h = harness({
			persistedTotal: 10,
			runSweep: async (s) => {
				ingestEvent(s.ledger, s.session, event(7), 0);
				throw new SweepFileError("/logs/a.jsonl", new Error("boom"));
			},
		});
		for (let i = 0; i < 5; i++) await h.runner.run();
		expect(total(h.current())).toBe(10);
	});

	it("a persist that throws counts as a FAILED run — no false readiness", async () => {
		const h = harness({
			persistedTotal: 10,
			runSweep: async () => {},
			persist: () => {
				throw new Error("EACCES: usage-ledger.json");
			},
		});
		// This is the case that falsified the re-fork bound: the sweep itself
		// succeeded, so a runner keying off the sweep alone would report ready
		// and re-arm the host's budget on every attempt.
		await expect(h.runner.run()).resolves.toBe(false);
		expect(h.reloads()).toBe(1);
	});

	it("quarantines a file only after N CONSECUTIVE failures", async () => {
		let fail = true;
		const file = "/logs/poison.jsonl";
		const h = harness({
			persistedTotal: 0,
			runSweep: async () => {
				if (fail) throw new SweepFileError(file, new Error("boom"));
			},
		});

		await h.runner.run();
		expect(h.runner.failureCount(file)).toBe(1);
		expect(h.runner.isQuarantined(file)).toBe(false);
		await h.runner.run();
		expect(h.runner.failureCount(file)).toBe(2);
		expect(h.runner.isQuarantined(file)).toBe(false);

		// Third strike — and only now.
		await h.runner.run();
		expect(h.runner.failureCount(file)).toBe(DEFAULT_MAX_FILE_FAILURES);
		expect(h.runner.isQuarantined(file)).toBe(true);
		expect(h.quarantines).toEqual([file]);

		// Once quarantined, a clean pass is possible again.
		fail = false;
		await expect(h.runner.run()).resolves.toBe(true);
	});

	it("a clean run between failures RESETS the counter (consecutive, not cumulative)", async () => {
		let fail = true;
		const file = "/logs/flaky.jsonl";
		const h = harness({
			persistedTotal: 0,
			runSweep: async () => {
				if (fail) throw new SweepFileError(file, new Error("boom"));
			},
		});

		await h.runner.run();
		await h.runner.run();
		expect(h.runner.failureCount(file)).toBe(2);

		fail = false;
		await h.runner.run(); // clean
		expect(h.runner.failureCount(file)).toBe(0);

		fail = true;
		await h.runner.run();
		expect(h.runner.failureCount(file)).toBe(1);
		expect(h.runner.isQuarantined(file)).toBe(false); // never reached 3 in a row
	});

	// "Consecutive" is per FILE, not per pass: A succeeding during the pass that
	// B fails must reset A. Clearing counters only on a wholly clean sweep let an
	// unrelated poison file freeze A's count and eventually quarantine a
	// perfectly healthy file, suppressing its usage data until restart.
	it("a file that succeeds has its streak cleared even when a LATER file fails the pass", async () => {
		const A = "/logs/a.jsonl";
		const B = "/logs/b.jsonl";
		let failing: string | null = A;
		const h = harness({
			persistedTotal: 0,
			runSweep: async (_s, onFileDone) => {
				if (failing === A) throw new SweepFileError(A, new Error("boom"));
				onFileDone(A);
				if (failing === B) throw new SweepFileError(B, new Error("boom"));
				onFileDone(B);
			},
		});

		await h.runner.run(); // A fails
		await h.runner.run(); // A fails
		expect(h.runner.failureCount(A)).toBe(2);

		failing = B; // A now succeeds; B aborts the pass
		await h.runner.run();
		expect(h.runner.failureCount(A)).toBe(0); // streak broken
		expect(h.runner.failureCount(B)).toBe(1);

		failing = A;
		await h.runner.run();
		expect(h.runner.failureCount(A)).toBe(1); // NOT 3
		expect(h.runner.isQuarantined(A)).toBe(false);
		expect(h.quarantines).toEqual([]);
	});

	it("passes its quarantine set to the sweep, so a poison file is actually skipped", async () => {
		const file = "/logs/poison.jsonl";
		const skipChecks: boolean[] = [];
		let fail = true;
		const runner = createSweepRunner({
			getState: () => createSweepState(),
			setState: () => {},
			runSweep: async (_s, skipFile) => {
				skipChecks.push(skipFile(file));
				if (fail) throw new SweepFileError(file, new Error("boom"));
			},
			persist: () => {},
			reload: () => createSweepState(),
			maxFileFailures: 2,
		});

		await runner.run();
		await runner.run(); // quarantines
		fail = false;
		await runner.run();

		expect(skipChecks).toEqual([false, false, true]);
	});

	it("a non-SweepFileError failure still reloads, but blames no file", async () => {
		const onError = vi.fn();
		let live = createSweepState();
		const runner = createSweepRunner({
			getState: () => live,
			setState: (s) => {
				live = s;
			},
			runSweep: async () => {
				throw new Error("something else entirely");
			},
			persist: () => {},
			reload: () => createSweepState(),
			onError,
			onQuarantine: () => {
				throw new Error("must not quarantine without a file");
			},
		});
		await expect(runner.run()).resolves.toBe(false);
		expect(onError).toHaveBeenCalledTimes(1);
	});
});

// Diagnosis §3.6 requires the replacement contract asserted where CONSUMERS see
// it — the UsageSnapshot — not at internal SweepState fields. Deriving
// `hasData` from the persisted all-time ledger (explicitly rejected, since
// shared/models/usage.ts defines it as "produced >= 1 event this run") would
// regress with internal-only assertions still green; verified by simulating
// that projection, which fails the hasData assertion below.
describe("run-scoped state across a worker replacement (snapshot layer)", () => {
	const snapshotOf = (s: SweepState): UsageSnapshot =>
		buildSnapshot({
			ledger: s.ledger,
			session: s.session,
			known: [],
			activeWorktreeIds: [],
			nowMs: Date.parse("2026-05-01T12:00:00.000Z"),
			includeUntracked: true,
			chipRange: "week",
			providersWithData: s.providersWithData,
			codexLimits: s.codexLimits,
		});

	const hasData = (snap: UsageSnapshot, id: string): boolean =>
		snap.providers.find((p) => p.id === id)?.hasData ?? false;

	function before(): SweepState {
		const s = createSweepState();
		ingestEvent(s.ledger, s.session, event(10), 0);
		s.providersWithData.add("claude");
		return s;
	}

	// What loadPersistedState hands a REPLACEMENT worker: durable ledger
	// restored, run-scoped fields freshly constructed.
	function afterReplacement(prev: SweepState): SweepState {
		const s = createSweepState(prev.offsets);
		s.ledger = prev.ledger;
		s.codexLimits = prev.codexLimits;
		return s;
	}

	it("the ledger total survives replacement unchanged", () => {
		const prev = before();
		const snapBefore = snapshotOf(prev);
		const snapAfter = snapshotOf(afterReplacement(prev));
		expect(snapAfter.scopes["all-time"].totalTokens).toBe(
			snapBefore.scopes["all-time"].totalTokens,
		);
		expect(snapAfter.scopes["all-time"].totalTokens).toBe(10);
	});

	it("scopes.session and seriesHourly reset, and hasData goes false despite all-time history", () => {
		const prev = before();
		expect(snapshotOf(prev).scopes.session.totalTokens).toBe(10);
		expect(hasData(snapshotOf(prev), "claude")).toBe(true);

		const snap = snapshotOf(afterReplacement(prev));
		expect(snap.scopes.session.totalTokens).toBe(0);
		expect(snap.scopes.session.rows).toEqual([]);
		expect(snap.seriesHourly).toEqual([]);
		// Load-bearing: all-time history is present (10 above) yet hasData is
		// false, because it means "this run".
		expect(hasData(snap, "claude")).toBe(false);
	});

	it("post-replacement activity repopulates run scope without double-counting the ledger", () => {
		const prev = before();
		const next = afterReplacement(prev);
		ingestEvent(next.ledger, next.session, event(4), 0);
		next.providersWithData.add("claude");

		const snap = snapshotOf(next);
		expect(hasData(snap, "claude")).toBe(true);
		expect(snap.scopes.session.totalTokens).toBe(4); // post-replacement only
		expect(snap.scopes["all-time"].totalTokens).toBe(14); // 10 + 4, not 20
	});
});
