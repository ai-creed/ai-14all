import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UtilityProcess } from "electron";
import { UsageHost } from "../../../electron/main/services/usage-host.js";
import type {
	MainToWorker,
	WorkerToMain,
} from "../../../services/usage/worker-protocol.js";
import type { UsageRangeQuery } from "../../../shared/models/usage.js";
import {
	UsageTelemetrySettingsSchema,
	type UsageTelemetrySettings,
} from "../../../shared/models/persisted-workspace-state.js";

afterEach(() => {
	vi.restoreAllMocks();
});

// Fake utilityProcess: an EventEmitter with postMessage + kill. Cast to
// UtilityProcess at the injection seam (the host only touches on/postMessage/
// kill), mirroring the harness tests/unit/insights/insights-host.test.ts uses
// for InsightsHost's identical `forkWorker` DI seam.
type FakeProc = EventEmitter & {
	postMessage: ReturnType<typeof vi.fn>;
	kill: ReturnType<typeof vi.fn>;
};
function fakeProc(): FakeProc {
	const proc = new EventEmitter() as FakeProc;
	proc.postMessage = vi.fn();
	proc.kill = vi.fn();
	return proc;
}
const asProc = (p: FakeProc): UtilityProcess => p as unknown as UtilityProcess;

function makeSettings(
	over: Partial<UsageTelemetrySettings> = {},
): UsageTelemetrySettings {
	return UsageTelemetrySettingsSchema.parse(over);
}

function hostOpts(
	settingsOverrides: Partial<UsageTelemetrySettings> = {},
	forkWorker?: () => UtilityProcess,
) {
	return {
		userDataDir: "/tmp/ud",
		launchMs: 0,
		send: () => {},
		loadSettings: () => makeSettings(settingsOverrides),
		persistSettings: () => {},
		forkWorker,
	};
}

// Starts a host with a fake proc wired up through spawn, so postMessage() calls
// flush straight through rather than queueing in `pending`.
function startedWithFakeProc(
	settingsOverrides: Partial<UsageTelemetrySettings> = {},
): { host: UsageHost; proc: FakeProc } {
	const proc = fakeProc();
	const host = new UsageHost(hostOpts(settingsOverrides, () => asProc(proc)));
	host.start();
	proc.emit("spawn");
	return { host, proc };
}

const sentQueryRange = (
	proc: FakeProc,
): Extract<MainToWorker, { kind: "queryRange" }> | undefined =>
	proc.postMessage.mock.calls
		.map((c) => c[0] as MainToWorker)
		.find((m) => m.kind === "queryRange") as
		| Extract<MainToWorker, { kind: "queryRange" }>
		| undefined;

const rangeResultOf = (
	requestId: string | undefined,
	overrides: Partial<WorkerToMain & { kind: "rangeResult" }> = {},
): WorkerToMain =>
	({
		kind: "rangeResult",
		requestId: requestId ?? "",
		result: {
			days: [],
			byWorkspace: [],
			byProvider: [],
			cost: {
				perProvider: {},
				total: 0,
				currency: "USD",
				notional: true,
				unpricedTokens: 0,
			},
			earliestDayMs: null,
		},
		...overrides,
	}) as WorkerToMain;

