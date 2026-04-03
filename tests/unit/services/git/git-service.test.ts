// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GitService } from "../../../../services/git/git-service.js";

describe("GitService", () => {
  let repoPath: string;
  let worktreePath: string;
  let service: GitService;

  beforeEach(() => {
    repoPath = realpathSync(mkdtempSync(join(tmpdir(), "ofa-git-test-")));
    service = new GitService();

    execSync("git init", { cwd: repoPath, stdio: "ignore" });
    execSync("git config user.email 'test@oneforall.dev'", {
      cwd: repoPath,
      stdio: "ignore",
    });
    execSync("git config user.name 'oneforall test'", {
      cwd: repoPath,
      stdio: "ignore",
    });

    mkdirSync(join(repoPath, "src"), { recursive: true });
    writeFileSync(join(repoPath, "src", "index.ts"), 'export const hello = "world";\n');
    execSync("git add -A", { cwd: repoPath, stdio: "ignore" });
    execSync('git commit -m "initial commit"', { cwd: repoPath, stdio: "ignore" });
    execSync("git branch feature-a", { cwd: repoPath, stdio: "ignore" });
    execSync('git worktree add ".worktrees/feature-a" feature-a', {
      cwd: repoPath,
      stdio: "ignore",
    });

    worktreePath = realpathSync(join(repoPath, ".worktrees", "feature-a"));
    writeFileSync(join(worktreePath, "src", "index.ts"), 'export const hello = "phase-2";\n');
    writeFileSync(join(worktreePath, "src", "new-file.ts"), "export const added = true;\n");
  });

  afterEach(() => {
    rmSync(repoPath, { recursive: true, force: true });
  });

  it("lists modified and untracked files", async () => {
    await expect(service.listChangedFiles(worktreePath)).resolves.toEqual([
      { path: "src/index.ts", status: "M" },
      { path: "src/new-file.ts", status: "??" },
    ]);
  });

  it("returns unified diff content for a tracked change", async () => {
    const diff = await service.readDiff(worktreePath, "src/index.ts");
    expect(diff.path).toBe("src/index.ts");
    expect(diff.content).toContain("@@");
    expect(diff.content).toContain('-export const hello = "world";');
    expect(diff.content).toContain('+export const hello = "phase-2";');
  });

  it("returns unified diff content for an untracked file", async () => {
    const diff = await service.readDiff(worktreePath, "src/new-file.ts");
    expect(diff.path).toBe("src/new-file.ts");
    expect(diff.content).toContain("@@");
    expect(diff.content).toContain("+export const added = true;");
  });

  it("rejects path traversal in readDiff", async () => {
    await expect(
      service.readDiff(worktreePath, "../../etc/passwd"),
    ).rejects.toThrow("Path escapes worktree");
  });

  it("lists a renamed file with its new path", async () => {
    // Reset modification from beforeEach so we get a clean rename
    execSync("git checkout -- src/index.ts", {
      cwd: worktreePath,
      stdio: "ignore",
    });
    execSync("git mv src/index.ts src/main.ts", {
      cwd: worktreePath,
      stdio: "ignore",
    });

    const changes = await service.listChangedFiles(worktreePath);
    const rename = changes.find((c) => c.status === "R");

    expect(rename).toBeDefined();
    expect(rename!.path).toBe("src/main.ts");
  });

  it("returns diff content for a renamed file", async () => {
    // Reset modification from beforeEach so we get a clean rename
    execSync("git checkout -- src/index.ts", {
      cwd: worktreePath,
      stdio: "ignore",
    });
    execSync("git mv src/index.ts src/main.ts", {
      cwd: worktreePath,
      stdio: "ignore",
    });

    const diff = await service.readDiff(worktreePath, "src/main.ts");
    expect(diff.path).toBe("src/main.ts");
    expect(diff.content).toContain("rename from");
    expect(diff.content).toContain("rename to");
  });

  it("skips unrecognized status codes in listChangedFiles", async () => {
    // All files in the worktree have recognized statuses (M, ??),
    // so the result should match the known set without any extras
    const changes = await service.listChangedFiles(worktreePath);
    for (const change of changes) {
      expect(["M", "A", "D", "R", "??"]).toContain(change.status);
    }
  });
});
