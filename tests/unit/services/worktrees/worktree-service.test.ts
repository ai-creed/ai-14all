// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { WorktreeService } from "../../../../services/worktrees/worktree-service.js";

describe("WorktreeService", () => {
  let service: WorktreeService;

  beforeEach(() => {
    service = new WorktreeService();
  });

  describe("setRepositoryRoot", () => {
    it("rejects a path that does not exist", async () => {
      await expect(
        service.setRepositoryRoot("/nonexistent/path/abc123")
      ).rejects.toThrow();
    });

    it("rejects a directory that is not a git repo", async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "ofa-test-"));
      try {
        await expect(service.setRepositoryRoot(tmpDir)).rejects.toThrow();
      } finally {
        rmSync(tmpDir, { recursive: true });
      }
    });

    it("accepts a valid git repository and returns a Repository", async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "ofa-test-"));
      try {
        execSync("git init", { cwd: tmpDir, stdio: "ignore" });
        execSync("git config user.email 'phase0@example.com'", {
          cwd: tmpDir,
          stdio: "ignore",
        });
        execSync("git config user.name 'Phase 0 Test'", {
          cwd: tmpDir,
          stdio: "ignore",
        });
        execSync("git commit --allow-empty -m 'init'", {
          cwd: tmpDir,
          stdio: "ignore",
        });
        const repo = await service.setRepositoryRoot(tmpDir);
        expect(repo.rootPath).toBe(tmpDir);
        expect(repo.name).toBeTruthy();
      } finally {
        rmSync(tmpDir, { recursive: true });
      }
    });
  });

  describe("listWorktrees", () => {
    it("returns at least the main worktree for a valid repo", async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "ofa-test-"));
      try {
        execSync("git init", { cwd: tmpDir, stdio: "ignore" });
        execSync("git config user.email 'phase0@example.com'", {
          cwd: tmpDir,
          stdio: "ignore",
        });
        execSync("git config user.name 'Phase 0 Test'", {
          cwd: tmpDir,
          stdio: "ignore",
        });
        execSync("git commit --allow-empty -m 'init'", {
          cwd: tmpDir,
          stdio: "ignore",
        });
        const repo = await service.setRepositoryRoot(tmpDir);
        const worktrees = await service.listWorktrees(repo);
        expect(worktrees.length).toBeGreaterThanOrEqual(1);
        expect(worktrees[0].isMain).toBe(true);
      } finally {
        rmSync(tmpDir, { recursive: true });
      }
    });
  });
});
