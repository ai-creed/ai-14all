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

async function localBranchExists(
	repository: Repository,
	branchName: string,
): Promise<boolean> {
	return execFileAsync(
		gitBinary,
		["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`],
		{ cwd: repository.rootPath },
	)
		.then(() => true)
		.catch(() => false);
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

	/**
	 * Returns the worktree whose `id` matches, or throws "Unknown worktree".
	 * Used by IPC handlers that take `worktreeId` from the renderer.
	 */
	async findWorktree(
		repository: Repository,
		worktreeId: string,
	): Promise<Worktree> {
		const worktrees = await this.listWorktrees(repository);
		const match = worktrees.find((wt) => wt.id === worktreeId);
		if (!match) throw new Error(`Unknown worktree: ${worktreeId}`);
		return match;
	}

	/**
	 * Lists the repository's remote-tracking branches as `origin/<branch>` refs.
	 *
	 * `%(refname:short)` renders the `refs/remotes/origin/HEAD` symref as the
	 * bare token `origin`; keeping only entries beginning with `origin/` drops
	 * that alias and returns the real branches in git's refname order.
	 */
	private async getOriginBranches(repository: Repository): Promise<string[]> {
		const stdout = await git(
			["for-each-ref", "--format=%(refname:short)", "refs/remotes/origin"],
			repository.rootPath,
		);
		return stdout
			.split("\n")
			.map((line) => line.trim())
			.filter((ref) => ref.startsWith("origin/"));
	}

	/**
	 * Returns the selectable `origin/*` base branches plus the resolved default
	 * (the concrete ref `origin/HEAD` points to, with fallbacks). One round-trip
	 * so the picker can both populate options and pre-select the default.
	 */
	async listRemoteBranches(
		repository: Repository,
	): Promise<{ branches: string[]; defaultBranch: string }> {
		const branches = await this.getOriginBranches(repository);
		const defaultBranch = await this.resolveDefaultBaseRef(repository);
		return { branches, defaultBranch };
	}

	/**
	 * Fetches from origin so the branch list and base tips are current. Network
	 * failures resolve to `{ ok: false, error }` rather than throwing, so the UI
	 * can warn without blocking session creation.
	 */
	async refreshRemote(
		repository: Repository,
	): Promise<{ ok: boolean; error?: string }> {
		try {
			await execFileAsync(gitBinary, ["fetch", "origin", "--prune"], {
				cwd: repository.rootPath,
				timeout: 20_000,
			});
			return { ok: true };
		} catch (error) {
			return {
				ok: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	async previewCreateWorktree(
		repository: Repository,
		name: string,
		baseBranch?: string,
	): Promise<CreateWorktreePreview> {
		const normalizedName = normalizeWorktreeName(name);
		if (!normalizedName) {
			throw new Error(
				"Worktree name must contain at least one letter or number.",
			);
		}

		try {
			await execFileAsync(
				gitBinary,
				["check-ref-format", "--branch", normalizedName],
				{
					cwd: repository.rootPath,
				},
			);
		} catch {
			throw new Error(`"${normalizedName}" is not a valid Git branch name.`);
		}

		const path = join(repository.rootPath, ".worktrees", normalizedName);
		if (await pathExists(path)) {
			throw new Error(`Worktree path already exists: ${path}`);
		}

		const baseRef = await this.resolveBaseRef(repository, baseBranch);
		const note =
			baseRef === "HEAD"
				? "origin has no branches — basing this session off the local HEAD."
				: undefined;

		const { stdout } = await execFileAsync(
			gitBinary,
			["log", "--format=%H%x09%h%x09%s", "-n", "1", baseRef],
			{ cwd: repository.rootPath },
		);
		const [sha, shortSha, subject] = stdout.trim().split("\t");
		if (!sha || !shortSha) {
			throw new Error(`Could not resolve ${baseRef}.`);
		}

		return {
			name: name.trim(),
			branchName: normalizedName,
			path,
			baseRef,
			baseCommit: { sha, shortSha, subject: subject ?? "" },
			...(note ? { note } : {}),
		};
	}

	/**
	 * Resolves the repository's default base ref, in order:
	 *   1. the remote's symbolic HEAD (e.g. `origin/main`) — today's behavior,
	 *   2. `origin/main`, then `origin/master`, if present,
	 *   3. the first `origin/*` branch in git's deterministic refname order,
	 *   4. the local `HEAD` (the preview carries a note in this case),
	 *   5. otherwise an actionable error.
	 * This preserves today's `origin/HEAD` default when set, and is strictly more
	 * robust than the previous hard throw when it is unset.
	 */
	private async resolveDefaultBaseRef(repository: Repository): Promise<string> {
		let symbolicRef = "";
		try {
			symbolicRef = await git(
				["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
				repository.rootPath,
			);
		} catch {
			// --quiet exits non-zero when origin/HEAD is not a symbolic ref.
			symbolicRef = "";
		}
		const fromHead = symbolicRef.replace(/^refs\/remotes\//, "");
		if (fromHead) return fromHead;

		const branches = await this.getOriginBranches(repository);
		for (const candidate of ["origin/main", "origin/master"]) {
			if (branches.includes(candidate)) return candidate;
		}
		if (branches.length > 0) return branches[0];

		try {
			await git(["rev-parse", "--verify", "HEAD"], repository.rootPath);
			return "HEAD";
		} catch {
			throw new Error(
				"Could not resolve a base branch — origin/HEAD is not set. " +
					"Run: git remote set-head origin -a",
			);
		}
	}

	/**
	 * Resolves the base ref to branch from. An explicit `baseBranch` is validated
	 * against the live `origin/*` set (so a branch deleted upstream after the
	 * picker loaded surfaces a clear error before any git mutation); otherwise the
	 * default is resolved via `resolveDefaultBaseRef`.
	 */
	private async resolveBaseRef(
		repository: Repository,
		baseBranch?: string,
	): Promise<string> {
		if (baseBranch) {
			const branches = await this.getOriginBranches(repository);
			if (!branches.includes(baseBranch)) {
				throw new Error(
					`Base branch "${baseBranch}" was not found on origin. ` +
						"It may have been deleted — refresh and pick another.",
				);
			}
			return baseBranch;
		}
		return this.resolveDefaultBaseRef(repository);
	}

	async createWorktree(
		repository: Repository,
		name: string,
		baseBranch?: string,
	): Promise<Worktree> {
		const preview = await this.previewCreateWorktree(
			repository,
			name,
			baseBranch,
		);
		await mkdir(join(repository.rootPath, ".worktrees"), { recursive: true });
		const branchExists = await localBranchExists(
			repository,
			preview.branchName,
		);
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
		const created = worktrees.find(
			(entry) => entry.branchName === preview.branchName && !entry.isMain,
		);
		if (!created) {
			throw new Error(
				`Created worktree not found after refresh: ${preview.path}`,
			);
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

	async removeWorktree(
		repository: Repository,
		worktreeId: string,
	): Promise<void> {
		const preview = await this.previewRemoveWorktree(repository, worktreeId);
		await execFileAsync(
			gitBinary,
			["worktree", "remove", "--force", preview.path],
			{ cwd: repository.rootPath },
		);
		await execFileAsync(gitBinary, ["branch", "-D", preview.branchName], {
			cwd: repository.rootPath,
		});
	}
}
