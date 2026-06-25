// tests/unit/plugins/samantha/observe-assembler.test.ts
import { describe, expect, it } from "vitest";
import { assembleObserve } from "../../../../services/plugins/samantha/observe-assembler";
import type { ObserveInput } from "../../../../services/plugins/samantha/observe-types";

function baseInput(overrides: Partial<ObserveInput> = {}): ObserveInput {
	return {
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
					updatedAt: 1750000000000,
					recent: [
						{
							at: 1750000000000,
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
		...overrides,
	};
}

describe("assembleObserve", () => {
	it("builds a repo/branch-keyed detail line with the focus marker and recent fragment", () => {
		const out = assembleObserve(baseInput());
		const line = out.details["ai-14all/feature/auth"];
		expect(line).toBeDefined();
		expect(line).toContain("★ ");
		expect(line).toContain("claude");
		expect(line).toContain("waiting");
		expect(line).toContain("3 tests failing");
		expect(line).toContain("task: wire theme toggle");
		expect(line).toContain("next: answer question");
		expect(line).toContain("2 reviews");
		expect(line).toContain("recent: active→waiting (3 tests failing; mcp)");
	});

	it("maps waiting to attentionRequired", () => {
		expect(assembleObserve(baseInput()).signals.wt1).toBe("attentionRequired");
	});

	it("status is warning when a session is waiting and none failed", () => {
		expect(assembleObserve(baseInput()).status).toBe("warning");
	});

	it("status is error when any session failed", () => {
		const input = baseInput();
		input.session!.worktrees[0].attention = "failed";
		expect(assembleObserve(input).status).toBe("error");
		expect(assembleObserve(input).signals.wt1).toBe("error");
	});

	it("active maps to a silent update and ok status", () => {
		const input = baseInput();
		input.session!.worktrees[0].attention = "active";
		input.reviewCounts = { wt1: 0 };
		const out = assembleObserve(input);
		expect(out.signals.wt1).toBe("update");
		expect(out.status).toBe("ok");
	});

	it("a whisper escalation forces attentionRequired even when the session is active", () => {
		const input = baseInput();
		input.session!.worktrees[0].attention = "active";
		input.whisper = [
			{
				worktreeId: "wt1",
				collabId: "c1",
				daemonAlive: true,
				liveFeed: "polling",
				bindings: [],
				workflow: null,
				escalation: { chainId: "ch1", reason: "low confidence" },
				handoffs: [],
			},
		];
		expect(assembleObserve(input).signals.wt1).toBe("attentionRequired");
	});

	it("omits empty fields and the recent fragment when there is no history", () => {
		const input = baseInput();
		input.session!.worktrees[0].recent = [];
		input.session!.worktrees[0].task = null;
		input.session!.worktrees[0].nextAction = null;
		const line = input.identities.wt1
			? assembleObserve(input).details["ai-14all/feature/auth"]
			: "";
		expect(line).not.toContain("recent:");
		expect(line).not.toContain("task:");
		expect(line).not.toContain("next:");
	});

	it("drops worktrees that no longer have an identity (closed worktree)", () => {
		const input = baseInput();
		input.identities = {}; // worktree closed; identity gone
		const out = assembleObserve(input);
		expect(Object.keys(out.details)).toHaveLength(0);
		expect(out.status).toBe("unknown");
	});

	it("leads the summary with the app mode and the focused branch", () => {
		const out = assembleObserve(baseInput());
		expect(out.summary).toContain("[ready]");
		expect(out.summary).toContain("feature/auth");
	});

	it("assembles main-owned data (identity + reviews + workflow) before the first session slice", () => {
		const out = assembleObserve({
			identities: {
				wt1: { repo: "ai-14all", branch: "main", path: "/w/main" },
			},
			reviewCounts: { wt1: 3 },
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
						specPath: "spec.md",
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
			session: null, // renderer slice has NOT arrived yet
		});
		const line = out.details["ai-14all/main"];
		expect(line).toBeDefined();
		expect(line).toContain("idle"); // no session attention yet
		expect(line).toContain("3 reviews");
		expect(line).toContain("SDD running");
		expect(out.signals.wt1).toBe("update"); // not speech-worthy with no session
		expect(out.status).toBe("ok");
	});

	it("moves the focus marker to whichever worktree is focused", () => {
		const input = baseInput();
		input.identities = {
			wt1: { repo: "ai-14all", branch: "feature/auth", path: "/w/auth" },
			wt2: { repo: "ai-14all", branch: "bugfix/tts", path: "/w/tts" },
		};
		input.reviewCounts = { wt1: 0, wt2: 0 };
		input.session!.worktrees = [
			input.session!.worktrees[0],
			{
				worktreeId: "wt2",
				provider: "codex",
				attention: "active",
				summary: "working",
				task: null,
				nextAction: null,
				updatedAt: 1,
				recent: [],
			},
		];
		input.session!.app.focusedWorktreeId = "wt2";
		const out = assembleObserve(input);
		expect(out.details["ai-14all/bugfix/tts"].startsWith("★ ")).toBe(true);
		expect(out.details["ai-14all/feature/auth"].startsWith("★ ")).toBe(false);
	});
});
