import { describe, it, expect } from "vitest";
import { createWorkspaceState } from "../../../../src/features/workspace/logic/workspace-state";
import type { Worktree } from "../../../../shared/models/worktree";

const wt = (id: string): Worktree =>
	({ id, path: `/repo/${id}`, branch: id, isPrimary: false }) as unknown as Worktree;

describe("floating shell state init", () => {
	it("createWorkspaceState seeds empty floating fields per session", () => {
		const state = createWorkspaceState([wt("a")]);
		const session = state.sessionsByWorktreeId.a;
		expect(session.floatingShellIds).toEqual([]);
		expect(session.expandedFloatingShellId).toBeNull();
	});
});
