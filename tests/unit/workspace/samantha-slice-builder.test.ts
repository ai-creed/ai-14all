// tests/unit/workspace/samantha-slice-builder.test.ts
import { describe, expect, it } from "vitest";
import { createSamanthaSliceBuilder } from "../../../src/features/workspace/logic/samantha-slice-builder";
import type { WorktreeSession } from "../../../shared/models/worktree-session";

function sessionWith(
	state: "active" | "waiting",
	summary: string,
): WorktreeSession {
	return {
		id: "s",
		worktreeId: "wt1",
		title: "t",
		note: "",
		reviewMode: "files",
		filesPaneMode: "files",
		viewerMode: "diff",
		gitSummary: null,
		gitSummaryStale: false,
		gitSummaryMessage: null,
		gitSummaryError: false,
		selectedFilePath: null,
		selectedChangedFilePath: null,
		selectedCommitSha: null,
		selectedCommitFilePath: null,
		activeProcessSessionId: null,
		processSessionIds: [],
		attentionState: "idle",
		agentAttentionReasons: {
			mcp: { state, source: "mcp", summary, nextAction: null, reportedAt: 1 },
		},
		terminalLayoutId: "1",
		slotProcessIds: [null],
		reviewSidebarWidth: 320,
		treeExpandedPaths: [],
		treeShowIgnored: false,
		task: "do the thing",
		pendingReveal: null,
		paneTransient: false,
		navLocation: null,
	} as WorktreeSession;
}

describe("createSamanthaSliceBuilder", () => {
	it("emits a worktree slice with no history on the first build", () => {
		const t = 100;
		const builder = createSamanthaSliceBuilder({ now: () => t });
		const slice = builder.build(
			[
				{
					worktreeId: "wt1",
					session: sessionWith("active", "working"),
					processSessionsById: {},
				},
			],
			"wt1",
			"ready",
		);
		expect(slice.worktrees).toHaveLength(1);
		expect(slice.worktrees[0].attention).toBe("active");
		expect(slice.worktrees[0].recent).toHaveLength(0);
		expect(slice.app).toEqual({ focusedWorktreeId: "wt1", mode: "ready" });
	});

	it("appends a transition to the ring when the resolved attention changes", () => {
		let t = 100;
		const builder = createSamanthaSliceBuilder({ now: () => t });
		builder.build(
			[
				{
					worktreeId: "wt1",
					session: sessionWith("active", "working"),
					processSessionsById: {},
				},
			],
			"wt1",
			"ready",
		);
		t = 200;
		const slice = builder.build(
			[
				{
					worktreeId: "wt1",
					session: sessionWith("waiting", "needs you"),
					processSessionsById: {},
				},
			],
			"wt1",
			"ready",
		);
		expect(slice.worktrees[0].recent).toEqual([
			{
				at: 200,
				from: "active",
				to: "waiting",
				summary: "needs you",
				source: "mcp",
			},
		]);
	});

	it("does not append when attention is unchanged", () => {
		const builder = createSamanthaSliceBuilder({ now: () => 1 });
		builder.build(
			[
				{
					worktreeId: "wt1",
					session: sessionWith("active", "a"),
					processSessionsById: {},
				},
			],
			"wt1",
			"ready",
		);
		const slice = builder.build(
			[
				{
					worktreeId: "wt1",
					session: sessionWith("active", "a"),
					processSessionsById: {},
				},
			],
			"wt1",
			"ready",
		);
		expect(slice.worktrees[0].recent).toHaveLength(0);
	});

	it("caps the ring at ringSize", () => {
		let t = 0;
		const builder = createSamanthaSliceBuilder({ now: () => t, ringSize: 2 });
		const states: ("active" | "waiting")[] = [
			"active",
			"waiting",
			"active",
			"waiting",
		];
		let slice = builder.build(
			[
				{
					worktreeId: "wt1",
					session: sessionWith("active", "x"),
					processSessionsById: {},
				},
			],
			"wt1",
			"ready",
		);
		for (const s of states) {
			t += 10;
			slice = builder.build(
				[
					{
						worktreeId: "wt1",
						session: sessionWith(s, "x"),
						processSessionsById: {},
					},
				],
				"wt1",
				"ready",
			);
		}
		expect(slice.worktrees[0].recent.length).toBeLessThanOrEqual(2);
	});
});
