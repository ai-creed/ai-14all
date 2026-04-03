import { describe, expect, it } from "vitest";
import type { Worktree } from "../../../shared/models/worktree";
import {
  createWorkspaceState,
  workspaceReducer,
} from "../../../src/features/workspace/workspace-state";

const worktrees: Worktree[] = [
  {
    id: "main",
    repositoryId: "repo-1",
    branchName: "main",
    path: "/repo",
    label: "main",
    isMain: true,
  },
  {
    id: "feature-a",
    repositoryId: "repo-1",
    branchName: "feature-a",
    path: "/repo/.worktrees/feature-a",
    label: "feature-a",
    isMain: false,
  },
];

describe("workspaceReducer", () => {
  it("creates a session per worktree and selects the first worktree on load", () => {
    const state = workspaceReducer(createWorkspaceState([]), {
      type: "workspace/loadWorktrees",
      worktrees,
    });
    expect(state.selectedWorktreeId).toBe("main");
    expect(state.sessionsByWorktreeId.main.reviewMode).toBe("files");
    expect(state.sessionsByWorktreeId["feature-a"].note).toBe("");
  });

  it("restores worktree-specific selections when switching between sessions", () => {
    let state = workspaceReducer(createWorkspaceState([]), {
      type: "workspace/loadWorktrees",
      worktrees,
    });
    state = workspaceReducer(state, {
      type: "session/selectFile",
      worktreeId: "main",
      relativePath: "src/index.ts",
    });
    state = workspaceReducer(state, {
      type: "session/selectWorktree",
      worktreeId: "feature-a",
    });
    state = workspaceReducer(state, {
      type: "session/setNote",
      worktreeId: "feature-a",
      note: "Investigate diff output",
    });
    state = workspaceReducer(state, {
      type: "session/selectWorktree",
      worktreeId: "main",
    });

    expect(state.sessionsByWorktreeId.main.selectedFilePath).toBe("src/index.ts");
    expect(state.sessionsByWorktreeId["feature-a"].note).toBe("Investigate diff output");
  });

  it("assigns simple shell labels and updates active tab selection", () => {
    let state = createWorkspaceState(worktrees);
    state = workspaceReducer(state, {
      type: "session/registerTerminal",
      worktreeId: "main",
      terminalSessionId: "term-1",
    });
    state = workspaceReducer(state, {
      type: "session/registerTerminal",
      worktreeId: "main",
      terminalSessionId: "term-2",
    });
    state = workspaceReducer(state, {
      type: "session/closeTerminal",
      worktreeId: "main",
      terminalSessionId: "term-2",
    });

    expect(state.sessionsByWorktreeId.main.terminalTabs).toEqual([
      { sessionId: "term-1", label: "shell 1" },
    ]);
    expect(state.sessionsByWorktreeId.main.activeTerminalSessionId).toBe("term-1");
  });
});
