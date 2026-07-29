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
	// a non-finite bound. Span SIZE is deliberately never checked here — an
	// earlier revision of this guard also rejected any span over 10 years,
	// which turned out to be misplaced policy: §4.7/AC3 require `all` to
	// start at the real min(earliestDayMs, anchors) with NO exception, so a
	// legitimately deep ledger must never be rejected as a caller bug (see
	// useInsightsDashboardData.ts's `all`-range handling, whose real-history
	// probe this guard used to break whenever telemetry was enabled and the
	// ledger ran deep). The structural defense against a genuinely absurd
	// span (e.g. a caller-bug `toMs` near 1e18) now lives worker-side,
	// non-rejecting, in services/usage/range.ts's MAX_RANGE_DAYS walk clamp —
	// see the acceptance test below for the span this guard now happily lets
	// through.
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