describe("UsageHost.queryRange", () => {
	it("no worker (telemetry disabled / E2E fixture mode): resolves disabled", async () => {
		const host = new UsageHost(hostOpts()); // start() never called
		await expect(host.queryRange({ fromMs: 0, toMs: 1 })).resolves.toEqual({
			ok: false,
			reason: "disabled",
		});
	});

	it("correlates rangeResult by requestId", async () => {
		const { host, proc } = startedWithFakeProc();
		const p = host.queryRange({ fromMs: 0, toMs: 86_400_000 });

		const posted = sentQueryRange(proc);
		expect(posted).toBeDefined();
		expect(posted?.query).toEqual({ fromMs: 0, toMs: 86_400_000 });

		proc.emit("message", rangeResultOf(posted?.requestId));

		await expect(p).resolves.toMatchObject({ ok: true, earliestDayMs: null });
	});

	it("a result for a DIFFERENT requestId does not resolve an in-flight queryRange", async () => {
		const { host, proc } = startedWithFakeProc();
		const p = host.queryRange({ fromMs: 0, toMs: 1 });
		let settled = false;
		void p.then(() => {
			settled = true;
		});

		proc.emit("message", rangeResultOf("r-999"));
		await Promise.resolve();
		expect(settled).toBe(false);

		// Clean up the still-pending promise so it doesn't leak a timer.
		const posted = sentQueryRange(proc);
		proc.emit("message", rangeResultOf(posted?.requestId));
		await p;
	});

	it("times out to { ok:false, reason:'timeout' } after 2s", async () => {
		vi.useFakeTimers();
		try {
			const { host } = startedWithFakeProc();
			const p = host.queryRange({ fromMs: 0, toMs: 1 });
			vi.advanceTimersByTime(2001);
			await expect(p).resolves.toEqual({ ok: false, reason: "timeout" });
		} finally {
			vi.useRealTimers();
		}
	});

	it("includeUntracked: false CANNOT affect queryRange (decision 14): the wire message carries no untracked flag and the result passes through untouched", async () => {
		const { host, proc } = startedWithFakeProc({ includeUntracked: false });
		const p = host.queryRange({ fromMs: 0, toMs: 86_400_000 });

		const posted = sentQueryRange(proc) as unknown as Record<string, unknown>;
		expect(posted).toBeDefined();
		expect("includeUntracked" in posted).toBe(false);
		expect(
			"includeUntracked" in (posted.query as Record<string, unknown>),
		).toBe(false);

		const untrackedRow = {
			workspaceId: null,
			worktreeId: null,
			worktreePath: null,
			worktreeTitle: "untracked",
			provider: "ezio" as const,
			active: false,
			tokens: { input: 30, output: 0, billable: 30, raw: 30 },
			costUsd: 0.01,
		};
		proc.emit(
			"message",
			rangeResultOf((posted as unknown as { requestId: string }).requestId, {
				result: {
					days: [],
					byWorkspace: [untrackedRow],
					byProvider: [],
					cost: {
						perProvider: {},
						total: 0.01,
						currency: "USD",
						notional: true,
						unpricedTokens: 0,
					},
					earliestDayMs: 0,
				},
			} as never),
		);

		const r = await p;
		expect(r.ok).toBe(true);
		// The untracked row SURVIVES the host with the config off — no filtering
		// seam exists between the worker's reply and the caller.
		expect(
			(r as { ok: true; byWorkspace: unknown[] }).byWorkspace,
		).toHaveLength(1);
	});

	it("no worker AND a degenerate range: resolves disabled, not timeout (telemetry-off must never present as retryable)", async () => {
		const host = new UsageHost(hostOpts()); // start() never called -> no worker
		await expect(
			host.queryRange({ fromMs: 100, toMs: 100 }), // degenerate: not strictly ascending
		).resolves.toEqual({ ok: false, reason: "disabled" });
		await expect(
			host.queryRange({ fromMs: 0, toMs: Number.POSITIVE_INFINITY }),
		).resolves.toEqual({ ok: false, reason: "disabled" });
	});

	// Degenerate-input defense ONLY: a descending/non-ascending range, NaN, or
	// a non-finite bound. Span SIZE is deliberately never checked here — two
	// earlier revisions of this guard tried to bound span size (first a
	// direct >10-year rejection, then a worker-side walk clamp meant to
	// replace it), and BOTH turned out to be misplaced policy: §4.7/AC3
	// require `all` to start at the real min(earliestDayMs, anchors) with NO
	// exception, so a legitimately deep ledger must never be rejected OR
	// silently truncated (see useInsightsDashboardData.ts's `all`-range
	// handling). There is no span-size defense anywhere in this path anymore:
	// services/usage/range.ts emits `days` SPARSELY (one point per ledger day
	// WITH DATA, not one per calendar day), so its cost is bounded by the
	// ledger's own real size — see the acceptance test below for the span
	// this guard now happily lets through.
	it("rejects ONLY degenerate ranges (non-finite bounds, or toMs <= fromMs) as a caller bug (timeout) — WITHOUT ever forwarding them to the worker", async () => {
		const { host, proc } = startedWithFakeProc();

		const badRanges: UsageRangeQuery[] = [
			{ fromMs: 100, toMs: 100 }, // not strictly ascending
			{ fromMs: 100, toMs: 50 }, // descending
			{ fromMs: Number.NaN, toMs: 1 },
			{ fromMs: 0, toMs: Number.POSITIVE_INFINITY },
		];
		for (const query of badRanges) {
			await expect(host.queryRange(query)).resolves.toEqual({
				ok: false,
				reason: "timeout",
			});
		}
		expect(
			proc.postMessage.mock.calls.some(
				(c) => (c[0] as MainToWorker).kind === "queryRange",
			),
		).toBe(false);
	});

	it("accepts a legitimate, now-anchored 11-year window — forwarded, not rejected (span size is no longer a rejection reason)", async () => {
		// Would have been rejected outright by the (now-removed) 10-year span
		// cap — this is exactly the shape of window a long-lived `all`-range
		// ledger legitimately needs (see range.test.ts's matching 11-year-deep
		// ledger fixture, and the e2e boundary test for this end-to-end).
		const { host, proc } = startedWithFakeProc();
		const now = Date.now();
		const ELEVEN_YEARS_MS = 11 * 366 * 86_400_000;

		const p = host.queryRange({
			fromMs: now - ELEVEN_YEARS_MS,
			toMs: now,
		});

		const posted = sentQueryRange(proc);
		expect(posted).toBeDefined();
		expect(posted?.query.fromMs).toBe(now - ELEVEN_YEARS_MS);
		expect(posted?.query.toMs).toBe(now);

		proc.emit("message", rangeResultOf(posted?.requestId));
		await expect(p).resolves.toMatchObject({ ok: true });
	});
});

