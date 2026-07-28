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

	it("rejects a degenerate or absurdly wide range as a caller bug (timeout) WITHOUT ever forwarding it to the worker", async () => {
		const { host, proc } = startedWithFakeProc();

		const TEN_YEARS_MS = 10 * 366 * 86_400_000;
		const badRanges: UsageRangeQuery[] = [
			{ fromMs: 100, toMs: 100 }, // not strictly ascending
			{ fromMs: 100, toMs: 50 }, // descending
			{ fromMs: 0, toMs: TEN_YEARS_MS + 1 }, // just over the cap
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

		// A legitimate range right AT the cap is still accepted and forwarded.
		const p = host.queryRange({ fromMs: 0, toMs: TEN_YEARS_MS });
		const posted = sentQueryRange(proc);
		expect(posted).toBeDefined();
		proc.emit("message", rangeResultOf(posted?.requestId));
		await expect(p).resolves.toMatchObject({ ok: true });
	});
});
