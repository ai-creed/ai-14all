import {
	mkdtempSync,
	mkdirSync,
	writeFileSync,
	existsSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UtilityProcess } from "electron";
import { InsightsHost } from "../../../electron/main/services/insights-host.js";
import type {
	InsightsWorkerToMain,
	MainToInsightsWorker,
} from "../../../services/insights/worker-protocol.js";

const dirs: string[] = [];
const ud = (): string => {
	const d = mkdtempSync(join(tmpdir(), "ih-"));
	dirs.push(d);
	return d;
};
afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// Fake utilityProcess: an EventEmitter with postMessage + kill. Cast to
// UtilityProcess at the injection seam (the host only touches on/postMessage/kill).
type FakeProc = EventEmitter & {
	postMessage: ReturnType<typeof vi.fn>;
	kill: ReturnType<typeof vi.fn>;
};
function fakeProc(): FakeProc {
	const proc = new EventEmitter() as FakeProc;
	proc.postMessage = vi.fn((m: MainToInsightsWorker) => {
		proc.emit("__sent", m);
	});
	proc.kill = vi.fn();
	return proc;
}
const asProc = (p: FakeProc): UtilityProcess => p as unknown as UtilityProcess;

const STATUS: InsightsWorkerToMain = {
	kind: "status",
	status: {
		lastPollAt: 1,
		observationCount: 1,
		whisperAvailable: true,
		firstCaptureAt: 123,
	},
};