// Regression: the usage worker dying mid-session must not silently wedge every
// later read. Observed in a packaged v1.9.0 app after ~26h uptime — the usage
// utilityProcess was gone (one node.mojom.NodeService in the process tree where
// the app forks two workers; usage-ledger.json frozen 20+ min while the insights
// store kept advancing), yet UsageHost had never noticed: it registers "message"
// and "spawn" handlers but NO "exit" handler, so `this.proc` stays non-null,
// every queryRange posts into a dead pipe, and the 2s timer is the only thing
// that ever settles it. The insights dashboard maps a usage `timeout` to its
// error state, so the whole view reads "the local insights database could not be
// read" — permanently, since retry re-runs the same dead-pipe read.
// InsightsHost already handles exactly this (insights-host.ts's proc.on("exit")
// re-fork, bounded by MAX_CONSECUTIVE_REFORKS); UsageHost must too.
describe("UsageHost worker-crash recovery", () => {
	// Multi-proc fork factory: each start()/re-fork gets the next fake proc, so
	// a replacement worker is observable (the single-proc startedWithFakeProc
	// helper above cannot express a re-fork).
	function startedWithForkQueue(count: number): {
		host: UsageHost;
		procs: FakeProc[];
		forks: () => number;
	} {
		const procs = Array.from({ length: count }, () => fakeProc());
		let forked = 0;
		const host = new UsageHost(
			hostOpts({}, () => asProc(procs[forked++] ?? procs[procs.length - 1])),
		);
		host.start();
		procs[0].emit("spawn");
		return { host, procs, forks: () => forked };
	}

	it("re-forks a replacement worker when the worker exits unexpectedly", () => {
		const { procs, forks } = startedWithForkQueue(2);
		expect(forks()).toBe(1);

		procs[0].emit("exit", 1); // crash, not a deliberate stop()

		expect(forks()).toBe(2);
	});

	it("queryRange after a worker crash is answered, not left to time out", async () => {
		vi.useFakeTimers();
		try {
			const { host, procs } = startedWithForkQueue(2);
			procs[0].emit("exit", 1);
			procs[1].emit("spawn");

			const p = host.queryRange({ fromMs: 0, toMs: 86_400_000 });

			// The replacement worker receives the read and answers it.
			const posted = sentQueryRange(procs[1]);
			expect(posted).toBeDefined();
			procs[1].emit("message", rangeResultOf(posted?.requestId));

			await expect(p).resolves.toMatchObject({ ok: true });
		} finally {
			vi.useRealTimers();
		}
	});

	it("a deliberate stop() does NOT resurrect the worker", () => {
		const { host, procs, forks } = startedWithForkQueue(2);
		host.stop();
		procs[0].emit("exit", 0);
		expect(forks()).toBe(1);
	});
});

