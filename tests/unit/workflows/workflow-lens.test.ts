import { describe, expect, it } from "vitest";
import type { WhisperWorktreeState } from "../../../shared/models/ecosystem-plugin";
import {
	diffWorkflowAttention,
	toWorkflowRow,
} from "../../../src/features/workflows/logic/workflow-lens";

const base: WhisperWorktreeState = {
	worktreeId: "wt-1",
	collabId: "c1",
	daemonAlive: true,
	liveFeed: "socket",
	bindings: [],
	handoffs: [],
	workflow: {
		workflowId: "wf1",
		workflowType: "spec-driven-development",
		status: "running",
		currentPhaseIndex: 1,
		phaseName: "implementation",
		currentChainId: "ch1",
		round: { current: 2, max: 3 },
		haltReason: null,
		updatedAt: "t1",
	},
	escalation: null,
};

describe("toWorkflowRow", () => {
	it("maps a snapshot to the row model", () => {
		expect(toWorkflowRow(base)).toEqual({
			worktreeId: "wt-1",
			workflowId: "wf1",
			workflowType: "spec-driven-development",
			phaseName: "implementation",
			roundLabel: "2/3",
			status: "running",
			daemonAlive: true,
			liveFeed: "socket",
		});
	});

	it("returns null when there is no workflow", () => {
		expect(toWorkflowRow({ ...base, workflow: null })).toBeNull();
	});
});

describe("diffWorkflowAttention", () => {
	it("running → halted emits waiting with the halt reason", () => {
		const next = {
			...base,
			workflow: {
				...base.workflow!,
				status: "halted",
				haltReason: "round limit",
			},
		};
		expect(diffWorkflowAttention(base, next, 123)).toEqual({
			kind: "report",
			reason: {
				state: "waiting",
				source: "workflow",
				summary: "round limit",
				nextAction: "open workflow details",
				reportedAt: 123,
			},
		});
	});

	it("new escalation emits waiting with the escalation reason", () => {
		const next = {
			...base,
			escalation: { chainId: "ch9", reason: "agents disagree" },
		};
		expect(diffWorkflowAttention(base, next, 5)).toMatchObject({
			kind: "report",
			reason: { state: "waiting", summary: "agents disagree" },
		});
	});

	it("unchanged escalation does not re-emit", () => {
		const withEsc = { ...base, escalation: { chainId: "ch9", reason: "r" } };
		expect(diffWorkflowAttention(withEsc, withEsc, 5)).toBeNull();
	});

	it("a new escalation chain with identical reason text re-reports", () => {
		const prev = { ...base, escalation: { chainId: "ch9", reason: "r" } };
		const next = { ...base, escalation: { chainId: "ch10", reason: "r" } };
		expect(diffWorkflowAttention(prev, next, 7)).toMatchObject({
			kind: "report",
			reason: { state: "waiting", summary: "r" },
		});
	});

	it("escalation wins over a simultaneous halt (one effect max)", () => {
		const next = {
			...base,
			workflow: { ...base.workflow!, status: "halted", haltReason: "halt!" },
			escalation: { chainId: "ch9", reason: "escalated!" },
		};
		expect(diffWorkflowAttention(base, next, 7)).toMatchObject({
			kind: "report",
			reason: { state: "waiting", summary: "escalated!" },
		});
	});

	it("running → done emits ready", () => {
		const next = { ...base, workflow: { ...base.workflow!, status: "done" } };
		expect(diffWorkflowAttention(base, next, 9)).toMatchObject({
			kind: "report",
			reason: { state: "ready" },
		});
	});

	it("halted → running (resume) emits clear", () => {
		const halted = {
			...base,
			workflow: { ...base.workflow!, status: "halted", haltReason: "x" },
		};
		expect(diffWorkflowAttention(halted, base, 9)).toEqual({ kind: "clear" });
	});

	it("no transition emits nothing", () => {
		expect(diffWorkflowAttention(base, base, 9)).toBeNull();
	});

	it("first snapshot (no previous) of a halted workflow still reports", () => {
		const halted = {
			...base,
			workflow: { ...base.workflow!, status: "halted", haltReason: "x" },
		};
		expect(diffWorkflowAttention(undefined, halted, 9)).toMatchObject({
			kind: "report",
		});
	});
});
