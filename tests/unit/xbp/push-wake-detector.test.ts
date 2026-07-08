import { describe, it, expect } from "vitest";
import type { WhisperWorktreeState } from "../../../shared/models/ecosystem-plugin";
import {
	detectPushWakeEvents,
	type PushWakeSeenState,
} from "../../../services/xbp/push-wake-detector";

function state(overrides: {
	workflowId?: string;
	status?: string;
	chainId?: string;
}): WhisperWorktreeState {
	return {
		worktreeId: "wt-1",
		collabId: "collab-1",
		daemonAlive: true,
		liveFeed: "polling",
		bindings: [],
		workflow: overrides.workflowId
			? {
					workflowId: overrides.workflowId,
					workflowType: "spec-driven-development",
					specPath: "spec.md",
					status: overrides.status ?? "running",
					currentPhaseIndex: 0,
					phaseName: null,
					currentChainId: null,
					round: null,
					haltReason: null,
					updatedAt: "2026-07-08T00:00:00Z",
				}
			: null,
		escalation: overrides.chainId
			? { chainId: overrides.chainId, reason: "needs human" }
			: null,
		handoffs: [],
	};
}

const seen = (
	workflows: Record<string, string>,
	pingedWorkflows: string[] = [],
	pingedChains: string[] = [],
): PushWakeSeenState => ({ workflows, pingedWorkflows, pingedChains });

describe("detectPushWakeEvents — status transitions (raw strings only)", () => {
	// prev status → current status → expected triggers
	const table: Array<[string, string, string[]]> = [
		["running", "done", ["workflow-done"]],
		["running", "halted", ["workflow-halted"]],
		["paused", "done", ["workflow-done"]],
		["running", "canceled", []], // excluded
		["running", "cancelled", []], // excluded (spelling variant)
		["running", "completed", []], // display label ≠ raw status → unknown, ignored
		["running", "failed", []], // no such raw status → unknown, ignored
		["running", "escalated", []], // escalation is NOT a workflow status
		["running", "running", []],
		["running", "paused", []],
		["done", "done", []], // already settled
		["done", "halted", []], // qualifying→qualifying is not a fresh transition
		["canceled", "done", []], // settled (excluded) prev never re-fires
	];
	for (const [prev, current, triggers] of table) {
		it(`${prev} → ${current} ⇒ [${triggers.join(", ")}]`, () => {
			const { events } = detectPushWakeEvents(seen({ "wf-1": prev }), [
				state({ workflowId: "wf-1", status: current }),
			]);
			expect(events.map((e) => e.trigger)).toEqual(triggers);
		});
	}

	it("restart half (b) — persisted running + current done after restart ⇒ emits (never baselines a known workflow)", () => {
		// Simulates: watcher persisted {wf-1: running}, host died, workflow
		// finished, host restarted. The persisted state IS prev.
		const { events } = detectPushWakeEvents(seen({ "wf-1": "running" }), [
			state({ workflowId: "wf-1", status: "done" }),
		]);
		expect(events).toEqual([{ trigger: "workflow-done", workflowId: "wf-1" }]);
	});

	it("restart half (a) — already-pinged end does not re-ping after restart", () => {
		const { events } = detectPushWakeEvents(
			seen({ "wf-1": "done" }, ["wf-1"]),
			[state({ workflowId: "wf-1", status: "done" })],
		);
		expect(events).toEqual([]);
	});

	it("unseen already-terminal workflow is baselined silently (marked pinged, no event)", () => {
		const { events, next } = detectPushWakeEvents(seen({}), [
			state({ workflowId: "wf-old", status: "done" }),
		]);
		expect(events).toEqual([]);
		expect(next.pingedWorkflows).toContain("wf-old");
	});

	it("fresh baseline (prev=null) emits nothing and baselines terminal rows + escalations", () => {
		const { events, next } = detectPushWakeEvents(null, [
			state({ workflowId: "wf-1", status: "done", chainId: "ch-1" }),
		]);
		expect(events).toEqual([]);
		expect(next.pingedWorkflows).toContain("wf-1");
		expect(next.pingedChains).toContain("ch-1");
	});

	it("coalesces: one workflow-end = one event across consecutive ticks", () => {
		const first = detectPushWakeEvents(seen({ "wf-1": "running" }), [
			state({ workflowId: "wf-1", status: "done" }),
		]);
		expect(first.events).toHaveLength(1);
		const second = detectPushWakeEvents(first.next, [
			state({ workflowId: "wf-1", status: "done" }),
		]);
		expect(second.events).toHaveLength(0);
	});

	it("two independent ends in one tick ⇒ two events", () => {
		const s2 = { ...state({ workflowId: "wf-2", status: "halted" }), worktreeId: "wt-2", collabId: "collab-2" };
		const { events } = detectPushWakeEvents(
			seen({ "wf-1": "running", "wf-2": "running" }),
			[state({ workflowId: "wf-1", status: "done" }), s2],
		);
		expect(events.map((e) => e.trigger).sort()).toEqual([
			"workflow-done",
			"workflow-halted",
		]);
	});
});

