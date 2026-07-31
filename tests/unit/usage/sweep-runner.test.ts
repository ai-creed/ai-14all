import { describe, expect, it, vi } from "vitest";
import {
	createSweepRunner,
	DEFAULT_MAX_FILE_FAILURES,
} from "../../../services/usage/sweep-runner.js";
import {
	SweepFileError,
	createSweepState,
} from "../../../services/usage/sweep.js";
import {
	createLedger,
	createSession,
	ingestEvent,
} from "../../../services/usage/ledger.js";
import type { SweepState } from "../../../services/usage/sweep.js";
import type { UsageEvent } from "../../../shared/models/usage.js";

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
	runSweep: (s: SweepState) => Promise<void>;
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
		runSweep: (s) => opts.runSweep(s),
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

describe("run-scoped state across a worker replacement", () => {
	it("session and providersWithData start empty while the ledger carries over", () => {
		// What loadPersistedState hands a REPLACEMENT worker: the durable ledger,
		// and run-scoped fields freshly constructed. Both are "this run" by the
		// shared contract (shared/models/usage.ts), so reconstructing them would
		// either double-count or redefine the contract.
		const before = createSweepState();
		ingestEvent(before.ledger, before.session, event(10), 0);
		before.providersWithData.add("claude");
		expect(before.session.since.size).toBeGreaterThan(0);

		const after = createSweepState(before.offsets);
		after.ledger = before.ledger; // what the persisted pair restores

		expect(total(after)).toBe(total(before));
		expect(after.session.since.size).toBe(0);
		expect(after.session.hourly.size).toBe(0);
		expect(after.providersWithData.size).toBe(0);
	});

	it("post-replacement activity repopulates run scope without touching the ledger total twice", () => {
		const after = createSweepState();
		after.ledger = createLedger();
		after.session = createSession();
		ingestEvent(after.ledger, after.session, event(10), 0);
		after.providersWithData.add("claude");

		expect(total(after)).toBe(10);
		expect(after.providersWithData.has("claude")).toBe(true);
	});
});
