import { describe, expect, it } from "vitest";
import { findWorkspaceForWorktree } from "../../../src/features/workspace/logic/focus-target";

const workspaces = {
	workspaceOrder: ["ws1", "ws2"],
	workspacesById: {
		ws1: { workspaceState: { sessionsByWorktreeId: { wtA: {}, wtB: {} } } },
		ws2: { workspaceState: { sessionsByWorktreeId: { wtC: {} } } },
	},
};

describe("findWorkspaceForWorktree", () => {
	it("returns the workspace id that owns the worktree", () => {
		expect(findWorkspaceForWorktree(workspaces, "wtC")).toBe("ws2");
		expect(findWorkspaceForWorktree(workspaces, "wtA")).toBe("ws1");
	});

	it("returns null when no workspace owns the worktree", () => {
		expect(findWorkspaceForWorktree(workspaces, "nope")).toBeNull();
	});

	it("skips workspaces with no hydrated state", () => {
		const ws = {
			workspaceOrder: ["ws1"],
			workspacesById: { ws1: {} },
		};
		expect(findWorkspaceForWorktree(ws, "wtA")).toBeNull();
	});
});