describe("InsightsHost", () => {
	it("delete-all is host-owned, idempotent, and safe when the store is absent (even while disabled)", async () => {
		const userDataDir = ud();
		const insightsDir = join(userDataDir, "insights");
		mkdirSync(insightsDir, { recursive: true });
		writeFileSync(join(insightsDir, "insights.db"), "x");
		const host = new InsightsHost({
			userDataDir,
			whisperDbPath: null,
			pollIntervalMs: 3000,
			forkWorker: () => asProc(fakeProc()),
			send: () => {},
			loadNoticeShown: () => false,
			persistNoticeShown: () => {},
		});
		host.setEnabled(false); // disabled → no worker

		await host.deleteAll(); // 1st call: removes the store
		expect(existsSync(insightsDir)).toBe(false);
		await expect(host.deleteAll()).resolves.toBeUndefined(); // 2nd call: dir already gone → resolves, no throw
		expect(existsSync(insightsDir)).toBe(false);

		// A store that NEVER existed: delete-all still resolves and leaves nothing (rm force:true).
		const freshUserData = ud();
		const freshHost = new InsightsHost({
			userDataDir: freshUserData,
			whisperDbPath: null,
			pollIntervalMs: 3000,
			forkWorker: () => asProc(fakeProc()),
			send: () => {},
			loadNoticeShown: () => false,
			persistNoticeShown: () => {},
		});
		await expect(freshHost.deleteAll()).resolves.toBeUndefined();
		expect(existsSync(join(freshUserData, "insights"))).toBe(false);
	});

	it("does not fork a worker while disabled (master kill / opt-out)", () => {
		const fork = vi.fn(() => asProc(fakeProc()));
		const host = new InsightsHost({
			userDataDir: ud(),
			whisperDbPath: null,
			pollIntervalMs: 3000,
			forkWorker: fork,
			send: () => {},
			loadNoticeShown: () => false,
			persistNoticeShown: () => {},
		});
		host.setEnabled(false);
		expect(fork).not.toHaveBeenCalled();
	});

	it("delivers the notice at most once per session and never after ack", () => {
		const userDataDir = ud();
		const proc = fakeProc();
		let shown = false;
		const onNotice = vi.fn();
		const host = new InsightsHost({
			userDataDir,
			whisperDbPath: join(userDataDir, "state.db"),
			pollIntervalMs: 3000,
			forkWorker: () => asProc(proc),
			send: (ch) => {
				if (ch === "insights:notice") onNotice();
			},
			loadNoticeShown: () => shown,
			persistNoticeShown: (v) => {
				shown = v;
			},
		});
		host.setEnabled(true);
		proc.emit("spawn");
		proc.emit("message", STATUS);
		proc.emit("message", STATUS); // second poll — must NOT re-deliver (session guard)
		expect(onNotice).toHaveBeenCalledTimes(1);
		host.ackNotice(); // persists shown=true + sets the session guard
		proc.emit("message", STATUS); // after ack — still no delivery
		expect(onNotice).toHaveBeenCalledTimes(1);
	});

	it("re-delivers an UNACKNOWLEDGED notice after a worker restart, then stays suppressed once acked", () => {
		const userDataDir = ud();
		let shown = false;
		const onNotice = vi.fn();
		let proc = fakeProc();
		const host = new InsightsHost({
			userDataDir,
			whisperDbPath: null,
			pollIntervalMs: 3000,
			forkWorker: () => asProc(proc),
			send: (ch) => {
				if (ch === "insights:notice") onNotice();
			},
			loadNoticeShown: () => shown,
			persistNoticeShown: (v) => {
				shown = v;
			},
		});

		host.setEnabled(true);
		proc.emit("spawn");
		proc.emit("message", STATUS);
		expect(onNotice).toHaveBeenCalledTimes(1); // session 1 delivery (unacknowledged)

		host.setEnabled(false); // worker stops → session guard resets
		proc = fakeProc();
		host.setEnabled(true);
		proc.emit("spawn");
		proc.emit("message", STATUS);
		expect(onNotice).toHaveBeenCalledTimes(2); // session 2 RE-delivers (still unacknowledged)

		host.ackNotice(); // durable ack persists shown=true
		host.setEnabled(false);
		proc = fakeProc();
		host.setEnabled(true);
		proc.emit("spawn");
		proc.emit("message", STATUS);
		expect(onNotice).toHaveBeenCalledTimes(2); // no re-delivery after ack (durable suppression via loadNoticeShown)
	});

	it("isNoticePending: true once a first capture is seen; false after ack or a durable noticeShown", () => {
		const userDataDir = ud();
		let shown = false;
		const proc = fakeProc();
		const host = new InsightsHost({
			userDataDir,
			whisperDbPath: null,
			pollIntervalMs: 3000,
			forkWorker: () => asProc(proc),
			send: () => {},
			loadNoticeShown: () => shown,
			persistNoticeShown: (v) => {
				shown = v;
			},
		});

		// No first capture observed yet → nothing pending (recovery must not fire
		// before capture actually starts).
		expect(host.isNoticePending()).toBe(false);

		host.setEnabled(true);
		proc.emit("spawn");
		proc.emit("message", STATUS); // status carries firstCaptureAt → capture started
		// The boot-time push reached no listener (no `send` assertion here), but the
		// pull path must now report the notice as recoverable.
		expect(host.isNoticePending()).toBe(true);

		host.ackNotice(); // in-process ack + durable persist
		expect(host.isNoticePending()).toBe(false);
	});

	it("isNoticePending: a durable noticeShown alone suppresses it (relaunch, still enabled, store kept)", () => {
		const userDataDir = ud();
		const proc = fakeProc();
		// Fresh host (acknowledged=false) but the previous session persisted the ack.
		const host = new InsightsHost({
			userDataDir,
			whisperDbPath: null,
			pollIntervalMs: 3000,
			forkWorker: () => asProc(proc),
			send: () => {},
			loadNoticeShown: () => true, // durable marker from a prior acked session
			persistNoticeShown: () => {},
		});
		host.setEnabled(true);
		proc.emit("spawn");
		proc.emit("message", STATUS); // first capture seen again (persisted firstCaptureAt)
		expect(host.isNoticePending()).toBe(false); // durable suppression, no in-process ack needed
	});

	it("query(): posts a correlated whisperRuns request and resolves on the matching queryResult (a mismatched id does NOT resolve it)", async () => {
		const proc = fakeProc();
		const host = new InsightsHost({
			userDataDir: ud(),
			whisperDbPath: null,
			pollIntervalMs: 3000,
			forkWorker: () => asProc(proc),
			send: () => {},
			loadNoticeShown: () => false,
			persistNoticeShown: () => {},
		});
		host.setEnabled(true);
		proc.emit("spawn");

		const range = { fromMs: 10, toMs: 20 };
		let settled: unknown = "pending";
		const done = host.query(range).then((r) => {
			settled = r;
		});

		// It posted a correlated query naming whisperRuns and carrying the range.
		const sent = proc.postMessage.mock.calls.map(
			(c) => c[0] as MainToInsightsWorker,
		);
		const queryMsg = sent.find((m) => m.kind === "query");
		expect(queryMsg).toEqual({
			kind: "query",
			requestId: "q-1",
			query: { name: "whisperRuns", range },
		});

		// A result for a DIFFERENT requestId must not resolve this query.
		proc.emit("message", {
			kind: "queryResult",
			requestId: "q-999",
			result: { runs: [], completeness: "partial" },
		} satisfies InsightsWorkerToMain);
		await Promise.resolve();
		expect(settled).toBe("pending");

		// The result for the SAME requestId resolves it with that exact payload.
		const RUN = {
			runId: "r1",
			collabId: "c1",
			repoId: null,
			workspaceRel: null,
			workflowType: "sdd",
			status: "completed",
			haltReason: null,
			startedAt: 11,
			endedAt: 12,
			durationMs: 1,
			phaseCount: 2,
		};
		proc.emit("message", {
			kind: "queryResult",
			requestId: "q-1",
			result: { runs: [RUN], completeness: "complete" },
		} satisfies InsightsWorkerToMain);
		await done;
		expect(settled).toEqual({ runs: [RUN], completeness: "complete" });
	});

	it("query(): resolves an empty result when disabled (no worker)", async () => {
		const host = new InsightsHost({
			userDataDir: ud(),
			whisperDbPath: null,
			pollIntervalMs: 3000,
			forkWorker: () => asProc(fakeProc()),
			send: () => {},
			loadNoticeShown: () => false,
			persistNoticeShown: () => {},
		});
		host.setEnabled(false); // no worker
		await expect(host.query({ fromMs: 0, toMs: 1 })).resolves.toEqual({
			runs: [],
			completeness: "unknown",
		});
	});

	it("does NOT re-deliver after ack even if the persist is still pending (async-ack race)", () => {
		const userDataDir = ud();
		const persisted = false; // loadNoticeShown's backing store — flushed LATER, never synchronously on ack (stays false all test)
		const onNotice = vi.fn();
		let proc = fakeProc();
		const host = new InsightsHost({
			userDataDir,
			whisperDbPath: null,
			pollIntervalMs: 3000,
			forkWorker: () => asProc(proc),
			send: (ch) => {
				if (ch === "insights:notice") onNotice();
			},
			loadNoticeShown: () => persisted,
			persistNoticeShown: () => {
				/* deferred: the settings write has NOT flushed, so `persisted` stays false */
			},
		});

		host.setEnabled(true);
		proc.emit("spawn");
		proc.emit("message", STATUS);
		expect(onNotice).toHaveBeenCalledTimes(1);
		host.ackNotice(); // acknowledged=true synchronously; persist NOT yet flushed (persisted still false)
		host.setEnabled(false); // disable immediately after ack → stop() resets sessionNoticeSent
		proc = fakeProc();
		host.setEnabled(true);
		proc.emit("spawn");
		proc.emit("message", STATUS);
		expect(onNotice).toHaveBeenCalledTimes(1); // in-process `acknowledged` guard blocks the stale re-delivery
	});
});
