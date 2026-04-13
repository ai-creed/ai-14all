import { execFile } from "node:child_process";
import { readFile, stat, unlink } from "node:fs/promises";
import { promisify } from "node:util";
import { resolve } from "node:path";
import type {
	GitChange,
	GitChangeStatus,
} from "../../shared/models/git-change.js";
import type { RemoteStatus } from "../../shared/models/git-remote-status.js";
import type { GitDiff } from "../../shared/models/git-diff.js";
import type {
	GitSummary,
	GitCommitSummary,
} from "../../shared/models/git-summary.js";
import type {
	GitCommitDetail,
	GitCommitFileDiff,
	GitCommitHistory,
	GitCommitListEntry,
} from "../../shared/models/git-commit-review.js";
import { getGitBinaryPath } from "./git-binary.js";

const execFileAsync = promisify(execFile);
const gitBinary = getGitBinaryPath();

async function readDiffCommand(
	args: string[],
	worktreePath: string,
): Promise<string> {
	try {
		const { stdout } = await execFileAsync(gitBinary, args, { cwd: worktreePath });
		return stdout;
	} catch (error: unknown) {
		const stdout =
			typeof error === "object" && error !== null && "stdout" in error
				? String((error as { stdout?: string }).stdout ?? "")
				: "";
		const code =
			typeof error === "object" && error !== null && "code" in error
				? Number((error as { code?: number | string }).code)
				: null;

		if (code === 1 && stdout) {
			return stdout;
		}

		throw error;
	}
}

const RECOGNIZED_STATUSES = new Set<string>(["M", "A", "D", "R", "??"]);

function parseRecentCommits(stdout: string): GitCommitSummary[] {
	return stdout
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			const [sha, shortSha, subject] = line.split("\t");
			if (!sha || !shortSha) return null;
			return { sha, shortSha, subject: subject ?? "" };
		})
		.filter((entry): entry is GitCommitSummary => entry !== null);
}

function parseStatusLine(line: string): GitChange | null {
	const raw = line.slice(0, 2).trim();
	let path = line.slice(3).trim();
	const status = raw === "" ? "M" : raw;

	if (!RECOGNIZED_STATUSES.has(status)) {
		return null;
	}

	// For renames, git status outputs "R  old-path -> new-path".
	// Extract the new (destination) path and preserve the old path for diffs.
	if (status === "R") {
		const arrowIdx = path.indexOf(" -> ");
		if (arrowIdx !== -1) {
			const oldPath = path.slice(0, arrowIdx);
			path = path.slice(arrowIdx + 4);
			return { path, status: status as GitChangeStatus, oldPath };
		}
	}

	return { path, status: status as GitChangeStatus };
}

async function resolveMergeTargetRef(worktreePath: string): Promise<string | null> {
	for (const ref of ["origin/main", "origin/master"]) {
		try {
			await execFileAsync(gitBinary, ["rev-parse", "--verify", ref], {
				cwd: worktreePath,
			});
			return ref;
		} catch {
			// try next candidate
		}
	}
	return null;
}

async function readAheadBehindCounts(
	worktreePath: string,
	mergeTargetRef: string | null,
): Promise<{ aheadCount: number; behindCount: number }> {
	if (!mergeTargetRef) {
		return { aheadCount: 0, behindCount: 0 };
	}

	try {
		const { stdout } = await execFileAsync(
			gitBinary,
			["rev-list", "--left-right", "--count", `HEAD...${mergeTargetRef}`],
			{ cwd: worktreePath },
		);
		const [aheadRaw = "0", behindRaw = "0"] = stdout.trim().split(/\s+/);
		return {
			aheadCount: Number(aheadRaw) || 0,
			behindCount: Number(behindRaw) || 0,
		};
	} catch {
		return { aheadCount: 0, behindCount: 0 };
	}
}

async function readBlobAtRevision(
	worktreePath: string,
	revisionPath: string,
): Promise<string> {
	try {
		const { stdout } = await execFileAsync(gitBinary, ["show", revisionPath], {
			cwd: worktreePath,
		});
		return stdout;
	} catch {
		return "";
	}
}

async function readWorkingTreeFile(absolutePath: string): Promise<string> {
	try {
		return await readFile(absolutePath, "utf8");
	} catch {
		return "";
	}
}

export class GitService {
	async readOrCreateRepoId(worktreePath: string): Promise<string | null> {
		try {
			const { stdout } = await execFileAsync(
				gitBinary,
				["config", "--local", "--get", "ai14all.repoId"],
				{ cwd: worktreePath },
			);
			const existing = stdout.trim();
			if (existing) return existing;
		} catch (error) {
			const code =
				typeof error === "object" && error !== null && "code" in error
					? Number((error as { code?: number | string }).code)
					: null;
			if (code !== 1) return null;
		}

		const nextId = crypto.randomUUID();
		try {
			await execFileAsync(
				gitBinary,
				["config", "--local", "ai14all.repoId", nextId],
				{ cwd: worktreePath },
			);
			return nextId;
		} catch {
			return null;
		}
	}

