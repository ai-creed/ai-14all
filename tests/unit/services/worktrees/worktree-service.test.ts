// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
	mkdtempSync,
	rmSync,
	writeFileSync,
	mkdirSync,
	realpathSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { WorktreeService } from "../../../../services/worktrees/worktree-service.js";
import { GitService } from "../../../../services/git/git-service.js";

/**
 * Creates a temporary git repo with a real commit and a remote tracking branch.
 * By default the remote branch is `master` and `origin/HEAD` points at it,
 * mirroring a freshly-cloned repo. Override via options to exercise non-master
 * defaults or a repo whose `origin/HEAD` is unset.
 * The caller is responsible for cleanup via `rmSync(tmpDir, { recursive: true, force: true })`.
 */
function makeRepo(opts?: {
	remoteBranch?: string;
	setOriginHead?: boolean;
}): string {
	const remoteBranch = opts?.remoteBranch ?? "master";
	const setOriginHead = opts?.setOriginHead ?? true;
	const tmpDir = mkdtempSync(join(tmpdir(), "ofa-test-"));
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
	execSync('git commit -m "initial commit"', { cwd: tmpDir, stdio: "ignore" });
	execSync(`git update-ref refs/remotes/origin/${remoteBranch} HEAD`, {
		cwd: tmpDir,
		stdio: "ignore",
	});
	if (setOriginHead) {
		execSync(
			`git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/${remoteBranch}`,
			{ cwd: tmpDir, stdio: "ignore" },
		);
	}
	return tmpDir;
}

