import { describe, expect, it } from "vitest";
import { buildSessionReport } from "../../../../services/plugins/samantha/samantha-command-capabilities";
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
					recent: [],
					sessionId: "sess-1",
				},
			],
			app: { focusedWorktreeId: "wt1", mode: "ready" },
		},
		...overrides,
	};
}

describe("buildSessionReport", () => {
	it("maps every source into a single canonical session entry", () => {
		const report = buildSessionReport(baseInput());
		expect(report.mode).toBe("ready");
		expect(report.focus).toBe("wt1");
		expect(report.sessions).toHaveLength(1);
		expect(report.sessions[0]).toEqual({
			worktreeId: "wt1",
			repo: "ai-14all",
			branch: "feature/auth",
			provider: "claude",
			attention: "waiting",
			summary: "3 tests failing",
			task: "wire theme toggle",
			nextAction: "answer question",
			reviewCount: 2,
			escalation: null,
			workflow: null,
			live: true,
			updatedAt: 1750000000000,
			recent: [],
		});
	});

	it("carries the session's recent transition history into the structure", () => {
		const input = baseInput();
		input.session!.worktrees[0].recent = [
			{
				at: 1750000000000,
				from: "active",
				to: "waiting",
				summary: "3 tests failing",
				source: "mcp",
			},
		];
		expect(buildSessionReport(input).sessions[0].recent).toEqual([
			{
				at: 1750000000000,
				from: "active",
				to: "waiting",
				summary: "3 tests failing",
				source: "mcp",
			},
		]);
	});

	it("defaults the null/empty paths before the first session slice", () => {
		const report = buildSessionReport({
			identities: {
				wt1: { repo: "ai-14all", branch: "main", path: "/w/main" },
			},
			reviewCounts: {},
			whisper: [],
			session: null,
		});
		const entry = report.sessions[0];
		expect(report.mode).toBe("loading");
		expect(report.focus).toBeNull();
		expect(entry.provider).toBeNull();
		expect(entry.attention).toBe("idle");
		expect(entry.summary).toBe("");
		expect(entry.task).toBeNull();
		expect(entry.nextAction).toBeNull();
		expect(entry.reviewCount).toBe(0);
		expect(entry.live).toBe(false);
		expect(entry.recent).toEqual([]);
	});

	it("carries the whisper escalation and workflow onto the entry", () => {
		const report = buildSessionReport({
			identities: {
				wt1: { repo: "ai-14all", branch: "main", path: "/w/main" },
			},
			reviewCounts: { wt1: 0 },
			whisper: [
				{
					worktreeId: "wt1",
					collabId: "c1",
					daemonAlive: true,
					liveFeed: "polling",
					bindings: [],
					workflow: {
						workflowId: "wf1",
						workflowType: "spec-driven-development",
						specPath: "spec.md",
						status: "running",
						currentPhaseIndex: 1,
						phaseName: "implement",
						currentChainId: null,
						round: null,
						haltReason: null,
						updatedAt: "",
					},
					escalation: { chainId: "ch1", reason: "low confidence" },
					handoffs: [],
				},
			],
			session: null,
		});
		const entry = report.sessions[0];
		expect(entry.escalation).toEqual({ reason: "low confidence" });
		expect(entry.workflow).toEqual({
			workflowType: "spec-driven-development",
			status: "running",
			phaseName: "implement",
		});
	});

	it("omits workflow.phaseName when the snapshot has none", () => {
		const report = buildSessionReport({
			identities: {
				wt1: { repo: "ai-14all", branch: "main", path: "/w/main" },
			},
			reviewCounts: {},
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
					escalation: null,
					handoffs: [],
				},
			],
			session: null,
		});
		expect(report.sessions[0].workflow).toEqual({
			workflowType: "SDD",
			status: "running",
		});
		expect(report.sessions[0].workflow).not.toHaveProperty("phaseName");
	});

	it("drops worktrees with no identity and preserves source order", () => {
		const input = baseInput();
		input.identities = {
			wt1: { repo: "ai-14all", branch: "feature/auth", path: "/w/auth" },
			wt2: { repo: "ai-14all", branch: "bugfix/tts", path: "/w/tts" },
		};
		input.reviewCounts = { wt1: 0, wt2: 0 };
		input.session!.worktrees = [
			input.session!.worktrees[0],
			{
				worktreeId: "wt3-no-identity",
				provider: "codex",
				attention: "active",
				summary: "orphan",
				task: null,
				nextAction: null,
				updatedAt: 1,
				recent: [],
			},
		];
		const report = buildSessionReport(input);
		expect(report.sessions.map((s) => s.worktreeId)).toEqual(["wt1", "wt2"]);
	});

	it("throws from shared-schema validation when the assembled result is invalid", () => {
		// A negative review count violates the contract's nonnegative-int rule.
		// If buildSessionReport omitted SessionReportResult.parse, this would NOT
		// throw — so this test fails closed if the schema validation is removed.
		const input = baseInput();
		input.reviewCounts = { wt1: -1 };
		expect(() => buildSessionReport(input)).toThrow();
	});
});
