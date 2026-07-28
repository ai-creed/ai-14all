import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createPushWakeWatcher,
	PUSH_WAKE_COALESCE_MS,
} from "../../../services/xbp/push-wake-watcher";
import { PushWakeStateStore } from "../../../services/xbp/push-wake-state-store";
import type { PushWakeAuditEntry } from "../../../services/diagnostics/push-wake-audit-logger";
import type { PushSendOutcome } from "../../../services/xbp/push-wake-sender";
import type { WhisperWorktreeState } from "../../../shared/models/ecosystem-plugin";

// Minimal whisper fixture: a workflow row in a given status (mirrors the
// builder in push-wake-detector.test.ts).
const wf = (id: string, status: string): WhisperWorktreeState =>
	({
		worktreeId: `wt-${id}`,
		workflow: { workflowId: id, status },
	}) as WhisperWorktreeState;
const att = (worktreeId: string, attention: string) => ({
	worktreeId,
	attention,
});

type Harness = ReturnType<typeof makeHarness>;
function makeHarness(dir: string) {
	const h = {
		dir,
		store: new PushWakeStateStore({ dir }),
		nowMs: 1_000_000,
		enabled: true,
		hasToken: true,
		connected: false,
		whisper: [] as WhisperWorktreeState[],
		report: { sessions: [] } as {
			sessions: Array<{ worktreeId: string; attention: string }>;
		},
		rejectReport: false,
		// Extension beyond the brief's base harness: lets a couple of ported
		// regressions (rejected getStates; disabled-gate read counting)
		// exercise the whisper side the same way `rejectReport` already lets
		// them exercise the attention side.
		rejectWhisper: false,
		whisperReads: 0,
		reportReads: 0,
		sendOutcome: "sent" as PushSendOutcome,
		sends: 0,
		audits: [] as PushWakeAuditEntry[],
		failSaves: false,
		// Extension for the re-entrancy regression: when true, send() suspends
		// on an externally-controlled promise instead of resolving
		// synchronously, so a test can hold a tick "in flight" across a send
		// that (in production) can take ~20s against the 3s poll interval.
		deferSend: false,
		resolveSend: async () => {},
		watcher: undefined as unknown as ReturnType<typeof createPushWakeWatcher>,
	};
	const pendingSendResolvers: Array<(outcome: PushSendOutcome) => void> = [];
	h.resolveSend = async () => {
		// Poll until the in-flight tick's send() has actually registered its
		// resolver — resolving before that would be a no-op and leave the
		// caller's `await tick` hanging forever.
		while (pendingSendResolvers.length === 0) await Promise.resolve();
		const resolve = pendingSendResolvers.shift()!;
		resolve(h.sendOutcome);
	};
	const failableStore = {
		load: () => h.store.load(),
		save: (s: Parameters<PushWakeStateStore["save"]>[0]) =>
			h.failSaves ? false : h.store.save(s),
	} as PushWakeStateStore;
	h.watcher = createPushWakeWatcher({
		getStates: () => {
			h.whisperReads += 1;
			if (h.rejectWhisper) throw new Error("whisper read failed");
			return h.whisper;
		},
		getSessionReport: async () => {
			h.reportReads += 1;
			if (h.rejectReport) throw new Error("provider down");
			return h.report;
		},
		stateStore: failableStore,
		isEnabled: () => h.enabled,
		hasToken: () => h.hasToken,
		hasLivePhoneConnection: () => h.connected,
		send: async () => {
			h.sends += 1;
			if (h.deferSend) {
				return await new Promise<PushSendOutcome>((resolve) => {
					pendingSendResolvers.push(resolve);
				});
			}
			return h.sendOutcome;
		},
		audit: (e) => h.audits.push(e),
		now: () => h.nowMs,
	});
	return h;
}