	async listChangedFiles(worktreePath: string): Promise<GitChange[]> {
		const { stdout } = await execFileAsync(
			gitBinary,
			["status", "--short", "--untracked-files=all"],
			{ cwd: worktreePath },
		);

		return stdout
			.split("\n")
			.map((line) => line.trimEnd())
			.filter(Boolean)
			.map(parseStatusLine)
			.filter((entry): entry is GitChange => entry !== null)
			.sort((a, b) => a.path.localeCompare(b.path));
	}

	async readSummary(worktreePath: string): Promise<GitSummary> {
		const [branchResult, recentResult, changedFiles, mergeTargetRef] = await Promise.all([
			execFileAsync(gitBinary, ["branch", "--show-current"], { cwd: worktreePath }),
			execFileAsync(gitBinary, ["log", "--format=%H%x09%h%x09%s", "-n", "5"], {
				cwd: worktreePath,
			}),
			this.listChangedFiles(worktreePath),
			resolveMergeTargetRef(worktreePath),
		]);
		const { aheadCount, behindCount } = await readAheadBehindCounts(
			worktreePath,
			mergeTargetRef,
		);

		return {
			branchName: branchResult.stdout.trim(),
			isDirty: changedFiles.length > 0,
			mergeTargetRef,
			aheadCount,
			behindCount,
			changedFileCount: changedFiles.length,
			changedFiles,
			recentCommits: parseRecentCommits(recentResult.stdout),
		};
	}

	async readDiff(worktreePath: string, relativePath: string): Promise<GitDiff> {
		const absolutePath = resolve(worktreePath, relativePath);
		const normalizedWorktree = resolve(worktreePath);
		if (
			!absolutePath.startsWith(normalizedWorktree + "/") &&
			absolutePath !== normalizedWorktree
		) {
			throw new Error(`Path escapes worktree: ${relativePath}`);
		}

		const changes = await this.listChangedFiles(worktreePath);
		const change = changes.find((entry) => entry.path === relativePath);

		if (!change) {
			throw new Error(`No changed file found for ${relativePath}`);
		}

		if (change.status === "??") {
			const fileStats = await stat(absolutePath);
			if (fileStats.isDirectory()) {
				throw new Error(`Cannot diff directory: ${relativePath}`);
			}

			const stdout = await readDiffCommand(
				["diff", "--no-index", "--", "/dev/null", absolutePath],
				worktreePath,
			);
			return {
				path: relativePath,
				content: stdout,
				originalContent: "",
				modifiedContent: await readWorkingTreeFile(absolutePath),
			};
		}

		// For renames, diff against HEAD with --find-renames and both old/new
		// paths so git can detect the rename and produce proper metadata.
		const diffArgs =
			change.status === "R" && change.oldPath
				? [
						"diff",
						"--no-ext-diff",
						"--find-renames",
						"HEAD",
						"--",
						change.oldPath,
						relativePath,
					]
				: ["diff", "--no-ext-diff", "HEAD", "--", relativePath];

		const stdout = await readDiffCommand(diffArgs, worktreePath);
		return {
			path: relativePath,
			content: stdout,
			originalContent:
				change.status === "A"
					? ""
					: await readBlobAtRevision(
							worktreePath,
							`HEAD:${change.oldPath ?? relativePath}`,
						),
			modifiedContent:
				change.status === "D"
					? ""
					: await readWorkingTreeFile(absolutePath),
		};
	}

	async readCommitHistory(worktreePath: string): Promise<GitCommitHistory> {
		const mergeTargetRef = await resolveMergeTargetRef(worktreePath);
		if (!mergeTargetRef) {
			return { mergeTargetRef: null, entries: [] };
		}

		const { stdout: mergeBaseStdout } = await execFileAsync(
			gitBinary,
			["merge-base", "HEAD", mergeTargetRef],
			{ cwd: worktreePath },
		);
		const mergeBase = mergeBaseStdout.trim();
		const { stdout } = await execFileAsync(
			gitBinary,
			["log", "--format=%H%x09%h%x09%s", `${mergeBase}..HEAD`],
			{ cwd: worktreePath },
		);
		const entries = parseRecentCommits(stdout).map<GitCommitListEntry>((entry) => ({
			...entry,
			isMergeTarget: false,
		}));

		if (entries.length === 0) {
			// HEAD is at or behind the merge target — all visible commits are already
			// in the target, so mark them accordingly (green, not purple).
			const { stdout: fallbackStdout } = await execFileAsync(
				gitBinary,
				["log", "--format=%H%x09%h%x09%s", "-n", "20", "HEAD"],
				{ cwd: worktreePath },
			);
			return {
				mergeTargetRef,
				entries: parseRecentCommits(fallbackStdout).map<GitCommitListEntry>(
					(entry) => ({
						...entry,
						isMergeTarget: true,
					}),
				),
			};
		}

		// Always show at least 20 commits total: pad with merge target history.
		const countFromTarget = Math.max(1, 20 - entries.length);
		const { stdout: mergeBaseInfo } = await execFileAsync(
			gitBinary,
			["log", "--format=%H%x09%h%x09%s", "-n", String(countFromTarget), mergeBase],
			{ cwd: worktreePath },
		);
		const targetEntries = parseRecentCommits(mergeBaseInfo).map<GitCommitListEntry>(
			(entry) => ({ ...entry, isMergeTarget: true }),
		);

		return {
			mergeTargetRef,
			entries: [...entries, ...targetEntries],
		};
	}