function makeTestRepo(): string {
	return makeRepo();
}

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

				vi.spyOn(GitService.prototype, "readOrCreateRepoId").mockResolvedValue(
					null,
				);

				const repo = await service.setRepositoryRoot(tmpDir);

				expect(repo.rootPath).toBe(tmpDir);
				expect(repo.repoId).toBeNull();
			} finally {
				vi.restoreAllMocks();
				rmSync(tmpDir, { recursive: true });
			}
		});
	});

	describe("setRepositoryRoot — worktree repair", () => {
		it("repairs stale worktree paths when repo directory was renamed", async () => {
			const tmpDir = makeTestRepo();
			try {
				execSync("git branch wt-branch", { cwd: tmpDir, stdio: "ignore" });
				mkdirSync(join(tmpDir, ".worktrees"), { recursive: true });
				const wtPath = join(tmpDir, ".worktrees", "wt-branch");
				execSync(`git worktree add "${wtPath}" wt-branch`, {
					cwd: tmpDir,
					stdio: "ignore",
				});

				// Simulate a repo rename by rewriting the gitdir pointer to a
				// non-existent path, as would happen after `mv repo-old repo-new`.
				const gitdirFile = join(
					tmpDir,
					".git",
					"worktrees",
					"wt-branch",
					"gitdir",
				);
				writeFileSync(
					gitdirFile,
					"/nonexistent/old-repo/.worktrees/wt-branch/.git\n",
				);

				// Before repair, git considers this worktree prunable.
				const porcelain = execSync("git worktree list --porcelain", {
					cwd: tmpDir,
				}).toString();
				expect(porcelain).toContain("prunable");

				// Loading the repository should auto-repair the stale path.
				const repo = await service.setRepositoryRoot(tmpDir);

				const porcelainAfter = execSync("git worktree list --porcelain", {
					cwd: tmpDir,
				}).toString();
				expect(porcelainAfter).not.toContain("prunable");

				const worktrees = await service.listWorktrees(repo);
				expect(worktrees.some((wt) => wt.branchName === "wt-branch")).toBe(
					true,
				);
			} finally {
				rmSync(tmpDir, { recursive: true, force: true });
			}
		});
	});

	describe("listWorktrees", () => {
		it("excludes worktrees whose directories no longer exist on disk", async () => {
			const tmpDir = makeTestRepo();
			try {
				execSync("git branch stale-branch", { cwd: tmpDir, stdio: "ignore" });
				mkdirSync(join(tmpDir, ".worktrees"), { recursive: true });
				const stalePath = join(tmpDir, ".worktrees", "stale-branch");
				execSync(`git worktree add "${stalePath}" stale-branch`, {
					cwd: tmpDir,
					stdio: "ignore",
				});

				const repo = await service.setRepositoryRoot(tmpDir);

				// Verify the worktree appears before deletion
				const before = await service.listWorktrees(repo);
				expect(before.some((wt) => wt.branchName === "stale-branch")).toBe(
					true,
				);

				// Simulate external deletion of the worktree directory (but NOT git prune)
				rmSync(stalePath, { recursive: true, force: true });

				// After directory removal, listWorktrees should exclude it
				const after = await service.listWorktrees(repo);
				expect(after.some((wt) => wt.branchName === "stale-branch")).toBe(
					false,
				);
				expect(after.length).toBe(before.length - 1);
			} finally {
				rmSync(tmpDir, { recursive: true, force: true });
			}
		});

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
			const tmpDir = makeTestRepo();
			try {
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

		it("resolves the base ref from origin/HEAD for a non-master default branch", async () => {
			const tmpDir = makeRepo({ remoteBranch: "main" });
			try {
				const repo = await service.setRepositoryRoot(tmpDir);
				const preview = await service.previewCreateWorktree(repo, "Feature A");

				expect(preview.baseRef).toBe("origin/main");
				expect(preview.baseCommit.subject).toBe("initial commit");
			} finally {
				rmSync(tmpDir, { recursive: true, force: true });
			}
		});

		it("falls back to origin/master when origin/HEAD is unset", async () => {
			// makeRepo always creates refs/remotes/origin/<branch>; with the HEAD
			// symref unset, resolution falls through to the origin/master candidate.
			const tmpDir = makeRepo({ setOriginHead: false });
			try {
				const repo = await service.setRepositoryRoot(tmpDir);
				const preview = await service.previewCreateWorktree(repo, "Feature A");
				expect(preview.baseRef).toBe("origin/master");
				expect(preview.note).toBeUndefined();
			} finally {
				rmSync(tmpDir, { recursive: true, force: true });
			}
		});

		it("falls back to origin/main when origin/HEAD is unset and main exists", async () => {
			// Covers §5.4 step 2 (origin/main preferred over the first-branch fallback).
			const tmpDir = makeRepo({ remoteBranch: "main", setOriginHead: false });
			try {
				const repo = await service.setRepositoryRoot(tmpDir);
				const preview = await service.previewCreateWorktree(repo, "Feature A");
				expect(preview.baseRef).toBe("origin/main");
				expect(preview.note).toBeUndefined();
			} finally {
				rmSync(tmpDir, { recursive: true, force: true });
			}
		});

		it("falls back to the first origin/* (deterministic refname order) when neither main nor master exists", async () => {
			// Covers §5.4 step 3. makeRepo gives origin/zzz; add origin/aaa out of
			// alphabetical order. `git for-each-ref` returns refs sorted by refname,
			// so origin/aaa must win deterministically — not insertion order.
			const tmpDir = makeRepo({ remoteBranch: "zzz", setOriginHead: false });
			try {
				execSync("git update-ref refs/remotes/origin/aaa HEAD", {
					cwd: tmpDir,
					stdio: "ignore",
				});
				const repo = await service.setRepositoryRoot(tmpDir);
				const preview = await service.previewCreateWorktree(repo, "Feature A");
				expect(preview.baseRef).toBe("origin/aaa");
				expect(preview.note).toBeUndefined();
			} finally {
				rmSync(tmpDir, { recursive: true, force: true });
			}
		});

		it("falls back to the local HEAD with a note when there are no origin branches", async () => {
			const tmpDir = mkdtempSync(join(tmpdir(), "ofa-test-"));
			try {
				execSync("git init", { cwd: tmpDir, stdio: "ignore" });
				execSync("git config user.email 'base@example.com'", {
					cwd: tmpDir,
					stdio: "ignore",
				});
				execSync("git config user.name 'Base Test'", {
					cwd: tmpDir,
					stdio: "ignore",
				});
				writeFileSync(join(tmpDir, "README.md"), "# repo\n");
				execSync("git add README.md", { cwd: tmpDir, stdio: "ignore" });
				execSync('git commit -m "initial commit"', {
					cwd: tmpDir,
					stdio: "ignore",
				});
				const repo = await service.setRepositoryRoot(tmpDir);
				const preview = await service.previewCreateWorktree(repo, "Feature A");
				expect(preview.baseRef).toBe("HEAD");
				expect(preview.note).toMatch(/local HEAD/i);
			} finally {
				rmSync(tmpDir, { recursive: true, force: true });
			}
		});

		it("previews the explicit baseBranch's tip AND commit (not the default's)", async () => {
			const tmpDir = makeTestRepo();
			try {
				// origin/devel must be a DISTINCT commit from the default so this proves
				// baseRef AND baseCommit reflect the selected base, not origin/master.
				// `git commit-tree` builds a new commit object without moving any branch.
				const develSha = execSync(
					'git commit-tree HEAD^{tree} -p HEAD -m "devel-only commit"',
					{ cwd: tmpDir },
				)
					.toString()
					.trim();
				execSync(`git update-ref refs/remotes/origin/devel ${develSha}`, {
					cwd: tmpDir,
					stdio: "ignore",
				});
				const repo = await service.setRepositoryRoot(tmpDir);

				const defaultPreview = await service.previewCreateWorktree(
					repo,
					"Feature A",
				);
				const develPreview = await service.previewCreateWorktree(
					repo,
					"Feature A",
					"origin/devel",
				);

				// Default still resolves to origin/master's "initial commit".
				expect(defaultPreview.baseRef).toBe("origin/master");
				expect(defaultPreview.baseCommit.subject).toBe("initial commit");
				// The explicit base reflects origin/devel in BOTH baseRef and baseCommit.
				expect(develPreview.baseRef).toBe("origin/devel");
				expect(develPreview.baseCommit.sha).toBe(develSha);
				expect(develPreview.baseCommit.subject).toBe("devel-only commit");
			} finally {
				rmSync(tmpDir, { recursive: true, force: true });
			}
		});

		it("throws a clear error when the chosen baseBranch is not on origin", async () => {
			const tmpDir = makeTestRepo();
			try {
				const repo = await service.setRepositoryRoot(tmpDir);
				await expect(
					service.previewCreateWorktree(repo, "Feature A", "origin/ghost"),
				).rejects.toThrow(/origin\/ghost.*not.*found|deleted/is);
			} finally {
				rmSync(tmpDir, { recursive: true, force: true });
			}
		});
	});

	describe("createWorktree", () => {
		it("creates a linked worktree on a new branch from origin/master", async () => {
			const tmpDir = makeTestRepo();
			try {
				const repo = await service.setRepositoryRoot(tmpDir);
				const created = await service.createWorktree(repo, "Feature B");

				expect(created.branchName).toBe("feature-b");
				// realpathSync resolves symlinks (e.g. /var → /private/var on macOS)
				// so the comparison matches git's resolved path.
				expect(created.path).toBe(
					join(realpathSync(tmpDir), ".worktrees", "feature-b"),
				);
				expect(
					execSync("git branch --list feature-b", { cwd: tmpDir }).toString(),
				).toContain("feature-b");
				expect(
					execSync('git -C "' + created.path + '" branch --show-current')
						.toString()
						.trim(),
				).toBe("feature-b");
			} finally {
				rmSync(tmpDir, { recursive: true, force: true });
			}
		});

		it("creates a linked worktree for an existing branch when no worktree exists yet", async () => {
			const tmpDir = makeTestRepo();
			try {
				execSync("git branch existing-branch", {
					cwd: tmpDir,
					stdio: "ignore",
				});

				const repo = await service.setRepositoryRoot(tmpDir);
				const created = await service.createWorktree(repo, "existing-branch");

				expect(created.branchName).toBe("existing-branch");
				expect(created.path).toBe(
					join(realpathSync(tmpDir), ".worktrees", "existing-branch"),
				);
				expect(
					execSync('git -C "' + created.path + '" branch --show-current')
						.toString()
						.trim(),
				).toBe("existing-branch");
			} finally {
				rmSync(tmpDir, { recursive: true, force: true });
			}
		});

		it("returns id and path consistent with listWorktrees (no unresolved-symlink override)", async () => {
			// On macOS, mkdtempSync returns /var/... which git resolves to /private/var/...
			// The bug: createWorktree overrides with preview.path (unresolved) so the id
			// never matches what listWorktrees returns — breaking auto-select after create.
			const tmpDir = makeTestRepo();
			try {
				const repo = await service.setRepositoryRoot(tmpDir);
				const created = await service.createWorktree(repo, "Symlink ID Test");

				const worktrees = await service.listWorktrees(repo);
				const found = worktrees.find(
					(wt) => wt.branchName === "symlink-id-test",
				);
				expect(found).toBeDefined();
				expect(created.id).toBe(found!.id);
				expect(created.path).toBe(found!.path);
			} finally {
				rmSync(tmpDir, { recursive: true, force: true });
			}
		});

		it("deletes the branch when git worktree add fails (rollback)", async () => {
			// Bug: if git worktree add fails after git branch succeeds, the branch
			// is stranded. Fix: catch the failure and delete the branch before rethrowing.
			const tmpDir = makeTestRepo();
			try {
				const repo = await service.setRepositoryRoot(tmpDir);

				// Create a file at the target path so git worktree add will fail.
				mkdirSync(join(tmpDir, ".worktrees"), { recursive: true });
				const conflictPath = join(tmpDir, ".worktrees", "rollback-test");
				writeFileSync(conflictPath, "blocking file\n");

				// Bypass the previewCreateWorktree pathExists guard so we reach git worktree add.
				vi.spyOn(service, "previewCreateWorktree").mockResolvedValueOnce({
					name: "Rollback Test",
					branchName: "rollback-test",
					path: conflictPath,
					baseRef: "origin/master",
					baseCommit: {
						sha: "deadbeef1234",
						shortSha: "deadbee",
						subject: "initial commit",
					},
				});

				await expect(
					service.createWorktree(repo, "Rollback Test"),
				).rejects.toThrow();

				// Branch must be cleaned up — no dangling branch left behind.
				const branches = execSync("git branch --list rollback-test", {
					cwd: tmpDir,
				})
					.toString()
					.trim();
				expect(branches).toBe("");
			} finally {
				vi.restoreAllMocks();
				rmSync(tmpDir, { recursive: true, force: true });
			}
		});

		it("creates the branch via `git branch <name> origin/devel` (command + tip verified)", async () => {
			const tmpDir = makeTestRepo();
			try {
				// Distinct origin/devel commit so the assertions prove the base ref used.
				const develSha = execSync(
					'git commit-tree HEAD^{tree} -p HEAD -m "devel-only commit"',
					{ cwd: tmpDir },
				)
					.toString()
					.trim();
				execSync(`git update-ref refs/remotes/origin/devel ${develSha}`, {
					cwd: tmpDir,
					stdio: "ignore",
				});
				const repo = await service.setRepositoryRoot(tmpDir);
				const created = await service.createWorktree(
					repo,
					"Feature D",
					"origin/devel",
				);
				expect(created.branchName).toBe("feature-d");

				// Command-shape proof: `git branch feature-d origin/devel` records the
				// start-point verbatim in the branch reflog as "Created from origin/devel",
				// so this fails if the implementation issues a different command shape.
				const reflog = execSync("git reflog show feature-d", {
					cwd: tmpDir,
				}).toString();
				expect(reflog).toContain("branch: Created from origin/devel");

				// Behavioral proof: the branch points at origin/devel's tip, NOT the default.
				const branchSha = execSync("git rev-parse feature-d", { cwd: tmpDir })
					.toString()
					.trim();
				const masterSha = execSync("git rev-parse origin/master", {
					cwd: tmpDir,
				})
					.toString()
					.trim();
				expect(branchSha).toBe(develSha);
				expect(branchSha).not.toBe(masterSha);
			} finally {
				rmSync(tmpDir, { recursive: true, force: true });
			}
		});

		it("does not delete a pre-existing branch when git worktree add fails", async () => {
			const tmpDir = makeTestRepo();
			try {
				execSync("git branch existing-branch", {
					cwd: tmpDir,
					stdio: "ignore",
				});
				const repo = await service.setRepositoryRoot(tmpDir);

				mkdirSync(join(tmpDir, ".worktrees"), { recursive: true });
				const conflictPath = join(tmpDir, ".worktrees", "existing-branch");
				writeFileSync(conflictPath, "blocking file\n");

				vi.spyOn(service, "previewCreateWorktree").mockResolvedValueOnce({
					name: "existing-branch",
					branchName: "existing-branch",
					path: conflictPath,
					baseRef: "origin/master",
					baseCommit: {
						sha: "deadbeef1234",
						shortSha: "deadbee",
						subject: "initial commit",
					},
				});

				await expect(
					service.createWorktree(repo, "existing-branch"),
				).rejects.toThrow();

				const branches = execSync("git branch --list existing-branch", {
					cwd: tmpDir,
				})
					.toString()
					.trim();
				expect(branches).toContain("existing-branch");
			} finally {
				vi.restoreAllMocks();
				rmSync(tmpDir, { recursive: true, force: true });
			}
		});
	});

	describe("listRemoteBranches", () => {
		it("lists origin/* branches and excludes the origin/HEAD alias", async () => {
			const tmpDir = makeTestRepo();
			try {
				execSync("git update-ref refs/remotes/origin/devel HEAD", {
					cwd: tmpDir,
					stdio: "ignore",
				});
				const repo = await service.setRepositoryRoot(tmpDir);
				const { branches, defaultBranch } =
					await service.listRemoteBranches(repo);

				expect(branches).toContain("origin/master");
				expect(branches).toContain("origin/devel");
				// `%(refname:short)` renders the HEAD symref as the bare `origin`.
				expect(branches).not.toContain("origin");
				expect(branches.every((b) => b.startsWith("origin/"))).toBe(true);
				expect(defaultBranch).toBe("origin/master");
			} finally {
				rmSync(tmpDir, { recursive: true, force: true });
			}
		});
	});

	describe("refreshRemote", () => {
		it("returns ok:false with an error message when origin is unreachable", async () => {
			const tmpDir = makeTestRepo();
			try {
				execSync("git remote add origin file:///nonexistent/repo-abc123.git", {
					cwd: tmpDir,
					stdio: "ignore",
				});
				const repo = await service.setRepositoryRoot(tmpDir);
				const result = await service.refreshRemote(repo);

				expect(result.ok).toBe(false);
				expect(result.error).toBeTruthy();
			} finally {
				rmSync(tmpDir, { recursive: true, force: true });
			}
		});
	});

	describe("removeWorktree", () => {
		it("previews dirty non-main worktrees and removes both worktree and branch", async () => {
			const tmpDir = makeTestRepo();
			try {
				execSync("git branch feature-c", { cwd: tmpDir, stdio: "ignore" });
				mkdirSync(join(tmpDir, ".worktrees"), { recursive: true });
				execSync(
					`git worktree add "${join(tmpDir, ".worktrees", "feature-c")}" feature-c`,
					{
						cwd: tmpDir,
						stdio: "ignore",
					},
				);
				writeFileSync(
					join(tmpDir, ".worktrees", "feature-c", "dirty.txt"),
					"dirty\n",
				);

				const repo = await service.setRepositoryRoot(tmpDir);
				const worktree = (await service.listWorktrees(repo)).find(
					(entry) => !entry.isMain,
				)!;
				const preview = await service.previewRemoveWorktree(repo, worktree.id);
				expect(preview.isDirty).toBe(true);

				await service.removeWorktree(repo, worktree.id);

				expect(
					execSync("git worktree list --porcelain", { cwd: tmpDir }).toString(),
				).not.toContain(".worktrees/feature-c");
				expect(
					execSync("git branch --list feature-c", { cwd: tmpDir })
						.toString()
						.trim(),
				).toBe("");
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
				const main = (await service.listWorktrees(repo)).find(
					(entry) => entry.isMain,
				)!;

				await expect(service.removeWorktree(repo, main.id)).rejects.toThrow(
					"Cannot remove the main worktree.",
				);
			} finally {
				rmSync(tmpDir, { recursive: true, force: true });
			}
		});
	});
});