describe("detectPushWakeEvents — escalations", () => {
	it("new escalated chainId qualifies — even with no prev row (escalated while host was down)", () => {
		const { events } = detectPushWakeEvents(seen({}), [
			state({ workflowId: "wf-1", status: "running", chainId: "ch-9" }),
		]);
		expect(events).toEqual([{ trigger: "escalated", chainId: "ch-9" }]);
	});

	it("already-pinged chainId does not re-qualify (tick-to-tick and across restart)", () => {
		const { events } = detectPushWakeEvents(seen({}, [], ["ch-9"]), [
			state({ workflowId: "wf-1", status: "running", chainId: "ch-9" }),
		]);
		expect(events).toEqual([]);
	});

	it("escalation + end on the same tick ⇒ both events", () => {
		const { events } = detectPushWakeEvents(seen({ "wf-1": "running" }), [
			state({ workflowId: "wf-1", status: "halted", chainId: "ch-2" }),
		]);
		expect(events.map((e) => e.trigger).sort()).toEqual([
			"escalated",
			"workflow-halted",
		]);
	});
});

describe("detectPushWakeEvents — state maintenance", () => {
	it("prunes workflows/pings no longer in the snapshot; keeps live ones", () => {
		const { next } = detectPushWakeEvents(
			seen({ "wf-gone": "done", "wf-1": "running" }, ["wf-gone"]),
			[state({ workflowId: "wf-1", status: "running" })],
		);
		expect(next.workflows).toEqual({ "wf-1": "running" });
		expect(next.pingedWorkflows).toEqual([]);
	});

	it("retains pinged chains after the escalation clears — an already-seen chainId never re-qualifies", () => {
		const cleared = detectPushWakeEvents(seen({}, [], ["ch-1"]), [
			state({ workflowId: "wf-1", status: "running" }),
		]);
		expect(cleared.next.pingedChains).toEqual(["ch-1"]);
		// Same chain re-escalates later: spec test contract says already-seen
		// chainId does not qualify — no duplicate ping.
		const again = detectPushWakeEvents(cleared.next, [
			state({ workflowId: "wf-1", status: "running", chainId: "ch-1" }),
		]);
		expect(again.events).toEqual([]);
		expect(again.next.pingedChains).toEqual(["ch-1"]);
	});

	it("never evicts pinged chains — even the oldest of many stays disqualified", () => {
		const many = Array.from({ length: 600 }, (_, i) => `ch-${i}`);
		const { events, next } = detectPushWakeEvents(seen({}, [], many), [
			state({ workflowId: "wf-1", status: "running", chainId: "ch-0" }),
		]);
		expect(events).toEqual([]); // ch-0 was pinged long ago; still disqualified
		expect(next.pingedChains).toHaveLength(600);
		expect(next.pingedChains).toContain("ch-0");
	});

	it("does not mutate its inputs", () => {
		const prev = seen({ "wf-1": "running" });
		const frozen = JSON.parse(JSON.stringify(prev));
		detectPushWakeEvents(prev, [state({ workflowId: "wf-1", status: "done" })]);
		expect(prev).toEqual(frozen);
	});
});