	async readCommitDetail(
		worktreePath: string,
		sha: string,
	): Promise<GitCommitDetail> {
		const [{ stdout: headerStdout }, { stdout: parentStdout }, { stdout: filesStdout }] =
			await Promise.all([
				execFileAsync(gitBinary, ["show", "--format=%H%x09%h%x09%s", "-s", sha], {
					cwd: worktreePath,
				}),
				execFileAsync(gitBinary, ["show", "--format=%P", "-s", sha], {
					cwd: worktreePath,
				}),
				execFileAsync(gitBinary, ["show", "--format=", "--name-status", "--find-renames", sha], {
					cwd: worktreePath,
				}),
			]);

		const [entry] = parseRecentCommits(headerStdout);
		if (!entry) throw new Error(`Commit not found: ${sha}`);

		const parentSha = parentStdout.trim().split(" ")[0] ?? "";
		const files = (
			await Promise.all(
				filesStdout
					.split("\n")
					.map((line) => line.trim())
					.filter(Boolean)
					.map(async (line): Promise<GitCommitFileDiff | null> => {
						const [rawStatus, fromPath, toPath] = line.split("\t");
						const isRename = rawStatus?.startsWith("R") ?? false;
						const isCopy = rawStatus?.startsWith("C") ?? false;
						const status: "A" | "M" | "D" | "R" =
							isRename || isCopy ? "R" : (rawStatus as "A" | "M" | "D");
						const path = isRename || isCopy ? (toPath ?? fromPath ?? "") : (fromPath ?? "");
						const oldPath = isRename || isCopy ? (fromPath ?? null) : null;

						// Skip entries with unrecognized status (U, X, B, T, etc.)
						if (!["A", "M", "D", "R"].includes(status)) return null;

						return {
							path,
							oldPath,
							status,
							originalContent:
								status === "A" || parentSha === ""
									? ""
									: await readBlobAtRevision(
											worktreePath,
											`${parentSha}:${oldPath ?? path}`,
										),
							modifiedContent:
								status === "D"
									? ""
									: await readBlobAtRevision(worktreePath, `${sha}:${path}`),
						};
					}),
			)
		).filter((f): f is GitCommitFileDiff => f !== null);

		return { sha: entry.sha, shortSha: entry.shortSha, subject: entry.subject, files };
	}

	async discardChange(worktreePath: string, relativePath: string): Promise<void> {
		const absolutePath = resolve(worktreePath, relativePath);
		const normalizedWorktree = resolve(worktreePath);
		if (
			!absolutePath.startsWith(normalizedWorktree + "/") &&
			absolutePath !== normalizedWorktree
		) {
			throw new Error(`Path escapes worktree: ${relativePath}`);
		}

		const changes = await this.listChangedFiles(worktreePath);
		const change = changes.find((entry) => entry.path === relativePath);
		if (!change) {
			throw new Error(`No changed file found for ${relativePath}`);
		}

		if (change.status === "??") {
			await unlink(absolutePath);
			return;
		}

		await execFileAsync(
			gitBinary,
			["restore", "--source=HEAD", "--staged", "--worktree", "--", relativePath],
			{ cwd: worktreePath },
		);
	}

	async getRemoteStatus(worktreePath: string): Promise<RemoteStatus> {
		try {
			await execFileAsync(
				gitBinary,
				["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
				{ cwd: worktreePath },
			);
		} catch {
			return { hasRemote: false, ahead: 0, behind: 0 };
		}

		try {
			const [aheadResult, behindResult] = await Promise.all([
				execFileAsync(gitBinary, ["rev-list", "--count", "@{u}..HEAD"], { cwd: worktreePath }),
				execFileAsync(gitBinary, ["rev-list", "--count", "HEAD..@{u}"], { cwd: worktreePath }),
			]);
			return {
				hasRemote: true,
				ahead: Number(aheadResult.stdout.trim()) || 0,
				behind: Number(behindResult.stdout.trim()) || 0,
			};
		} catch {
			return { hasRemote: false, ahead: 0, behind: 0 };
		}
	}

	async pushBranch(worktreePath: string, force: boolean): Promise<void> {
		const args = force ? ["push", "--force-with-lease"] : ["push"];
		await execFileAsync(gitBinary, args, { cwd: worktreePath });
	}
}