describe("WorktreeService.findWorktree", () => {
	let repoPath: string;

	beforeEach(() => {
		repoPath = realpathSync(mkdtempSync(join(tmpdir(), "ofa-wt-find-")));
		execSync("git init -q", { cwd: repoPath });
		execSync("git config user.email test@a.dev", { cwd: repoPath });
		execSync("git config user.name test", { cwd: repoPath });
		writeFileSync(join(repoPath, "README.md"), "hi\n");
		execSync("git add -A && git commit -q -m init", {
			cwd: repoPath,
			shell: "/bin/zsh",
		});
	});

	afterEach(() => {
		rmSync(repoPath, { recursive: true, force: true });
	});

	it("returns the worktree whose id matches", async () => {
		const svc = new WorktreeService();
		const repo = await svc.setRepositoryRoot(repoPath);
		const worktrees = await svc.listWorktrees(repo);
		const target = worktrees[0]!;
		await expect(svc.findWorktree(repo, target.id)).resolves.toEqual(target);
	});

	it("throws for an unknown worktree id", async () => {
		const svc = new WorktreeService();
		const repo = await svc.setRepositoryRoot(repoPath);
		await expect(svc.findWorktree(repo, "wt-nope")).rejects.toThrow(
			/Unknown worktree/,
		);
	});
});
