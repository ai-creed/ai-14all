import { describe, expect, it } from "vitest";
import {
	buildTargetSessionState,
	routeInstruction,
	type TargetSessionState,
} from "../../../../services/plugins/samantha/session-instruction-router";
import type { WhisperWorktreeState } from "../../../../shared/models/ecosystem-plugin";
import type { SamanthaSessionSlice } from "../../../../shared/contracts/plugins";

function managed(
	over: Partial<WhisperWorktreeState> = {},
): WhisperWorktreeState {
	return {
		worktreeId: "wt1",
		collabId: "c1",
		daemonAlive: true,
		liveFeed: "polling",
		bindings: [{ agentType: "claude", bindingState: "bound" }],
		workflow: {
			workflowId: "wf1",
			workflowType: "spec-driven-development",
			specPath: "/spec.md",
			status: "running",
			currentPhaseIndex: 0,
			phaseName: "implement",
			currentChainId: null,
			round: null,
			haltReason: null,
			updatedAt: "2026-06-24T00:00:00.000Z",
		},
		escalation: null,
		handoffs: [],
		...over,
	};
}

function sessionWith(
	worktreeId: string,
	attention: SamanthaSessionSlice["worktrees"][number]["attention"],
	over: {
		provider?: SamanthaSessionSlice["worktrees"][number]["provider"];
		sessionId?: string | null;
	} = {},
): SamanthaSessionSlice {
	return {
		worktrees: [
			{
				worktreeId,
				provider: over.provider ?? "claude",
				attention,
				summary: "",
				task: null,
				nextAction: null,
				updatedAt: 0,
				recent: [],
				sessionId: over.sessionId === undefined ? "sess_1" : over.sessionId,
			},
		],
		app: { focusedWorktreeId: null, mode: "ready" },
	};
}

describe("buildTargetSessionState", () => {
	it("managed: live daemon + workflow → managed with derived fields", () => {
		const s = buildTargetSessionState(
			"wt1",
			[managed()],
			sessionWith("wt1", "active"),
		);
		expect(s).toEqual({
			kind: "managed",
			workflowStatus: "running",
			escalated: false,
			workflowId: "wf1",
			target: "claude",
		});
	});

	it("managed escalated: escalation present → escalated true", () => {
		const s = buildTargetSessionState(
			"wt1",
			[managed({ escalation: { chainId: "ch1", reason: "stuck" } })],
			null,
		);
		expect(s.kind === "managed" && s.escalated).toBe(true);
	});

	it("daemon dead → not managed, falls through to session slice", () => {
		const s = buildTargetSessionState(
			"wt1",
			[managed({ daemonAlive: false })],
			sessionWith("wt1", "waiting"),
		);
		expect(s).toEqual({
			kind: "unmanaged",
			attention: "waiting",
			sessionId: "sess_1",
		});
	});

	it("unmanaged: session slice with sessionId, no managed workflow → unmanaged", () => {
		const s = buildTargetSessionState("wt1", [], sessionWith("wt1", "idle"));
		expect(s).toEqual({
			kind: "unmanaged",
			attention: "idle",
			sessionId: "sess_1",
		});
	});

	it("absent: no workflow and no session slice → absent", () => {
		expect(buildTargetSessionState("wt1", [], null)).toEqual({
			kind: "absent",
		});
	});

	it("absent: session slice exists but sessionId is null (no live PTY) → absent", () => {
		const s = buildTargetSessionState(
			"wt1",
			[],
			sessionWith("wt1", "idle", { sessionId: null }),
		);
		expect(s).toEqual({ kind: "absent" });
	});

	it("target derivation: provider 'other' falls back to a bound agent binding", () => {
		const s = buildTargetSessionState(
			"wt1",
			[managed()],
			sessionWith("wt1", "active", { provider: "other" }),
		);
		expect(s.kind === "managed" && s.target).toBe("claude");
	});
});

describe("routeInstruction", () => {
	const instruction = "add tests";

	it("managed paused → workflow-resume with the instruction as message", () => {
		const state: TargetSessionState = {
			kind: "managed",
			workflowStatus: "paused",
			escalated: false,
			workflowId: "wf1",
			target: "claude",
		};
		expect(routeInstruction({ instruction, state })).toEqual({
			kind: "workflow-resume",
			workflowId: "wf1",
			message: "add tests",
		});
	});

	it("managed escalated (not paused) → collab-tell to the target", () => {
		const state: TargetSessionState = {
			kind: "managed",
			workflowStatus: "running",
			escalated: true,
			workflowId: "wf1",
			target: "codex",
		};
		expect(routeInstruction({ instruction, state })).toEqual({
			kind: "collab-tell",
			target: "codex",
			instruction: "add tests",
		});
	});

	it("managed escalated but no resolvable target → reject session-busy", () => {
		const state: TargetSessionState = {
			kind: "managed",
			workflowStatus: "running",
			escalated: true,
			workflowId: "wf1",
			target: null,
		};
		const r = routeInstruction({ instruction, state });
		expect(r.kind === "reject" && r.code).toBe("session-busy");
	});

	it("managed running and not escalated → reject session-busy (don't interrupt)", () => {
		const state: TargetSessionState = {
			kind: "managed",
			workflowStatus: "running",
			escalated: false,
			workflowId: "wf1",
			target: "claude",
		};
		const r = routeInstruction({ instruction, state });
		expect(r.kind === "reject" && r.code).toBe("session-busy");
	});

	it("managed halted and not escalated → reject session-busy", () => {
		const state: TargetSessionState = {
			kind: "managed",
			workflowStatus: "halted",
			escalated: false,
			workflowId: "wf1",
			target: "claude",
		};
		const r = routeInstruction({ instruction, state });
		expect(r.kind === "reject" && r.code).toBe("session-busy");
	});

	it.each(["idle", "waiting", "ready"] as const)(
		"unmanaged %s → send-input carrying the sessionId + data",
		(attention) => {
			const r = routeInstruction({
				instruction,
				state: { kind: "unmanaged", attention, sessionId: "sess_9" },
			});
			expect(r).toEqual({
				kind: "send-input",
				sessionId: "sess_9",
				data: "add tests",
			});
		},
	);

	it.each(["active", "stale", "failed"] as const)(
		"unmanaged %s → reject session-busy",
		(attention) => {
			const r = routeInstruction({
				instruction,
				state: { kind: "unmanaged", attention, sessionId: "sess_9" },
			});
			expect(r.kind === "reject" && r.code).toBe("session-busy");
		},
	);

	it("absent → reject no-live-agent", () => {
		const r = routeInstruction({ instruction, state: { kind: "absent" } });
		expect(r.kind === "reject" && r.code).toBe("no-live-agent");
	});
});
