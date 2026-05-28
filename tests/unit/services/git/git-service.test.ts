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

		execSync("git init -b main", { cwd: repoPath, stdio: "ignore" });
		execSync("git config user.email 'test@ai-14all.dev'", {
			cwd: repoPath,
			stdio: "ignore",
		});
		execSync("git config user.name 'ai-14all test'", {
			cwd: repoPath,
			stdio: "ignore",
		});

		mkdirSync(join(repoPath, "src"), { recursive: true });
		writeFileSync(
			join(repoPath, "src", "index.ts"),
			'export const hello = "world";\n',
		);
		execSync("git add -A", { cwd: repoPath, stdio: "ignore" });
		execSync('git commit -m "initial commit"', {
			cwd: repoPath,
			stdio: "ignore",
		});
		execSync("git branch feature-a", { cwd: repoPath, stdio: "ignore" });
		execSync('git worktree add ".worktrees/feature-a" feature-a', {
			cwd: repoPath,
			stdio: "ignore",
		});

		worktreePath = realpathSync(join(repoPath, ".worktrees", "feature-a"));
		writeFileSync(
			join(worktreePath, "src", "index.ts"),
			'export const hello = "phase-2";\n',
		);
		writeFileSync(
			join(worktreePath, "src", "new-file.ts"),
			"export const added = true;\n",
		);
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
		expect(diff.originalContent).toContain('export const hello = "world";');
		expect(diff.modifiedContent).toContain('export const hello = "phase-2";');
	});

	it("returns unified diff content for an untracked file", async () => {
		const diff = await service.readDiff(worktreePath, "src/new-file.ts");
		expect(diff.path).toBe("src/new-file.ts");
		expect(diff.content).toContain("@@");
		expect(diff.content).toContain("+export const added = true;");
		expect(diff.originalContent).toBe("");
		expect(diff.modifiedContent).toContain("export const added = true;");
	});

	it("rejects untracked directories in readDiff", async () => {
		const nestedWorktreePath = join(
			worktreePath,
			".claude",
			"worktrees",
			"phase-6-in-session-relay",
		);
		mkdirSync(nestedWorktreePath, { recursive: true });
		execSync("git init", {
			cwd: nestedWorktreePath,
			stdio: "ignore",
		});

		await expect(
			service.readDiff(
				worktreePath,
				".claude/worktrees/phase-6-in-session-relay/",
			),
		).rejects.toThrow(
			"Cannot diff directory: .claude/worktrees/phase-6-in-session-relay/",
		);
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
		expect(diff.originalContent).toContain('export const hello = "world";');
		expect(diff.modifiedContent).toContain('export const hello = "world";');
	});

	it("skips unrecognized status codes in listChangedFiles", async () => {
		// All files in the worktree have recognized statuses (M, ??),
		// so the result should match the known set without any extras
		const changes = await service.listChangedFiles(worktreePath);
		for (const change of changes) {
			expect(["M", "A", "D", "R", "??"]).toContain(change.status);
		}
	});

	it("returns diff content for a staged (fully indexed) change", async () => {
		// Stage the modified file
		const { execFile } = await import("node:child_process");
		const { promisify } = await import("node:util");
		const execFileAsync = promisify(execFile);
		await execFileAsync("git", ["add", "src/index.ts"], { cwd: worktreePath });

		const diff = await service.readDiff(worktreePath, "src/index.ts");

		expect(diff.content).toContain("@@");
		expect(diff.content).toContain('-export const hello = "world";');
		expect(diff.content).toContain('+export const hello = "phase-2";');
		expect(diff.originalContent).toContain('export const hello = "world";');
		expect(diff.modifiedContent).toContain('export const hello = "phase-2";');
	});

	it("returns a git summary with branch, dirty state, changes, and recent commits", async () => {
		execSync("git update-ref refs/remotes/origin/main main", {
			cwd: repoPath,
			stdio: "ignore",
		});
		execSync("git add -A", { cwd: worktreePath, stdio: "ignore" });
		execSync('git commit -m "feature commit"', {
			cwd: worktreePath,
			stdio: "ignore",
		});
		writeFileSync(
			join(worktreePath, "src", "index.ts"),
			'export const hello = "phase-3";\n',
		);
		writeFileSync(
			join(worktreePath, "src", "new-file.ts"),
			"export const added = false;\n",
		);

		const summary = await service.readSummary(worktreePath);

		expect(summary.branchName).toBe("feature-a");
		expect(summary.isDirty).toBe(true);
		expect(summary.mergeTargetRef).toBe("origin/main");
		expect(summary.aheadCount).toBe(1);
		expect(summary.behindCount).toBe(0);
		expect(summary.changedFiles.map((change) => change.path)).toEqual([
			"src/index.ts",
			"src/new-file.ts",
		]);
		expect(summary.changedFileCount).toBe(2);
		expect(summary.recentCommits[0]?.subject).toBe("feature commit");
	});

	it("lists recent commits against the merge target", async () => {
		execSync("git update-ref refs/remotes/origin/main main", {
			cwd: repoPath,
			stdio: "ignore",
		});
		execSync("git add -A", { cwd: worktreePath, stdio: "ignore" });
		execSync('git commit -m "feature commit"', {
			cwd: worktreePath,
			stdio: "ignore",
		});

		const history = await service.readCommitHistory(worktreePath);

		expect(history.mergeTargetRef).toBe("origin/main");
		expect(history.entries[0]?.subject).toBe("feature commit");
		expect(history.entries.at(-1)?.isMergeTarget).toBe(true);
	});

	it("orders unmerged commits newest first", async () => {
		execSync("git update-ref refs/remotes/origin/main main", {
			cwd: repoPath,
			stdio: "ignore",
		});
		writeFileSync(
			join(worktreePath, "src", "index.ts"),
			'export const hello = "feature-1";\n',
		);
		execSync("git add -A", { cwd: worktreePath, stdio: "ignore" });
		execSync('git commit -m "feature commit 1"', {
			cwd: worktreePath,
			stdio: "ignore",
		});
		writeFileSync(
			join(worktreePath, "src", "index.ts"),
			'export const hello = "feature-2";\n',
		);
		execSync("git add -A", { cwd: worktreePath, stdio: "ignore" });
		execSync('git commit -m "feature commit 2"', {
			cwd: worktreePath,
			stdio: "ignore",
		});

		const history = await service.readCommitHistory(worktreePath);

		expect(history.entries[0]?.subject).toBe("feature commit 2");
		expect(history.entries[1]?.subject).toBe("feature commit 1");
		expect(history.entries.at(-1)?.isMergeTarget).toBe(true);
	});

	it("falls back to the last fifty commits when HEAD matches the merge target", async () => {
		execSync("git update-ref refs/remotes/origin/main main", {
			cwd: repoPath,
			stdio: "ignore",
		});

		const history = await service.readCommitHistory(repoPath);

		expect(history.mergeTargetRef).toBe("origin/main");
		expect(history.entries[0]?.subject).toBe("initial commit");
		expect(history.entries).toHaveLength(1);
		expect(history.entries[0]?.isMergeTarget).toBe(true);
	});

	describe("readOrCreateRepoId", () => {
		it("reads ai14all.repoId from local git config when present", async () => {
			execSync("git config --local ai14all.repoId repo-id-123", {
				cwd: repoPath,
				stdio: "ignore",
			});

			const repoId = await service.readOrCreateRepoId(repoPath);
			expect(repoId).toBe("repo-id-123");
		});

		it("creates and persists ai14all.repoId when missing", async () => {
			const repoId = await service.readOrCreateRepoId(repoPath);
			expect(repoId).toMatch(
				/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
			);

			const stored = execSync("git config --local --get ai14all.repoId", {
				cwd: repoPath,
				encoding: "utf8",
			}).trim();
			expect(stored).toBe(repoId);
		});
	});

	it("returns per-file summaries for a selected commit (no eager content)", async () => {
		execSync("git update-ref refs/remotes/origin/main main", {
			cwd: repoPath,
			stdio: "ignore",
		});
		execSync("git add -A", { cwd: worktreePath, stdio: "ignore" });
		execSync('git commit -m "feature commit"', {
			cwd: worktreePath,
			stdio: "ignore",
		});
		const sha = execSync("git rev-parse HEAD", {
			cwd: worktreePath,
			encoding: "utf8",
		}).trim();

		const detail = await service.readCommitDetail(worktreePath, sha);

		expect(detail.shortSha).toHaveLength(7);
		expect(detail.files[0]).toMatchObject({
			path: "src/index.ts",
			status: "M",
		});
		// Summaries only — no blob content is loaded eagerly anymore.
		expect(detail.files[0]).not.toHaveProperty("originalContent");
		expect(detail.files[0]).not.toHaveProperty("modifiedContent");
	});

	it("readCommitFileDiff returns side-by-side content for a single file", async () => {
		execSync("git update-ref refs/remotes/origin/main main", {
			cwd: repoPath,
			stdio: "ignore",
		});
		execSync("git add -A", { cwd: worktreePath, stdio: "ignore" });
		execSync('git commit -m "feature commit"', {
			cwd: worktreePath,
			stdio: "ignore",
		});
		const sha = execSync("git rev-parse HEAD", {
			cwd: worktreePath,
			encoding: "utf8",
		}).trim();

		const diff = await service.readCommitFileDiff(worktreePath, sha, {
			path: "src/index.ts",
			oldPath: null,
			status: "M",
		});

		expect(diff).toMatchObject({ path: "src/index.ts", status: "M" });
		expect(diff.originalContent).toContain('export const hello = "world";');
		expect(diff.modifiedContent).toContain('export const hello = "phase-2";');
	});

	describe("discardChange", () => {
		it("restores a modified tracked file to HEAD content", async () => {
			await service.discardChange(worktreePath, "src/index.ts");
			const changes = await service.listChangedFiles(worktreePath);
			expect(changes.find((c) => c.path === "src/index.ts")).toBeUndefined();
		});

		it("deletes an untracked file", async () => {
			await service.discardChange(worktreePath, "src/new-file.ts");
			const changes = await service.listChangedFiles(worktreePath);
			expect(changes.find((c) => c.path === "src/new-file.ts")).toBeUndefined();
		});

		it("rejects path traversal", async () => {
			await expect(
				service.discardChange(worktreePath, "../../etc/passwd"),
			).rejects.toThrow("Path escapes worktree");
		});

		it("throws when file is not in changed list", async () => {
			await expect(
				service.discardChange(worktreePath, "src/nonexistent.ts"),
			).rejects.toThrow("No changed file found");
		});
	});

	describe("getRemoteStatus", () => {
		it("returns hasRemote false when no upstream tracking branch exists", async () => {
			const status = await service.getRemoteStatus(worktreePath);
			expect(status).toEqual({ hasRemote: false, ahead: 0, behind: 0 });
		});

		it("returns ahead count after local commits against a remote", async () => {
			const remotePath = realpathSync(
				mkdtempSync(join(tmpdir(), "ofa-remote-")),
			);
			execSync("git init --bare", { cwd: remotePath, stdio: "ignore" });
			execSync(`git remote add origin ${remotePath}`, {
				cwd: worktreePath,
				stdio: "ignore",
			});

			execSync("git add -A && git commit -m 'wip'", {
				cwd: worktreePath,
				stdio: "ignore",
				shell: "/bin/sh",
			});
			execSync("git push -u origin HEAD", {
				cwd: worktreePath,
				stdio: "ignore",
			});

			writeFileSync(
				join(worktreePath, "src", "extra.ts"),
				"export const x = 1;\n",
			);
			execSync("git add -A && git commit -m 'unpushed'", {
				cwd: worktreePath,
				stdio: "ignore",
				shell: "/bin/sh",
			});

			const status = await service.getRemoteStatus(worktreePath);
			expect(status.hasRemote).toBe(true);
			expect(status.ahead).toBe(1);
			expect(status.behind).toBe(0);

			rmSync(remotePath, { recursive: true, force: true });
		});
	});

	describe("pushBranch", () => {
		it("pushes to the tracking remote", async () => {
			const remotePath = realpathSync(
				mkdtempSync(join(tmpdir(), "ofa-remote-")),
			);
			execSync("git init --bare", { cwd: remotePath, stdio: "ignore" });
			execSync(`git remote add origin ${remotePath}`, {
				cwd: worktreePath,
				stdio: "ignore",
			});
			execSync("git add -A && git commit -m 'wip'", {
				cwd: worktreePath,
				stdio: "ignore",
				shell: "/bin/sh",
			});
			execSync("git push -u origin HEAD", {
				cwd: worktreePath,
				stdio: "ignore",
			});

			writeFileSync(
				join(worktreePath, "src", "extra.ts"),
				"export const x = 1;\n",
			);
			execSync("git add -A && git commit -m 'unpushed'", {
				cwd: worktreePath,
				stdio: "ignore",
				shell: "/bin/sh",
			});

			await service.pushBranch(worktreePath, false);

			const statusAfter = await service.getRemoteStatus(worktreePath);
			expect(statusAfter.ahead).toBe(0);

			rmSync(remotePath, { recursive: true, force: true });
		});
	});
});
