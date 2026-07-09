import { describe, it, expect, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WhisperWorktreeState } from "../../../shared/models/ecosystem-plugin";
import { createPushWakeWatcher } from "../../../services/xbp/push-wake-watcher";
import { PushWakeStateStore } from "../../../services/xbp/push-wake-state-store";
import type { PushWakeAuditEntry } from "../../../services/diagnostics/push-wake-audit-logger";

const NOW = 1751932800000;

function state(workflowId: string, status: string): WhisperWorktreeState {
	return {
		worktreeId: "wt-1",
		collabId: "collab-1",
		daemonAlive: true,
		liveFeed: "polling",
		bindings: [],
		workflow: {
			workflowId,
			workflowType: "spec-driven-development",
			specPath: "spec.md",
			status,
			currentPhaseIndex: 0,
			phaseName: null,
			currentChainId: null,
			round: null,
			haltReason: null,
			updatedAt: "2026-07-08T00:00:00Z",
		},
		escalation: null,
		handoffs: [],
	};
}

function harness(opts?: {
	enabled?: boolean;
	token?: boolean;
	outcomes?: Array<
		"sent" | "dead-token-cleared" | "retry-exhausted" | "no-token"
	>;
}) {
	const dir = mkdtempSync(join(tmpdir(), "pw-watch-"));
	const stateStore = new PushWakeStateStore({ dir });
	let states: WhisperWorktreeState[] = [];
	const outcomes = [...(opts?.outcomes ?? ["sent"])];
	const getStates = vi.fn(async () => states);
	const send = vi.fn(async () => outcomes.shift() ?? ("sent" as const));
	const audits: PushWakeAuditEntry[] = [];
	const watcher = createPushWakeWatcher({
		getStates,
		stateStore,
		isEnabled: () => opts?.enabled ?? true,
		hasToken: () => opts?.token ?? true,
		send,
		audit: (e) => audits.push(e),
		now: () => NOW,
	});
	return {
		watcher,
		getStates,
		send,
		audits,
		stateStore,
		dir,
		setStates: (s: WhisperWorktreeState[]) => (states = s),
	};
}

