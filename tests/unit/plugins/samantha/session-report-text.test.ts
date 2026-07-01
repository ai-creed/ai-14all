import { describe, expect, it } from "vitest";
import { assembleObserve } from "../../../../services/plugins/samantha/observe-assembler";
import {
	buildSessionReport,
	renderReport,
	renderReportText,
} from "../../../../services/plugins/samantha/samantha-command-capabilities";
import type { ObserveInput } from "../../../../services/plugins/samantha/observe-types";

// Representative inputs. The structured text must equal today's text byte-for-
// byte for every one — including the case with `recent` transition history.
const inputs: Record<string, ObserveInput> = {
	"two sessions, one focused, workflow + reviews": {
		identities: {
			wt1: { repo: "ai-14all", branch: "feature/auth", path: "/w/auth" },
			wt2: { repo: "ai-14all", branch: "main", path: "/w/main" },
		},
		reviewCounts: { wt1: 2, wt2: 0 },
		whisper: [
			{
				worktreeId: "wt2",
				collabId: "c1",
				daemonAlive: true,
				liveFeed: "polling",
				bindings: [],
				workflow: {
					workflowId: "wf1",
					workflowType: "SDD",
					specPath: "s.md",
					status: "running",
					currentPhaseIndex: 1,
					phaseName: "implement",
					currentChainId: null,
					round: null,
					haltReason: null,
					updatedAt: "",
				},
				escalation: null,
				handoffs: [],
			},
		],
		session: {
			worktrees: [
				{
					worktreeId: "wt1",
					provider: "claude",
					attention: "waiting",
					summary: "3 tests failing",
					task: "wire theme toggle",
					nextAction: "answer question",
					updatedAt: 1,
					recent: [],
				},
				{
					worktreeId: "wt2",
					provider: "codex",
					attention: "active",
					summary: "working",
					task: null,
					nextAction: null,
					updatedAt: 2,
					recent: [],
				},
			],
			app: { focusedWorktreeId: "wt1", mode: "ready" },
		},
	},
	"focused session WITH recent transition history": {
		identities: {
			wt1: { repo: "ai-14all", branch: "feature/auth", path: "/w/auth" },
		},
		reviewCounts: { wt1: 2 },
		whisper: [],
		session: {
			worktrees: [
				{
					worktreeId: "wt1",
					provider: "claude",
					attention: "waiting",
					summary: "3 tests failing",
					task: "wire theme toggle",
					nextAction: "answer question",
					updatedAt: 1,
					recent: [
						{
							at: 1,
							from: "active",
							to: "waiting",
							summary: "3 tests failing",
							source: "mcp",
						},
					],
				},
			],
			app: { focusedWorktreeId: "wt1", mode: "ready" },
		},
	},
	"escalation overrides workflow": {
		identities: { wt1: { repo: "ai-14all", branch: "main", path: "/w/main" } },
		reviewCounts: { wt1: 1 },
		whisper: [
			{
				worktreeId: "wt1",
				collabId: "c1",
				daemonAlive: true,
				liveFeed: "polling",
				bindings: [],
				workflow: {
					workflowId: "wf1",
					workflowType: "SDD",
					specPath: "s.md",
					status: "running",
					currentPhaseIndex: 0,
					phaseName: null,
					currentChainId: null,
					round: null,
					haltReason: null,
					updatedAt: "",
				},
				escalation: { chainId: "ch1", reason: "low confidence" },
				handoffs: [],
			},
		],
		session: {
			worktrees: [
				{
					worktreeId: "wt1",
					provider: "ezio",
					attention: "failed",
					summary: "build broke",
					task: null,
					nextAction: null,
					updatedAt: 1,
					recent: [],
				},
			],
			app: { focusedWorktreeId: null, mode: "prompt" },
		},
	},
	"no sessions at all": {
		identities: {},
		reviewCounts: {},
		whisper: [],
		session: { worktrees: [], app: { focusedWorktreeId: null, mode: "loading" } },
	},
};

describe("renderReportText golden regression (no drift)", () => {
	for (const [name, input] of Object.entries(inputs)) {
		it(`matches today's text exactly: ${name}`, () => {
			expect(renderReportText(buildSessionReport(input))).toBe(
				renderReport(assembleObserve(input)),
			);
		});
	}

	it("reproduces the recent: fragment that today's text contains", () => {
		const input = inputs["focused session WITH recent transition history"];
		const text = renderReportText(buildSessionReport(input));
		// Both the new and the old text contain the same recent: fragment.
		expect(text).toContain("recent: active→waiting (3 tests failing; mcp)");
		expect(renderReport(assembleObserve(input))).toContain(
			"recent: active→waiting (3 tests failing; mcp)",
		);
	});
});
