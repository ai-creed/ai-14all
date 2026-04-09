import { stat, access, mkdir, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import type { Repository } from "../../shared/models/repository.js";
import type { Worktree } from "../../shared/models/worktree.js";
import type {
	CreateWorktreePreview,
	RemoveWorktreePreview,
} from "../../shared/models/worktree-lifecycle.js";
import { parseWorktreePorcelain } from "./parse-worktree-porcelain.js";
import { getGitBinaryPath } from "../git/git-binary.js";
import { GitService } from "../git/git-service.js";

const execFileAsync = promisify(execFile);
const gitBinary = getGitBinaryPath();
const gitService = new GitService();

async function git(args: string[], cwd: string): Promise<string> {
	const { stdout } = await execFileAsync(gitBinary, args, { cwd });
	return stdout.trim();
}

function normalizeWorktreeName(input: string): string {
	return input
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

async function localBranchExists(repository: Repository, branchName: string): Promise<boolean> {
	return execFileAsync(
		gitBinary,
		["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`],
		{ cwd: repository.rootPath },
	).then(() => true).catch(() => false);
}

export class WorktreeService {
	/**
	 * Validates `rootPath` as an existing directory that is the root of a git
	 * repository, then returns a Repository object.
	 *
	 * Throws if the path does not exist, is not a directory, or is not a git
	 * repo root.
	 */
	async setRepositoryRoot(rootPath: string): Promise<Repository> {
		// Verify path exists and is a directory
		const stats = await stat(rootPath);
		if (!stats.isDirectory()) {
			throw new Error(`Path is not a directory: ${rootPath}`);
		}

		// Verify it is inside a git repo and get the actual toplevel
		let toplevel: string;
		try {
			toplevel = await git(["rev-parse", "--show-toplevel"], rootPath);
		} catch {
			throw new Error(`Not a git repository: ${rootPath}`);
		}

		// Normalize: on macOS /var is a symlink to /private/var, so stat both and
		// compare inodes to handle resolved vs unresolved paths gracefully.
		const [rootStat, toplevelStat] = await Promise.all([
			stat(rootPath),
			stat(toplevel),
		]);

		if (
			rootStat.ino !== toplevelStat.ino ||
			rootStat.dev !== toplevelStat.dev
		) {
			throw new Error(
				`Path is not the git repository root. Root is: ${toplevel}`,
			);
		}

		const repoId = await gitService.readOrCreateRepoId(toplevel);

		// Repair stale worktree paths left behind by repo renames/moves.
		// This is idempotent and fast when paths are already correct.
		const worktreesDir = join(rootPath, ".worktrees");
		if (await pathExists(worktreesDir)) {
			try {
				const entries = await readdir(worktreesDir, { withFileTypes: true });
				const dirs = entries
					.filter((e) => e.isDirectory())
					.map((e) => join(worktreesDir, e.name));
				if (dirs.length > 0) {
					await execFileAsync(gitBinary, ["worktree", "repair", ...dirs], {
						cwd: rootPath,
					});
				}
			} catch {
				// Repair is best-effort; don't block repository loading.
			}
		}

		return {
			id: randomUUID(),
			name: basename(toplevel),
			rootPath,
			repoId,
		};
	}

	/**
	 * Returns the list of worktrees for the given repository.
	 *
	 * Runs `git worktree list --porcelain` and parses the output.
	 */
	async listWorktrees(repository: Repository): Promise<Worktree[]> {
		const output = await git(
			["worktree", "list", "--porcelain"],
			repository.rootPath,
		);
		const all = parseWorktreePorcelain(output, repository.id);
		const live: Worktree[] = [];
		for (const wt of all) {
			if (await pathExists(wt.path)) {
				live.push(wt);
			}
		}
		return live;
	}

	async previewCreateWorktree(
		repository: Repository,
		name: string,
	): Promise<CreateWorktreePreview> {
		const normalizedName = normalizeWorktreeName(name);
		if (!normalizedName) {
			throw new Error("Worktree name must contain at least one letter or number.");
		}

		try {
			await execFileAsync(gitBinary, ["check-ref-format", "--branch", normalizedName], {
				cwd: repository.rootPath,
			});
		} catch {
			throw new Error(`"${normalizedName}" is not a valid Git branch name.`);
		}

		const path = join(repository.rootPath, ".worktrees", normalizedName);
		if (await pathExists(path)) {
			throw new Error(`Worktree path already exists: ${path}`);
		}

		const { stdout } = await execFileAsync(
			gitBinary,
			["log", "--format=%H%x09%h%x09%s", "-n", "1", "origin/master"],
			{ cwd: repository.rootPath },
		);
		const [sha, shortSha, subject] = stdout.trim().split("\t");
		if (!sha || !shortSha) {
			throw new Error("Could not resolve origin/master.");
		}

		return {
			name: name.trim(),
			branchName: normalizedName,
			path,
			baseRef: "origin/master",
			baseCommit: { sha, shortSha, subject: subject ?? "" },
		};
	}

	async createWorktree(repository: Repository, name: string): Promise<Worktree> {
		const preview = await this.previewCreateWorktree(repository, name);
		await mkdir(join(repository.rootPath, ".worktrees"), { recursive: true });
		const branchExists = await localBranchExists(repository, preview.branchName);
		const createdBranch = !branchExists;
		if (createdBranch) {
			try {
				await execFileAsync(
					gitBinary,
					["branch", preview.branchName, preview.baseRef],
					{ cwd: repository.rootPath },
				);
			} catch {
				throw new Error(
					`Could not create branch ${preview.branchName}. Another process may have created it after preview validation.`,
				);
			}
		}
		try {
			await execFileAsync(
				gitBinary,
				["worktree", "add", preview.path, preview.branchName],
				{ cwd: repository.rootPath },
			);
		} catch {
			if (createdBranch) {
				// git worktree add failed — roll back only the branch created by this call.
				await execFileAsync(gitBinary, ["branch", "-D", preview.branchName], {
					cwd: repository.rootPath,
				}).catch(() => {});
				throw new Error(
					`Could not create worktree at ${preview.path}. The branch ${preview.branchName} has been removed.`,
				);
			}
			throw new Error(
				`Could not create worktree at ${preview.path} for existing branch ${preview.branchName}.`,
			);
		}
		const worktrees = await this.listWorktrees(repository);
		const created = worktrees.find((entry) => entry.branchName === preview.branchName && !entry.isMain);
		if (!created) {
			throw new Error(`Created worktree not found after refresh: ${preview.path}`);
		}
		return created;
	}

	async previewRemoveWorktree(
		repository: Repository,
		worktreeId: string,
	): Promise<RemoveWorktreePreview> {
		const worktree = (await this.listWorktrees(repository)).find(
			(entry) => entry.id === worktreeId,
		);
		if (!worktree) {
			throw new Error(`Worktree not found: ${worktreeId}`);
		}
		if (worktree.isMain) {
			throw new Error("Cannot remove the main worktree.");
		}
		const summary = await gitService.readSummary(worktree.path);
		return {
			worktreeId: worktree.id,
			label: worktree.label,
			branchName: worktree.branchName,
			path: worktree.path,
			isMain: worktree.isMain,
			isDirty: summary.isDirty,
		};
	}

	async removeWorktree(repository: Repository, worktreeId: string): Promise<void> {
		const preview = await this.previewRemoveWorktree(repository, worktreeId);
		await execFileAsync(
			gitBinary,
			["worktree", "remove", "--force", preview.path],
			{ cwd: repository.rootPath },
		);
		await execFileAsync(
			gitBinary,
			["branch", "-D", preview.branchName],
			{ cwd: repository.rootPath },
		);
	}
}
