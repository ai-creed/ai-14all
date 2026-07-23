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
import type { OutboxEvent } from "../../../services/insights/outbox.js";
import type { AppSpan } from "../../../services/insights/app-focus/focus-core.js";
import { spanToObservation } from "../../../services/insights/app-focus/span-observation.js";
import type { InsightsHostOptions } from "../../../electron/main/services/insights-host.js";

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

const focusedSpan = (a: number, b: number): AppSpan => ({
	kind: "app.focused",
	startMs: a,
	endMs: b,
	reason: "poll",
});
const uptimeSpan = (a: number, b: number): AppSpan => ({
	kind: "app.uptime",
	startMs: a,
	endMs: b,
	reason: "disabled",
});
const evOf = (span: AppSpan): OutboxEvent => {
	const observation = spanToObservation(span, "run-1");
	return { eventId: observation.eventId, observation };
};

// Collector double: records arm/stop and yields a finalizing uptime span on stop.
function fakeCollector(uptime: AppSpan | null = uptimeSpan(0, 100)) {
	return {
		started: 0,
		stopped: 0,
		start() {
			this.started += 1;
		},
		stop(): AppSpan[] {
			this.stopped += 1;
			return uptime ? [uptime] : [];
		},
	};
}

const sent = (p: FakeProc): MainToInsightsWorker[] =>
	p.postMessage.mock.calls.map((c) => c[0] as MainToInsightsWorker);

