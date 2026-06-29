import { describe, expect, it } from "vitest";
import {
	createWorkspaceState,
	workspaceReducer,
} from "../../../src/features/workspace/logic/workspace-state";
import { buildWorkspaceSnapshot } from "../../../src/features/workspace/logic/workspace-persistence";
import { PersistedWorktreeSessionSchema } from "../../../shared/models/persisted-workspace-state";

const worktree = {
	id: "wt1",
	repositoryId: "repo-1",
	branchName: "main",
	path: "/repo",
	label: "main",
	isMain: true,
};

describe("reviewed-files reducer + snapshot", () => {
	it("defaults a new session to empty reviewedFiles and collapsed overview", () => {
		const state = createWorkspaceState([worktree]);
		const s = state.sessionsByWorktreeId["wt1"]!;
		expect(s.reviewedFiles).toEqual([]);
		expect(s.reviewOverviewExpanded).toBe(false);
	});

	it("markFileViewed upserts a mark", () => {
		let state = createWorkspaceState([worktree]);
		state = workspaceReducer(state, {
			type: "session/markFileViewed",
			worktreeId: "wt1",
			filePath: "a.ts",
			contentHash: "abcd1234",
		});
		expect(state.sessionsByWorktreeId["wt1"]!.reviewedFiles).toEqual([
			{ filePath: "a.ts", contentHash: "abcd1234" },
		]);
	});

	it("markFileViewed replaces an existing mark for the same path", () => {
		let state = createWorkspaceState([worktree]);
		const mark = (hash: string) =>
			workspaceReducer(state, {
				type: "session/markFileViewed",
				worktreeId: "wt1",
				filePath: "a.ts",
				contentHash: hash,
			});
		state = mark("one11111");
		state = workspaceReducer(state, {
			type: "session/markFileViewed",
			worktreeId: "wt1",
			filePath: "a.ts",
			contentHash: "two22222",
		});
		expect(state.sessionsByWorktreeId["wt1"]!.reviewedFiles).toEqual([
			{ filePath: "a.ts", contentHash: "two22222" },
		]);
	});

	it("unmarkFileViewed removes the mark", () => {
		let state = createWorkspaceState([worktree]);
		state = workspaceReducer(state, {
			type: "session/markFileViewed",
			worktreeId: "wt1",
			filePath: "a.ts",
			contentHash: "abcd1234",
		});
		state = workspaceReducer(state, {
			type: "session/unmarkFileViewed",
			worktreeId: "wt1",
			filePath: "a.ts",
		});
		expect(state.sessionsByWorktreeId["wt1"]!.reviewedFiles).toEqual([]);
	});

	it("setReviewOverviewExpanded toggles the flag", () => {
		let state = createWorkspaceState([worktree]);
		state = workspaceReducer(state, {
			type: "session/setReviewOverviewExpanded",
			worktreeId: "wt1",
			expanded: true,
		});
		expect(state.sessionsByWorktreeId["wt1"]!.reviewOverviewExpanded).toBe(true);
	});

	it("round-trips reviewedFiles through snapshot → schema → restore", () => {
		let state = createWorkspaceState([worktree]);
		state = workspaceReducer(state, {
			type: "session/markFileViewed",
			worktreeId: "wt1",
			filePath: "a.ts",
			contentHash: "abcd1234",
		});
		const snapshot = buildWorkspaceSnapshot("/repo", "repo-1", state);
		const parsed = PersistedWorktreeSessionSchema.parse(
			snapshot.worktreeSessions[0],
		);
		const fresh = createWorkspaceState([worktree]);
		const restored = workspaceReducer(fresh, {
			type: "session/restoreSnapshot",
			snapshot: parsed,
			workspaceId: "repo-1",
		});
		expect(restored.sessionsByWorktreeId["wt1"]!.reviewedFiles).toEqual([
			{ filePath: "a.ts", contentHash: "abcd1234" },
		]);
	});
});