// Coverage for the re-fork budget (diagnosis §3.4). The budget must be keyed on
// the worker's explicit `ready` message — NOT on any message: `snapshot` is
// emitted progressively DURING the initial sweep and `rangeResult` is answered
// straight off the in-memory ledger, so a worker that always dies mid-sweep
// would reset the budget before every exit and re-fork forever.
describe("UsageHost re-fork budget", () => {
	function startedWithForkQueue(count: number): {
		host: UsageHost;
		procs: FakeProc[];
		forks: () => number;
	} {
		const procs = Array.from({ length: count }, () => fakeProc());
		let forked = 0;
		const host = new UsageHost(
			hostOpts({}, () => asProc(procs[forked++] ?? procs[procs.length - 1])),
		);
		host.start();
		procs[0].emit("spawn");
		return { host, procs, forks: () => forked };
	}

	it("gives up after 5 consecutive exits with no `ready` in between", () => {
		const { procs, forks } = startedWithForkQueue(12);
		// Each replacement dies without ever reporting ready.
		for (let i = 0; i < 10; i++) procs[i].emit("exit", 1);
		// 1 initial + 5 re-forks, then the host stops trying.
		expect(forks()).toBe(6);
	});

	it("a progress snapshot does NOT restore the budget — only `ready` does", () => {
		const { procs, forks } = startedWithForkQueue(12);
		for (let i = 0; i < 10; i++) {
			// A worker that emits a progressive snapshot and then dies mid-sweep is
			// exactly the unbounded-loop case; it must still be counted.
			procs[i].emit("message", {
				kind: "snapshot",
				snapshot: { generatedAtMs: 0 } as never,
			});
			procs[i].emit("exit", 1);
		}
		expect(forks()).toBe(6);
	});

	it("`ready` restores the budget, so an occasional crash never exhausts it", () => {
		const { procs, forks } = startedWithForkQueue(20);
		for (let i = 0; i < 10; i++) {
			procs[i].emit("message", { kind: "ready" });
			procs[i].emit("exit", 1);
			procs[i + 1]?.emit("spawn");
		}
		expect(forks()).toBe(11); // every death was re-forked
	});

	it("in-flight reads settle as `disabled` when the worker exits, not after the 2s timeout", async () => {
		const { host, procs } = startedWithForkQueue(2);
		const p = host.queryRange({ fromMs: 0, toMs: 86_400_000 });
		procs[0].emit("exit", 1);
		// Resolves from the exit handler itself — no fake timers needed, so this
		// would hang if the read were still waiting on RANGE_TIMEOUT_MS.
		await expect(p).resolves.toEqual({ ok: false, reason: "disabled" });
	});

	// `settings:write` calls setEnabled for EVERY usage-telemetry patch (chip
	// range, include-untracked, even an insights-only change), so an
	// unconditional reset there is a second way to re-arm a crash loop with no
	// healthy worker — the exact thing the readiness-only rule exists to stop.
	it("a repeated setEnabled(true) from an unrelated settings patch does NOT re-arm the budget", () => {
		const { host, procs, forks } = startedWithForkQueue(12);
		for (let i = 0; i < 10; i++) procs[i].emit("exit", 1);
		expect(forks()).toBe(6); // budget spent
		expect(host.hasGivenUp).toBe(true);

		// Telemetry was already enabled; this is a chip-range/untracked patch.
		host.setEnabled(true);
		host.setEnabled(true);

		expect(forks()).toBe(6); // still spent — no new worker
		expect(host.hasGivenUp).toBe(true);
	});

	it("a real disable -> enable transition DOES clear the budget", () => {
		const { host, procs, forks } = startedWithForkQueue(12);
		for (let i = 0; i < 10; i++) procs[i].emit("exit", 1);
		expect(forks()).toBe(6);
		expect(host.hasGivenUp).toBe(true);

		host.setEnabled(false); // user turns telemetry off...
		host.setEnabled(true); // ...then back on: a genuine transition
		expect(forks()).toBe(7);
		expect(host.hasGivenUp).toBe(false);
	});
});