describe("push-wake watcher", () => {
	let dir: string;
	let h: Harness;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "pw-watcher-"));
		h = makeHarness(dir);
	});

	it("attention transition sends once and audits sent with attribution", async () => {
		h.report = { sessions: [att("wt-1", "active")] };
		await h.watcher.tick(); // establishes both baselines (whisper blank-skips)
		h.report = { sessions: [att("wt-1", "waiting")] };
		await h.watcher.tick();
		expect(h.sends).toBe(1);
		expect(h.audits).toEqual([
			{
				ts: h.nowMs,
				trigger: "attention-waiting",
				outcome: "sent",
				detectors: ["attention"],
			},
		]);
	});

	it("disabled gate: no detection, no audit, no save", async () => {
		h.enabled = false;
		h.report = { sessions: [att("wt-1", "waiting")] };
		await h.watcher.tick();
		expect(h.sends).toBe(0);
		expect(h.audits).toEqual([]);
		expect(h.store.load()).toBeNull();
	});

	it("disabled gate does not read whisper or attention; a transition missed while disabled fires once re-enabled", async () => {
		h.report = { sessions: [att("wt-1", "active")] };
		h.whisper = [wf("A", "running")];
		await h.watcher.tick(); // baseline both while enabled
		h.enabled = false;
		h.report = { sessions: [att("wt-1", "waiting")] }; // flips while off
		h.whisper = [wf("A", "done")]; // flips while off
		const whisperReadsBefore = h.whisperReads;
		const reportReadsBefore = h.reportReads;
		await h.watcher.tick();
		expect(h.whisperReads).toBe(whisperReadsBefore); // not read while disabled
		expect(h.reportReads).toBe(reportReadsBefore); // not read while disabled
		expect(h.sends).toBe(0);
		expect(h.audits).toEqual([]);
		h.enabled = true;
		await h.watcher.tick(); // re-enabled: the missed transitions now fire (one send per tick)
		expect(h.sends).toBe(1);
	});

	it("two-tick consumption: suppressed-connected", async () => {
		h.report = { sessions: [att("wt-1", "active")] };
		await h.watcher.tick();
		h.connected = true;
		h.report = { sessions: [att("wt-1", "waiting")] };
		await h.watcher.tick(); // tick 1: transition, suppressed
		expect(h.sends).toBe(0);
		expect(h.audits.map((a) => a.outcome)).toEqual(["suppressed-connected"]);
		expect(h.store.load()?.attention).toEqual({
			sessions: { "wt-1": "waiting" },
		});
		expect(h.store.load()?.lastPingAt).toBeNull(); // suppression never advances it
		await h.watcher.tick(); // tick 2: unchanged input
		expect(h.sends).toBe(0);
		expect(h.audits).toHaveLength(1); // nothing new
	});

	it("two-tick consumption: coalesced (and lastPingAt frozen)", async () => {
		h.report = { sessions: [att("wt-1", "active"), att("wt-2", "active")] };
		await h.watcher.tick();
		h.report = { sessions: [att("wt-1", "waiting"), att("wt-2", "active")] };
		await h.watcher.tick(); // sent; lastPingAt = now
		const pingAt = h.store.load()?.lastPingAt;
		expect(pingAt).toBe(h.nowMs);
		h.nowMs += 10_000;
		h.report = { sessions: [att("wt-1", "waiting"), att("wt-2", "failed")] };
		await h.watcher.tick(); // fresh transition inside 60s: coalesced
		expect(h.sends).toBe(1);
		expect(h.audits.map((a) => a.outcome)).toEqual(["sent", "coalesced"]);
		expect(h.store.load()?.lastPingAt).toBe(pingAt); // frozen on coalesce
		await h.watcher.tick(); // unchanged: consumed, silent
		expect(h.audits).toHaveLength(2);
	});

	it("two-tick consumption: prechecked no-token consumes state, never advances lastPingAt", async () => {
		h.hasToken = false;
		h.report = { sessions: [att("wt-1", "active")] };
		await h.watcher.tick();
		h.report = { sessions: [att("wt-1", "waiting")] };
		await h.watcher.tick();
		expect(h.sends).toBe(0);
		expect(h.audits.map((a) => a.outcome)).toEqual(["no-token"]);
		expect(h.store.load()?.attention).toEqual({
			sessions: { "wt-1": "waiting" },
		});
		expect(h.store.load()?.lastPingAt).toBeNull();
		await h.watcher.tick();
		expect(h.audits).toHaveLength(1);
	});

	it("gate precedence: suppressed-connected wins over no-token on a fresh transition", async () => {
		h.report = { sessions: [att("wt-1", "active")] };
		await h.watcher.tick(); // baseline
		h.connected = true;
		h.hasToken = false;
		h.report = { sessions: [att("wt-1", "waiting")] };
		await h.watcher.tick();
		expect(h.sends).toBe(0);
		expect(h.audits.map((a) => a.outcome)).toEqual(["suppressed-connected"]);
	});

	it("gate precedence: suppressed-connected wins over coalesced on a fresh transition inside the coalesce window", async () => {
		h.report = { sessions: [att("wt-1", "active"), att("wt-2", "active")] };
		await h.watcher.tick(); // baseline
		h.report = { sessions: [att("wt-1", "waiting"), att("wt-2", "active")] };
		await h.watcher.tick(); // sent; establishes lastPingAt (inside the coalesce window from here on)
		expect(h.audits.map((a) => a.outcome)).toEqual(["sent"]);
		h.connected = true; // now suppressed
		h.report = { sessions: [att("wt-1", "waiting"), att("wt-2", "failed")] };
		await h.watcher.tick(); // fresh transition, well inside the 60s coalesce window
		expect(h.sends).toBe(1); // unchanged from before — no new send
		expect(h.audits.map((a) => a.outcome)).toEqual([
			"sent",
			"suppressed-connected",
		]);
	});

	it("no-token consumption: token appearing later does not fire a stale burst", async () => {
		h.hasToken = false;
		h.report = { sessions: [att("wt-1", "active")] };
		await h.watcher.tick();
		h.report = { sessions: [att("wt-1", "waiting")] };
		await h.watcher.tick(); // consumed as no-token
		expect(h.audits.map((a) => a.outcome)).toEqual(["no-token"]);
		h.hasToken = true; // token registers later
		await h.watcher.tick(); // same unchanged report: nothing left to detect
		expect(h.sends).toBe(0);
		expect(h.audits).toHaveLength(1); // no stale burst
	});

	it("persist-failed: fail-quiet, sender NOT called, no in-memory advance, streak audits once, recovery proceeds", async () => {
		h.report = { sessions: [att("wt-1", "active")] };
		await h.watcher.tick();
		h.failSaves = true;
		h.report = { sessions: [att("wt-1", "waiting")] };
		await h.watcher.tick();
		expect(h.sends).toBe(0); // spy assertion: sender never invoked
		expect(h.audits.map((a) => a.outcome)).toEqual(["persist-failed"]);
		await h.watcher.tick(); // still failing: same transition re-detected, streak silent
		expect(h.audits).toHaveLength(1);
		h.failSaves = false;
		await h.watcher.tick(); // recovered: the SAME transition proceeds to its real outcome
		expect(h.sends).toBe(1);
		expect(h.audits.map((a) => a.outcome)).toEqual(["persist-failed", "sent"]);
		// The successful save must RE-ARM the streak: a second, later failure
		// audits again — an implementation that never re-arms fails here.
		h.nowMs += PUSH_WAKE_COALESCE_MS + 1;
		h.failSaves = true;
		h.report = { sessions: [att("wt-1", "failed")] }; // fresh transition
		await h.watcher.tick();
		expect(h.audits.map((a) => a.outcome)).toEqual([
			"persist-failed",
			"sent",
			"persist-failed",
		]);
	});

	it("coalesce timestamp advances outcome-independently and pre-send", async () => {
		h.sendOutcome = "retry-exhausted";
		h.report = { sessions: [att("wt-1", "active")] };
		await h.watcher.tick();
		h.report = { sessions: [att("wt-1", "waiting")] };
		await h.watcher.tick();
		expect(h.audits.map((a) => a.outcome)).toEqual(["retry-exhausted"]);
		expect(h.store.load()?.lastPingAt).toBe(h.nowMs); // advanced despite failure
	});

	it("coalesce survives a simulated restart (no double ping)", async () => {
		h.report = { sessions: [att("wt-1", "active"), att("wt-2", "active")] };
		await h.watcher.tick();
		h.report = { sessions: [att("wt-1", "waiting"), att("wt-2", "active")] };
		await h.watcher.tick(); // sent, lastPingAt persisted
		const h2 = makeHarness(dir); // restart: same dir, fresh watcher
		h2.nowMs = h.nowMs + 10_000;
		h2.report = { sessions: [att("wt-1", "waiting"), att("wt-2", "failed")] };
		await h2.watcher.tick(); // fresh transition within 60s of the persisted attempt
		expect(h2.sends).toBe(0);
		expect(h2.audits.map((a) => a.outcome)).toEqual(["coalesced"]);
	});

	it("missing/corrupt state at start: baseline pass sends and audits nothing (but persists); a later transition fires", async () => {
		writeFileSync(join(dir, "push-wake-state.json"), "{corrupt");
		h.report = { sessions: [att("wt-1", "waiting")] }; // already waiting
		await h.watcher.tick(); // null-load baseline
		expect(h.sends).toBe(0);
		expect(h.audits).toEqual([]);
		// The baseline is durable — restart continuity depends on it.
		expect(h.store.load()?.attention).toEqual({
			sessions: { "wt-1": "waiting" },
		});
		h.report = { sessions: [att("wt-1", "waiting"), att("wt-2", "failed")] };
		await h.watcher.tick(); // wt-2 is a fresh transition against established state
		expect(h.sends).toBe(1);
		expect(h.audits.map((a) => a.trigger)).toEqual(["attention-failed"]);
	});

	it("restart continuity (ported regression): baselined running workflow fires on the first post-restart done snapshot, then never re-pings", async () => {
		h.whisper = [wf("A", "running")];
		await h.watcher.tick(); // eventless whisper baseline — must be PERSISTED
		expect(h.store.load()?.whisper?.workflows).toEqual({ A: "running" });
		const h2 = makeHarness(dir); // restart over the same state file
		h2.whisper = [wf("A", "done")];
		await h2.watcher.tick();
		expect(h2.sends).toBe(1); // missed-transition half
		expect(h2.audits.map((a) => a.trigger)).toEqual(["workflow-done"]);
		await h2.watcher.tick();
		expect(h2.sends).toBe(1); // no-re-ping half (settled end never re-fires)
	});

	it("namespace preservation: attention rejection rides through a whisper-event save; recovery does not re-fire", async () => {
		h.report = { sessions: [att("wt-1", "waiting")] };
		h.whisper = [wf("A", "running")];
		await h.watcher.tick(); // both established (attention holds wt-1)
		h.rejectReport = true;
		h.whisper = [wf("A", "done")]; // whisper event
		await h.watcher.tick();
		expect(h.audits.map((a) => a.outcome)).toEqual(["sent"]);
		expect(h.audits[0].detectors).toEqual(["whisper"]);
		expect(h.store.load()?.attention).toEqual({
			sessions: { "wt-1": "waiting" },
		}); // preserved verbatim
		h.rejectReport = false; // recovery: same unchanged waiting session
		await h.watcher.tick();
		expect(h.sends).toBe(1); // no second send
		expect(h.audits).toHaveLength(1); // no new audit
	});

	it("attention rejection warns once per streak; a recovered poll resets the latch so a later rejection warns again", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			h.rejectReport = true;
			await h.watcher.tick(); // rejection #1: attention pass skipped, warns once
			expect(h.store.load()?.attention).toBeNull(); // skipped: namespace untouched
			expect(warnSpy).toHaveBeenCalledTimes(1);
			expect(warnSpy).toHaveBeenCalledWith(
				"[push-wake] attention report unavailable:",
				expect.any(Error),
			);
			await h.watcher.tick(); // still rejecting: same streak, silent
			await h.watcher.tick();
			expect(warnSpy).toHaveBeenCalledTimes(1);

			h.rejectReport = false; // recovered poll
			await h.watcher.tick(); // resolves; resets the latch — no new warn on success
			expect(warnSpy).toHaveBeenCalledTimes(1);

			h.rejectReport = true; // a later rejection after recovery
			await h.watcher.tick();
			expect(warnSpy).toHaveBeenCalledTimes(2); // latch re-armed: warns again
			expect(h.sends).toBe(0); // no attention event ever actually fired in this test
		} finally {
			warnSpy.mockRestore();
		}
	});

	it("namespace preservation converse: blank whisper rides through an attention-event save", async () => {
		h.whisper = [wf("A", "running")];
		h.report = { sessions: [att("wt-1", "active")] };
		await h.watcher.tick(); // whisper established with A=running
		h.whisper = []; // blank read: whisper pass skipped
		h.report = { sessions: [att("wt-1", "waiting")] };
		await h.watcher.tick();
		expect(h.audits.map((a) => a.outcome)).toEqual(["sent"]);
		expect(h.store.load()?.whisper).toEqual({
			workflows: { A: "running" },
			pingedWorkflows: [],
			pingedChains: [],
		});
		h.whisper = [wf("A", "running")]; // recovered, unchanged
		h.nowMs += PUSH_WAKE_COALESCE_MS + 1;
		await h.watcher.tick();
		expect(h.sends).toBe(1); // nothing new fired
	});

	it("a blank whisper tick does not lose the prior baseline: a later real transition still fires", async () => {
		h.whisper = [wf("A", "running")];
		await h.watcher.tick(); // baseline
		h.whisper = []; // blank tick: schema gate closed / db busy
		await h.watcher.tick();
		h.whisper = [wf("A", "done")];
		await h.watcher.tick();
		expect(h.sends).toBe(1); // A's running→done survived the blank tick
	});

	it("partial null-load init: attention stays durably null through a whisper save; in-session recovery AND fresh restart each baseline from the same partial-null document without firing", async () => {
		h.rejectReport = true;
		h.whisper = [wf("A", "running")];
		await h.watcher.tick(); // whisper baseline persists; attention stays null
		h.whisper = [wf("A", "done")];
		await h.watcher.tick(); // whisper event -> composite save
		expect(h.store.load()?.attention).toBeNull(); // NOT {} — never baselined

		// Freeze the partial-null document NOW: the in-session recovery below
		// persists an established attention namespace (eventless saves are
		// durable), so the restart branch must start from a copy taken before
		// it — otherwise it loads established state and passes for the wrong
		// reason (unchanged-never-refires instead of null-baseline).
		const partialNull = readFileSync(join(dir, "push-wake-state.json"), "utf8");

		// Branch A — in-session recovery: the first successful attention pass
		// baselines the already-waiting session silently.
		h.rejectReport = false;
		h.report = { sessions: [att("wt-1", "waiting")] }; // was waiting all along
		h.nowMs += PUSH_WAKE_COALESCE_MS + 1;
		await h.watcher.tick();
		expect(h.sends).toBe(1); // only the earlier whisper send; no attention fire

		// Branch B — fresh restart from the SAME partial-null document.
		const dir2 = mkdtempSync(join(tmpdir(), "pw-watcher-restart-"));
		writeFileSync(join(dir2, "push-wake-state.json"), partialNull);
		const h2 = makeHarness(dir2);
		// Precondition assertion: the restarted watcher really sees null.
		expect(h2.store.load()?.attention).toBeNull();
		h2.nowMs = h.nowMs + PUSH_WAKE_COALESCE_MS + 1;
		h2.report = { sessions: [att("wt-1", "waiting")] };
		await h2.watcher.tick(); // null baseline: records, fires nothing
		expect(h2.sends).toBe(0);
		h2.report = { sessions: [att("wt-1", "waiting"), att("wt-2", "failed")] };
		await h2.watcher.tick(); // later fresh transition fires
		expect(h2.sends).toBe(1);
	});

	it("partial null-load init converse: whisper stays durably null through an attention save", async () => {
		h.whisper = []; // blank whisper from the start
		h.report = { sessions: [att("wt-1", "active")] };
		await h.watcher.tick(); // attention baseline (eventless)
		h.report = { sessions: [att("wt-1", "waiting")] };
		await h.watcher.tick(); // attention event -> save
		expect(h.store.load()?.whisper).toBeNull();
		h.whisper = [wf("A", "done")]; // whisper's FIRST successful pass: already-done workflow
		h.nowMs += PUSH_WAKE_COALESCE_MS + 1;
		await h.watcher.tick();
		expect(h.sends).toBe(1); // baseline settles A silently — no second send
	});

	it("one ping per tick with both detectors firing; audit lists both, whisper trigger primary", async () => {
		h.whisper = [wf("A", "running")];
		h.report = { sessions: [att("wt-1", "active")] };
		await h.watcher.tick();
		h.whisper = [wf("A", "halted")];
		h.report = { sessions: [att("wt-1", "failed")] };
		await h.watcher.tick();
		expect(h.sends).toBe(1);
		expect(h.audits).toEqual([
			{
				ts: h.nowMs,
				trigger: "workflow-halted",
				outcome: "sent",
				detectors: ["whisper", "attention"],
			},
		]);
	});

	it("blank whisper does not block the attention pass, and vice versa", async () => {
		h.whisper = [];
		h.report = { sessions: [att("wt-1", "active")] };
		await h.watcher.tick();
		h.report = { sessions: [att("wt-1", "waiting")] };
		await h.watcher.tick();
		expect(h.sends).toBe(1); // attention alone proceeded
		h.rejectReport = true;
		h.whisper = [wf("A", "running")];
		h.nowMs += PUSH_WAKE_COALESCE_MS + 1;
		await h.watcher.tick();
		h.whisper = [wf("A", "done")];
		await h.watcher.tick();
		expect(h.sends).toBe(2); // whisper alone proceeded
	});

	it("raced no-token from the sender is audited (attempt path)", async () => {
		h.sendOutcome = "no-token";
		h.report = { sessions: [att("wt-1", "active")] };
		await h.watcher.tick();
		h.report = { sessions: [att("wt-1", "waiting")] };
		await h.watcher.tick();
		expect(h.audits.map((a) => a.outcome)).toEqual(["no-token"]);
		expect(h.store.load()?.lastPingAt).toBe(h.nowMs); // reached the sender: attempt reserved
	});

	it("dead-token-cleared is audited and consumed (ported regression)", async () => {
		h.sendOutcome = "dead-token-cleared";
		h.report = { sessions: [att("wt-1", "active")] };
		await h.watcher.tick();
		h.report = { sessions: [att("wt-1", "waiting")] };
		await h.watcher.tick();
		expect(h.audits).toEqual([
			{
				ts: h.nowMs,
				trigger: "attention-waiting",
				outcome: "dead-token-cleared",
				detectors: ["attention"],
			},
		]);
		expect(h.store.load()?.lastPingAt).toBe(h.nowMs); // attempt reserved
		await h.watcher.tick(); // unchanged input: consumed, nothing new
		expect(h.audits).toHaveLength(1);
	});

	it("re-entrancy guard: an overlapping tick() while a send is in flight does not double-send", async () => {
		h.report = { sessions: [att("wt-1", "active")] };
		await h.watcher.tick(); // baseline
		h.report = { sessions: [att("wt-1", "waiting")] };
		h.deferSend = true;
		// Simulates a real send (~20s) outliving the 3s poll interval: tick1
		// suspends inside send(); tick2 is the interval firing again before
		// tick1 resolves. Neither is awaited before the other starts — exactly
		// the overlap the `ticking` guard exists to prevent.
		const tick1 = h.watcher.tick();
		const tick2 = h.watcher.tick(); // `ticking` is already true synchronously
		// (set on tick1's very first line, before its first await) — so tick2
		// must return immediately without ever reaching send().
		await tick2;
		await h.resolveSend(); // let tick1's send() resolve
		await tick1;
		expect(h.sends).toBe(1); // send() invoked exactly once, not twice
		expect(h.audits).toHaveLength(1); // exactly one audit entry, not two
	});

	it("a rejected getStates does not escape tick(): resolves, warns, and self-heals without deadlocking `ticking`", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			h.rejectWhisper = true;
			await expect(h.watcher.tick()).resolves.toBeUndefined();
			expect(warnSpy).toHaveBeenCalledWith(
				"[push-wake] tick failed:",
				expect.any(Error),
			);
			expect(h.sends).toBe(0);

			// Self-heal: `ticking` was reset in `finally`, so the next tick
			// actually runs (not short-circuited by the `if (ticking) return;`
			// guard) and baselines wf-1 normally (no send yet — first
			// observation).
			h.rejectWhisper = false;
			h.whisper = [wf("A", "running")];
			await h.watcher.tick();
			expect(h.sends).toBe(0);

			// And the watcher keeps working normally afterwards: a real
			// transition on a subsequent healthy tick still sends.
			h.whisper = [wf("A", "done")];
			await h.watcher.tick();
			expect(h.sends).toBe(1);
		} finally {
			warnSpy.mockRestore();
		}
	});

	it("start()/stop() manage the interval without double-starting", async () => {
		vi.useFakeTimers();
		try {
			// enabled: true by default, so getStates is actually invoked on
			// every tick — required for this call-count assertion to mean
			// anything.
			h.whisper = [];
			h.watcher.start();
			h.watcher.start(); // idempotent: must not leak a second interval
			// 3 intervals @ the default 3000ms cadence = 9000ms.
			await vi.advanceTimersByTimeAsync(9_000);
			// 1 immediate tick (from start()) + 3 interval ticks = 4. A leaked
			// second interval would double every subsequent count (8, not 4).
			expect(h.whisperReads).toBe(4);
			h.watcher.stop();
			const before = h.whisperReads;
			await vi.advanceTimersByTimeAsync(10_000);
			expect(h.whisperReads).toBe(before);
		} finally {
			vi.useRealTimers();
		}
	});
});
