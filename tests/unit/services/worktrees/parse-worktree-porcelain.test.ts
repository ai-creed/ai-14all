// @vitest-environment node
import { describe, it, expect } from "vitest";
import { parseWorktreePorcelain } from "../../../../services/worktrees/parse-worktree-porcelain.js";

describe("parseWorktreePorcelain", () => {
  it("parses main and linked worktrees", () => {
    const input = [
      "worktree /repo/main",
      "HEAD 1111111111111111111111111111111111111111",
      "branch refs/heads/main",
      "",
      "worktree /repo/.worktrees/feature-a",
      "HEAD 2222222222222222222222222222222222222222",
      "branch refs/heads/feature-a",
      ""
    ].join("\n");

    expect(parseWorktreePorcelain(input, "repo-1")).toEqual([
      {
        id: "/repo/main",
        repositoryId: "repo-1",
        branchName: "main",
        path: "/repo/main",
        label: "main",
        isMain: true
      },
      {
        id: "/repo/.worktrees/feature-a",
        repositoryId: "repo-1",
        branchName: "feature-a",
        path: "/repo/.worktrees/feature-a",
        label: "feature-a",
        isMain: false
      }
    ]);
  });

  it("handles detached HEAD worktrees", () => {
    const input = [
      "worktree /repo/main",
      "HEAD 1111111111111111111111111111111111111111",
      "branch refs/heads/main",
      "",
      "worktree /repo/.worktrees/detached",
      "HEAD 3333333333333333333333333333333333333333",
      "detached",
      ""
    ].join("\n");

    const result = parseWorktreePorcelain(input, "repo-1");
    expect(result).toHaveLength(2);
    expect(result[1].branchName).toBe("3333333333333333333333333333333333333333");
    expect(result[1].label).toBe("3333333333333333333333333333333333333333");
    expect(result[1].isMain).toBe(false);
  });

  it("marks the first entry as isMain", () => {
    const input = [
      "worktree /repo/main",
      "HEAD 1111111111111111111111111111111111111111",
      "branch refs/heads/main",
      ""
    ].join("\n");

    const result = parseWorktreePorcelain(input, "repo-1");
    expect(result).toHaveLength(1);
    expect(result[0].isMain).toBe(true);
  });
});