describe("push-wake watcher", () => {
	it("first tick baselines (no sends), qualifying transition on a later tick sends + audits once", async () => {
		const h = harness();
		h.setStates([state("wf-1", "running")]);
		await h.watcher.tick();
		expect(h.send).not.toHaveBeenCalled();
		h.setStates([state("wf-1", "done")]);
		await h.watcher.tick();
		expect(h.send).toHaveBeenCalledTimes(1);
		expect(h.audits).toEqual([
			{ ts: NOW, trigger: "workflow-done", outcome: "sent" },
		]);
		await h.watcher.tick(); // coalesced: settled end never re-fires
		expect(h.send).toHaveBeenCalledTimes(1);
	});

	it("persists across watcher instances: restart neither re-pings nor misses", async () => {
		const h = harness();
		h.setStates([state("wf-1", "running")]);
		await h.watcher.tick();
		// "Restart": a fresh watcher over the same stateStore, workflow now done.
		const h2 = harness();
		const fresh = createPushWakeWatcher({
			getStates: async () => [state("wf-1", "done")],
			stateStore: h.stateStore,
			isEnabled: () => true,
			hasToken: () => true,
			send: h2.send,
			audit: (e) => h2.audits.push(e),
			now: () => NOW,
		});
		await fresh.tick();
		expect(h2.send).toHaveBeenCalledTimes(1); // missed-transition half
		await fresh.tick();
		expect(h2.send).toHaveBeenCalledTimes(1); // no-re-ping half
	});

	it("no token → state advances but nothing is sent; registering later gets no stale burst", async () => {
		const h = harness({ token: false });
		h.setStates([state("wf-1", "running")]);
		await h.watcher.tick();
		h.setStates([state("wf-1", "done")]);
		await h.watcher.tick();
		expect(h.send).not.toHaveBeenCalled();
		// Token appears; the settled end must NOT fire retroactively.
		const withToken = createPushWakeWatcher({
			getStates: async () => [state("wf-1", "done")],
			stateStore: h.stateStore,
			isEnabled: () => true,
			hasToken: () => true,
			send: h.send,
			audit: () => {},
			now: () => NOW,
		});
		await withToken.tick();
		expect(h.send).not.toHaveBeenCalled();
	});

	it("disabled → does not read or advance; transitions emit after re-enable", async () => {
		let enabled = false;
		const getStates = vi.fn(async () => [state("wf-1", "done")]);
		const dir = mkdtempSync(join(tmpdir(), "pw-watch-en-"));
		const stateStore = new PushWakeStateStore({ dir });
		stateStore.save({
			workflows: { "wf-1": "running" },
			pingedWorkflows: [],
			pingedChains: [],
		});
		const send = vi.fn(async () => "sent" as const);
		const watcher = createPushWakeWatcher({
			getStates,
			stateStore,
			isEnabled: () => enabled,
			hasToken: () => true,
			send,
			audit: () => {},
			now: () => NOW,
		});
		await watcher.tick();
		expect(getStates).not.toHaveBeenCalled();
		enabled = true;
		await watcher.tick();
		expect(send).toHaveBeenCalledTimes(1); // running→done seen across the off window
	});

	it("empty snapshot is a no-op tick: state is neither advanced nor pruned", async () => {
		const h = harness();
		h.setStates([state("wf-1", "running")]);
		await h.watcher.tick();
		h.setStates([]); // schema gate closed / db busy
		await h.watcher.tick();
		h.setStates([state("wf-1", "done")]);
		await h.watcher.tick();
		expect(h.send).toHaveBeenCalledTimes(1); // wf-1 last-seen survived the blank tick
	});

	it("dead-token-cleared stops the remaining sends of the tick and audits the clearance", async () => {
		const h = harness({ outcomes: ["dead-token-cleared"] });
		h.setStates([
			state("wf-1", "running"),
			{ ...state("wf-2", "running"), worktreeId: "wt-2", collabId: "collab-2" },
		]);
		await h.watcher.tick();
		h.setStates([
			state("wf-1", "done"),
			{ ...state("wf-2", "halted"), worktreeId: "wt-2", collabId: "collab-2" },
		]);
		await h.watcher.tick();
		expect(h.send).toHaveBeenCalledTimes(1);
		expect(h.audits).toHaveLength(1);
		expect(h.audits[0].outcome).toBe("dead-token-cleared");
	});

	it("a rejected getStates does not escape tick(): resolves, warns, and self-heals without deadlocking `ticking`", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const dir = mkdtempSync(join(tmpdir(), "pw-watch-err-"));
			const stateStore = new PushWakeStateStore({ dir });
			let calls = 0;
			const getStates = vi.fn(async () => {
				calls += 1;
				if (calls === 1) throw new Error("boom");
				return [state("wf-1", calls === 2 ? "running" : "done")];
			});
			const send = vi.fn(async () => "sent" as const);
			const watcher = createPushWakeWatcher({
				getStates,
				stateStore,
				isEnabled: () => true,
				hasToken: () => true,
				send,
				audit: () => {},
				now: () => NOW,
			});

			// Rejected getStates must not escape tick() as an unhandled rejection.
			await expect(watcher.tick()).resolves.toBeUndefined();
			expect(warnSpy).toHaveBeenCalledWith(
				"[push-wake] tick failed:",
				expect.any(Error),
			);
			expect(send).not.toHaveBeenCalled();

			// Self-heal: `ticking` was reset in `finally`, so the next tick actually
			// runs (not short-circuited by the `if (ticking) return;` guard) and
			// baselines wf-1 normally (no send yet — first observation).
			await watcher.tick();
			expect(getStates).toHaveBeenCalledTimes(2);
			expect(send).not.toHaveBeenCalled();

			// And the watcher keeps working normally afterwards: a real transition
			// on a subsequent healthy tick still sends.
			await watcher.tick();
			expect(send).toHaveBeenCalledTimes(1);
		} finally {
			warnSpy.mockRestore();
		}
	});

	it("start()/stop() manage the interval without double-starting", async () => {
		vi.useFakeTimers();
		try {
			// harness() defaults to enabled: true, so getStates is actually invoked
			// on every tick — required for this call-count assertion to mean anything.
			const h = harness();
			h.setStates([]);
			h.watcher.start();
			h.watcher.start(); // idempotent: must not leak a second interval
			// 3 intervals @ the default 3000ms cadence = 9000ms.
			await vi.advanceTimersByTimeAsync(9_000);
			// 1 immediate tick (from start()) + 3 interval ticks = 4. A leaked
			// second interval would double every subsequent count (8, not 4).
			expect(h.getStates).toHaveBeenCalledTimes(4);
			h.watcher.stop();
			const before = h.getStates.mock.calls.length;
			await vi.advanceTimersByTimeAsync(10_000);
			expect(h.getStates.mock.calls.length).toBe(before);
		} finally {
			vi.useRealTimers();
		}
	});
});
