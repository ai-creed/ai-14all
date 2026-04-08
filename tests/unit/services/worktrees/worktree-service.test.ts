// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { WorktreeService } from "../../../../services/worktrees/worktree-service.js";
import { GitService } from "../../../../services/git/git-service.js";

describe("WorktreeService", () => {
	let service: WorktreeService;

	beforeEach(() => {
		service = new WorktreeService();
	});

	describe("setRepositoryRoot", () => {
		it("rejects a path that does not exist", async () => {
			await expect(
				service.setRepositoryRoot("/nonexistent/path/abc123"),
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

	describe("setRepositoryRoot — repo identity failure path", () => {
		it("loads the repository even when repo identity resolution fails", async () => {
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

				vi.spyOn(GitService.prototype, "readOrCreateRepoId").mockResolvedValue(null);

				const repo = await service.setRepositoryRoot(tmpDir);

				expect(repo.rootPath).toBe(tmpDir);
				expect(repo.repoId).toBeNull();
			} finally {
				vi.restoreAllMocks();
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

	describe("previewCreateWorktree", () => {
		it("derives branch/path and previews the latest origin/master commit", async () => {
			const tmpDir = mkdtempSync(join(tmpdir(), "ofa-test-"));
			try {
				execSync("git init", { cwd: tmpDir, stdio: "ignore" });
				execSync("git config user.email 'phase7@example.com'", {
					cwd: tmpDir,
					stdio: "ignore",
				});
				execSync("git config user.name 'Phase 7 Test'", {
					cwd: tmpDir,
					stdio: "ignore",
				});
				writeFileSync(join(tmpDir, "README.md"), "# repo\n");
				execSync("git add README.md", { cwd: tmpDir, stdio: "ignore" });
				execSync('git commit -m "initial commit"', {
					cwd: tmpDir,
					stdio: "ignore",
				});
				execSync("git update-ref refs/remotes/origin/master HEAD", {
					cwd: tmpDir,
					stdio: "ignore",
				});

				const repo = await service.setRepositoryRoot(tmpDir);
				const preview = await service.previewCreateWorktree(repo, "Feature A");

				expect(preview.branchName).toBe("feature-a");
				expect(preview.path).toBe(join(tmpDir, ".worktrees", "feature-a"));
				expect(preview.baseRef).toBe("origin/master");
				expect(preview.baseCommit.subject).toBe("initial commit");
			} finally {
				rmSync(tmpDir, { recursive: true, force: true });
			}
		});
	});

	describe("createWorktree", () => {
		it("creates a linked worktree on a new branch from origin/master", async () => {
			const tmpDir = mkdtempSync(join(tmpdir(), "ofa-test-"));
			try {
				execSync("git init", { cwd: tmpDir, stdio: "ignore" });
				execSync("git config user.email 'phase7@example.com'", {
					cwd: tmpDir,
					stdio: "ignore",
				});
				execSync("git config user.name 'Phase 7 Test'", {
					cwd: tmpDir,
					stdio: "ignore",
				});
				writeFileSync(join(tmpDir, "README.md"), "# repo\n");
				execSync("git add README.md", { cwd: tmpDir, stdio: "ignore" });
				execSync('git commit -m "initial commit"', {
					cwd: tmpDir,
					stdio: "ignore",
				});
				execSync("git update-ref refs/remotes/origin/master HEAD", {
					cwd: tmpDir,
					stdio: "ignore",
				});

				const repo = await service.setRepositoryRoot(tmpDir);
				const created = await service.createWorktree(repo, "Feature B");

				expect(created.branchName).toBe("feature-b");
				expect(created.path).toBe(join(tmpDir, ".worktrees", "feature-b"));
				expect(execSync("git branch --list feature-b", { cwd: tmpDir }).toString()).toContain(
					"feature-b",
				);
				expect(
					execSync("git -C \"" + created.path + "\" branch --show-current").toString().trim(),
				).toBe("feature-b");
			} finally {
				rmSync(tmpDir, { recursive: true, force: true });
			}
		});
	});

	describe("removeWorktree", () => {
		it("previews dirty non-main worktrees and removes both worktree and branch", async () => {
			const tmpDir = mkdtempSync(join(tmpdir(), "ofa-test-"));
			try {
				execSync("git init", { cwd: tmpDir, stdio: "ignore" });
				execSync("git config user.email 'phase7@example.com'", {
					cwd: tmpDir,
					stdio: "ignore",
				});
				execSync("git config user.name 'Phase 7 Test'", {
					cwd: tmpDir,
					stdio: "ignore",
				});
				writeFileSync(join(tmpDir, "README.md"), "# repo\n");
				execSync("git add README.md", { cwd: tmpDir, stdio: "ignore" });
				execSync('git commit -m "initial commit"', {
					cwd: tmpDir,
					stdio: "ignore",
				});
				execSync("git update-ref refs/remotes/origin/master HEAD", {
					cwd: tmpDir,
					stdio: "ignore",
				});
				execSync("git branch feature-c", { cwd: tmpDir, stdio: "ignore" });
				mkdirSync(join(tmpDir, ".worktrees"), { recursive: true });
				execSync(`git worktree add "${join(tmpDir, ".worktrees", "feature-c")}" feature-c`, {
					cwd: tmpDir,
					stdio: "ignore",
				});
				writeFileSync(join(tmpDir, ".worktrees", "feature-c", "dirty.txt"), "dirty\n");

				const repo = await service.setRepositoryRoot(tmpDir);
				const worktree = (await service.listWorktrees(repo)).find((entry) => !entry.isMain)!;
				const preview = await service.previewRemoveWorktree(repo, worktree.id);
				expect(preview.isDirty).toBe(true);

				await service.removeWorktree(repo, worktree.id);

				expect(execSync("git worktree list --porcelain", { cwd: tmpDir }).toString()).not.toContain(
					".worktrees/feature-c",
				);
				expect(execSync("git branch --list feature-c", { cwd: tmpDir }).toString().trim()).toBe("");
			} finally {
				rmSync(tmpDir, { recursive: true, force: true });
			}
		});

		it("rejects attempts to remove the main worktree", async () => {
			const tmpDir = mkdtempSync(join(tmpdir(), "ofa-test-"));
			try {
				execSync("git init", { cwd: tmpDir, stdio: "ignore" });
				execSync("git config user.email 'phase7@example.com'", {
					cwd: tmpDir,
					stdio: "ignore",
				});
				execSync("git config user.name 'Phase 7 Test'", {
					cwd: tmpDir,
					stdio: "ignore",
				});
				execSync("git commit --allow-empty -m 'initial commit'", {
					cwd: tmpDir,
					stdio: "ignore",
				});
				const repo = await service.setRepositoryRoot(tmpDir);
				const main = (await service.listWorktrees(repo)).find((entry) => entry.isMain)!;

				await expect(service.removeWorktree(repo, main.id)).rejects.toThrow(
					"Cannot remove the main worktree.",
				);
			} finally {
				rmSync(tmpDir, { recursive: true, force: true });
			}
		});
	});
});