describe("InsightsHost — producer outbox and lifecycle", () => {
	const baseOpts = (
		over: Partial<InsightsHostOptions>,
	): InsightsHostOptions => ({
		userDataDir: ud(),
		whisperDbPath: null,
		pollIntervalMs: 3000,
		send: () => {},
		loadNoticeShown: () => false,
		persistNoticeShown: () => {},
		...over,
	});

	it("produce posts a producerEvent and buffers it; ack clears the buffer", () => {
		const proc = fakeProc();
		const host = new InsightsHost(baseOpts({ forkWorker: () => asProc(proc) }));
		host.setEnabled(true);
		proc.emit("spawn");

		const ev = evOf(focusedSpan(0, 1000));
		host.produce(ev);
		expect(sent(proc)).toContainEqual({
			kind: "producerEvent",
			eventId: ev.eventId,
			observation: ev.observation,
		});
		expect(host.outboxSize).toBe(1);
		proc.emit("message", { kind: "ack", eventId: ev.eventId });
		expect(host.outboxSize).toBe(0);
	});

	it("an unexpected worker exit re-forks while consent is on, sends config first, then replays", () => {
		let proc = fakeProc();
		const fork = vi.fn(() => asProc(proc));
		const host = new InsightsHost(baseOpts({ forkWorker: fork }));
		host.setEnabled(true);
		proc.emit("spawn");
		const ev = evOf(focusedSpan(0, 1000));
		host.produce(ev); // unacked

		const dead = proc;
		proc = fakeProc();
		dead.emit("exit"); // crash → host must re-fork
		expect(fork).toHaveBeenCalledTimes(2);
		proc.emit("spawn");

		const order = sent(proc).map((m) => m.kind);
		expect(order[0]).toBe("config"); // config BEFORE replay
		expect(sent(proc)).toContainEqual({
			kind: "producerEvent",
			eventId: ev.eventId,
			observation: ev.observation,
		});
	});

	it("does NOT re-fork after an intentional stop", async () => {
		const proc = fakeProc();
		const fork = vi.fn(() => asProc(proc));
		const host = new InsightsHost(baseOpts({ forkWorker: fork }));
		host.setEnabled(true);
		proc.emit("spawn");
		host.setEnabled(false);
		await host.whenIdle();
		proc.emit("exit"); // the kill's own exit — must not resurrect
		expect(fork).toHaveBeenCalledTimes(1);
	});

	it("capture-time consent: a PRE-disable span stays deliverable; a POST-disable span is dropped", async () => {
		const proc = fakeProc();
		const collector = fakeCollector();
		const host = new InsightsHost(
			baseOpts({ forkWorker: () => asProc(proc), collector }),
		);
		host.setEnabled(true);
		proc.emit("spawn");

		// Captured while consent was ON — bounds wholly before the disable instant.
		const preDisable = evOf(focusedSpan(0, 400));
		host.produce(preDisable);

		host.setEnabled(false); // flag flips synchronously; drain still pending

		// Captured AT/AFTER the disable instant — must never reach the worker.
		const postDisable = evOf(focusedSpan(500, 600));
		host.produce(postDisable);

		const producerIds = sent(proc)
			.filter((m) => m.kind === "producerEvent")
			.map((m) => (m as { eventId: string }).eventId);
		// The distinction AC5 requires: pre-disable delivered, post-disable never.
		expect(producerIds).toContain(preDisable.eventId);
		expect(producerIds).not.toContain(postDisable.eventId);
		const kinds = sent(proc)
			.filter((m) => m.kind === "producerEvent")
			.map((m) => (m as { observation: { kind: string } }).observation.kind);
		expect(kinds).toContain("app.uptime"); // finalizing uptime IS delivered
	});

	it("disable drains via the exact closeStore→storeClosed handshake, then tears down and clears", async () => {
		const proc = fakeProc();
		const collector = fakeCollector();
		const host = new InsightsHost(
			baseOpts({ forkWorker: () => asProc(proc), collector }),
		);
		host.setEnabled(true);
		proc.emit("spawn");
		host.produce(evOf(focusedSpan(0, 400))); // an unacked event to be cleared
		expect(host.outboxSize).toBe(1);

		host.setEnabled(false);

		// FIFO ordering (spec §6): the finalizing uptime producerEvent is posted
		// BEFORE closeStore, so the worker inserts that row before closing its DB.
		const msgs = sent(proc);
		const uptimeIdx = msgs.findIndex(
			(m) =>
				m.kind === "producerEvent" &&
				(m as { observation: { kind: string } }).observation.kind ===
					"app.uptime",
		);
		const closeIdx = msgs.findIndex(
			(m) =>
				m.kind === "closeStore" &&
				(m as { requestId: string }).requestId === "disable-drain",
		);
		expect(uptimeIdx).toBeGreaterThanOrEqual(0);
		expect(closeIdx).toBeGreaterThan(uptimeIdx);

		// Teardown waits for the ACTUAL storeClosed: an ack must not release it
		// (this is what fails a regression back to ack-only draining).
		proc.emit("message", { kind: "ack", eventId: "some-other-event" });
		await Promise.resolve();
		expect(proc.kill).not.toHaveBeenCalled();

		proc.emit("message", { kind: "storeClosed", requestId: "disable-drain" });
		await host.whenIdle();
		expect(proc.kill).toHaveBeenCalled();
		expect(host.outboxSize).toBe(0); // AC4: disable clears the buffer
	});

	it("delete-all discards the outbox and restarts capture when consent stays on", async () => {
		let proc = fakeProc();
		const fork = vi.fn(() => asProc(proc));
		const collector = fakeCollector();
		const host = new InsightsHost(baseOpts({ forkWorker: fork, collector }));
		host.setEnabled(true);
		proc.emit("spawn");
		host.produce(evOf(focusedSpan(0, 1000))); // unacked, pre-delete
		expect(host.outboxSize).toBe(1);

		const p = host.deleteAll();
		proc.emit("message", { kind: "storeClosed", requestId: "delete-all" });
		proc = fakeProc();
		await p;

		expect(host.outboxSize).toBe(0); // discarded — cannot replay into the fresh store
		expect(fork).toHaveBeenCalledTimes(2); // restarted, consent still on
		expect(collector.started).toBe(2);
	});

	it("rapid disable→enable: superseded disable clears nothing; the enable replaces the drained worker", async () => {
		const procs: FakeProc[] = [];
		const fork = vi.fn(() => {
			const p = fakeProc();
			procs.push(p);
			return asProc(p);
		});
		const collector = fakeCollector();
		const host = new InsightsHost(baseOpts({ forkWorker: fork, collector }));
		host.setEnabled(true);
		procs[0].emit("spawn");
		const preDisable = evOf(focusedSpan(0, 400)); // unacked engagement
		host.produce(preDisable);
		expect(host.outboxSize).toBe(1);

		host.setEnabled(false); // drain pending — `storeClosed` has NOT arrived
		host.setEnabled(true); // enqueued LATER ⇒ supersedes the in-flight disable
		host.produce(evOf(focusedSpan(700, 800))); // during the disabled window → dropped

		procs[0].emit("message", {
			kind: "storeClosed",
			requestId: "disable-drain",
		});
		await host.whenIdle();

		// Spec §6/§11/AC5: the superseded disable abandoned its teardown, so the
		// buffer survived — proven by the event still being pending and replayed.
		// Two events are still unacked: the pre-disable engagement span AND the
		// finalizing uptime span the disable itself delivered (this fake worker
		// acks neither; a real worker acks the uptime row after it commits). Had
		// the superseded disable cleared the buffer this would be 0, and the
		// config-first replay asserted below would find nothing to replay.
		expect(host.outboxSize).toBe(2);
		// …and the enable replaced the drained (store-closed) worker: a FRESH fork.
		expect(fork).toHaveBeenCalledTimes(2);
		expect(collector.started).toBe(2); // collector re-armed

		procs[1].emit("spawn");
		const replayed = sent(procs[1]);
		expect(replayed[0].kind).toBe("config"); // config before replay
		expect(replayed).toContainEqual({
			kind: "producerEvent",
			eventId: preDisable.eventId,
			observation: preDisable.observation,
		});

		// The REPLACED worker's exit arrives late. It must not clear the live
		// handle or trigger a third fork — the final state has to stay stable.
		procs[0].emit("exit");
		await host.whenIdle();
		expect(fork).toHaveBeenCalledTimes(2); // still exactly the one replacement
		expect(procs).toHaveLength(2);
		// The live worker is still wired: a new span posts to it, not into a void.
		const after = evOf(focusedSpan(900, 1000));
		host.produce(after);
		expect(sent(procs[1])).toContainEqual({
			kind: "producerEvent",
			eventId: after.eventId,
			observation: after.observation,
		});

		// No engagement was captured during the disabled window.
		const focusedOnFirst = sent(procs[0])
			.filter((m) => m.kind === "producerEvent")
			.map((m) => (m as { observation: { kind: string } }).observation.kind)
			.filter((k) => k === "app.focused");
		expect(focusedOnFirst).toHaveLength(1); // only the pre-disable one
	});

	it("delete-all is mutually exclusive with produce/query: mid-wipe calls are refused and never replay", async () => {
		const procs: FakeProc[] = [];
		const fork = vi.fn(() => {
			const p = fakeProc();
			procs.push(p);
			return asProc(p);
		});
		const collector = fakeCollector();
		const host = new InsightsHost(baseOpts({ forkWorker: fork, collector }));
		host.setEnabled(true);
		procs[0].emit("spawn");

		// Hold the wipe open: `storeClosed` is deliberately NOT emitted yet.
		const wipe = host.deleteAll();

		// A span captured mid-wipe must be dropped outright — not buffered, not
		// posted — or it would replay into the freshly created store.
		const midWipe = evOf(focusedSpan(0, 400));
		host.produce(midWipe);
		expect(host.outboxSize).toBe(0);
		expect(
			sent(procs[0]).some(
				(m) =>
					m.kind === "producerEvent" &&
					(m as { eventId: string }).eventId === midWipe.eventId,
			),
		).toBe(false);

		// Reads mid-wipe resolve empty and never reach the half-deleted store.
		await expect(host.queryAppTime({ fromMs: 0, toMs: 1 })).resolves.toEqual({
			focusedMs: 0,
			engagedMs: 0,
			completeness: "unknown",
		});
		await expect(host.query({ fromMs: 0, toMs: 1 })).resolves.toEqual({
			runs: [],
			completeness: "unknown",
		});
		expect(sent(procs[0]).some((m) => m.kind === "query")).toBe(false);

		procs[0].emit("message", { kind: "storeClosed", requestId: "delete-all" });
		await wipe;

		// Restarted (consent still on) and the mid-wipe span did NOT survive.
		expect(fork).toHaveBeenCalledTimes(2);
		procs[1].emit("spawn");
		expect(sent(procs[1]).some((m) => m.kind === "producerEvent")).toBe(false);
		// The gate is lifted afterwards: capture works again into the fresh store.
		const after = evOf(focusedSpan(900, 1000));
		host.produce(after);
		expect(sent(procs[1])).toContainEqual({
			kind: "producerEvent",
			eventId: after.eventId,
			observation: after.observation,
		});
	});

	it("armed crash hook: kills BEFORE the producer post, buffers the span, then the real exit path replays it config-first", async () => {
		const procs: FakeProc[] = [];
		const fork = vi.fn(() => {
			const p = fakeProc();
			procs.push(p);
			return asProc(p);
		});
		const host = new InsightsHost(baseOpts({ forkWorker: fork }));
		host.setEnabled(true);
		procs[0].emit("spawn");

		host.crashWorkerForTest(); // ARM only — nothing has died yet
		expect(procs[0].kill).not.toHaveBeenCalled();

		const ev = evOf(focusedSpan(0, 400));
		host.produce(ev);

		// The hook fired BEFORE the post: the worker is dead and never received it.
		// A no-op hook fails here — it would have posted the event normally.
		expect(procs[0].kill).toHaveBeenCalled();
		expect(sent(procs[0]).some((m) => m.kind === "producerEvent")).toBe(false);
		expect(host.outboxSize).toBe(1); // buffered, provably unacked

		// The REAL exit handler recovers: consent is still on, so it re-forks.
		procs[0].emit("exit");
		expect(fork).toHaveBeenCalledTimes(2);

		procs[1].emit("spawn");
		const replayed = sent(procs[1]);
		expect(replayed[0].kind).toBe("config"); // config BEFORE replay
		expect(replayed).toContainEqual({
			kind: "producerEvent",
			eventId: ev.eventId,
			observation: ev.observation,
		});

		// The hook is one-shot: the next produce goes straight to the live worker.
		const next = evOf(focusedSpan(500, 600));
		host.produce(next);
		expect(procs[1].kill).not.toHaveBeenCalled();
		expect(sent(procs[1])).toContainEqual({
			kind: "producerEvent",
			eventId: next.eventId,
			observation: next.observation,
		});
	});

	it("queryAppTime resolves the correlated result and falls back to empty with no worker", async () => {
		const proc = fakeProc();
		const host = new InsightsHost(baseOpts({ forkWorker: () => asProc(proc) }));
		host.setEnabled(true);
		proc.emit("spawn");

		const pending = host.queryAppTime({ fromMs: 1, toMs: 2 });
		const q = sent(proc).find(
			(m) => m.kind === "query" && m.query.name === "appTime",
		);
		expect(q).toBeDefined();
		proc.emit("message", {
			kind: "appTimeResult",
			requestId: (q as { requestId: string }).requestId,
			result: { focusedMs: 5, engagedMs: 3, completeness: "partial" },
		});
		await expect(pending).resolves.toEqual({
			focusedMs: 5,
			engagedMs: 3,
			completeness: "partial",
		});

		const off = new InsightsHost(
			baseOpts({ forkWorker: () => asProc(fakeProc()) }),
		);
		off.setEnabled(false);
		await off.whenIdle();
		await expect(off.queryAppTime({ fromMs: 0, toMs: 1 })).resolves.toEqual({
			focusedMs: 0,
			engagedMs: 0,
			completeness: "unknown",
		});
	});
});
