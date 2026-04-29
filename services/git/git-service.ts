import { readFile, stat, unlink } from "node:fs/promises";
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
import {
	GitCommandRunner,
	type GitCommandFailure,
} from "./git-command-runner.js";
import {
	MAX_COMMIT_FILE_BYTES,
	MAX_DIFF_PAYLOAD_BYTES,
} from "../../shared/files/size-limits.js";

function capContent(content: string, maxBytes: number, label: string): string {
	if (Buffer.byteLength(content, "utf8") <= maxBytes) return content;
	const sliced = content.slice(0, maxBytes);
	return `${sliced}\n\n[ai-14all: ${label} truncated at ${maxBytes.toLocaleString()} bytes]\n`;
}

const gitBinary = getGitBinaryPath();
const runner = new GitCommandRunner({ binary: gitBinary });

class GitRunnerError extends Error {
	constructor(
		public readonly reason: GitCommandFailure,
		public readonly label: string,
		stderr?: string,
	) {
		const detail =
			reason.kind === "command-failed"
				? `command-failed (exit ${reason.exitCode})`
				: reason.kind === "missing-ref"
					? `missing-ref ${reason.ref}`
					: reason.kind;
		super(`git ${label} failed: ${detail}${stderr ? `\n${stderr}` : ""}`);
		this.name = "GitRunnerError";
	}
}

async function runGit(
	args: string[],
	opts: {
		cwd: string;
		label: string;
		timeoutMs?: number;
		maxBufferBytes?: number;
		expectExitCodes?: number[];
	},
): Promise<string> {
	const result = await runner.run({
		args,
		cwd: opts.cwd,
		label: opts.label,
		timeoutMs: opts.timeoutMs,
		maxBufferBytes: opts.maxBufferBytes,
		expectExitCodes: opts.expectExitCodes,
	});
	if (!result.ok) {
		throw new GitRunnerError(result.reason, opts.label, result.stderr);
	}
	return result.stdout;
}

async function readDiffCommand(
	args: string[],
	worktreePath: string,
): Promise<string> {
	// Diff exits 1 when there are differences — treat as success.
	return runGit(args, {
		cwd: worktreePath,
		label: "diff",
		timeoutMs: 30_000,
		maxBufferBytes: 32 * 1024 * 1024,
		expectExitCodes: [0, 1],
	});
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

async function resolveMergeTargetRef(
	worktreePath: string,
): Promise<string | null> {
	for (const ref of ["origin/main", "origin/master"]) {
		try {
			await runGit(["rev-parse", "--verify", ref], {
				cwd: worktreePath,
				label: "rev-parse.merge-target",
				timeoutMs: 10_000,
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
		const stdout = await runGit(
			["rev-list", "--left-right", "--count", `HEAD...${mergeTargetRef}`],
			{ cwd: worktreePath, label: "rev-list.ahead-behind", timeoutMs: 15_000 },
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
		return await runGit(["show", revisionPath], {
			cwd: worktreePath,
			label: "show.blob",
			timeoutMs: 15_000,
			maxBufferBytes: 32 * 1024 * 1024,
		});
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
			const stdout = await runGit(
				["config", "--local", "--get", "ai14all.repoId"],
				{ cwd: worktreePath, label: "config.get.repoId", timeoutMs: 5_000 },
			);
			const existing = stdout.trim();
			if (existing) return existing;
		} catch (error) {
			if (error instanceof GitRunnerError) {
				const reason = error.reason;
				if (reason.kind !== "command-failed" || reason.exitCode !== 1) {
					return null;
				}
			} else {
				return null;
			}
		}

		const nextId = crypto.randomUUID();
		try {
			await runGit(["config", "--local", "ai14all.repoId", nextId], {
				cwd: worktreePath,
				label: "config.set.repoId",
				timeoutMs: 5_000,
			});
			return nextId;
		} catch {
			return null;
		}
	}

	async listChangedFiles(worktreePath: string): Promise<GitChange[]> {
		const stdout = await runGit(
			["status", "--short", "--untracked-files=all"],
			{
				cwd: worktreePath,
				label: "status",
				timeoutMs: 15_000,
				maxBufferBytes: 64 * 1024 * 1024,
			},
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
		const [branchStdout, recentStdout, changedFiles, mergeTargetRef] =
			await Promise.all([
				runGit(["branch", "--show-current"], {
					cwd: worktreePath,
					label: "branch.show-current",
					timeoutMs: 10_000,
				}),
				runGit(["log", "--format=%H%x09%h%x09%s", "-n", "5"], {
					cwd: worktreePath,
					label: "log.recent",
					timeoutMs: 15_000,
				}),
				this.listChangedFiles(worktreePath),
				resolveMergeTargetRef(worktreePath),
			]);
		const { aheadCount, behindCount } = await readAheadBehindCounts(
			worktreePath,
			mergeTargetRef,
		);

		return {
			branchName: branchStdout.trim(),
			isDirty: changedFiles.length > 0,
			mergeTargetRef,
			aheadCount,
			behindCount,
			changedFileCount: changedFiles.length,
			changedFiles,
			recentCommits: parseRecentCommits(recentStdout),
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
			content: capContent(stdout, MAX_DIFF_PAYLOAD_BYTES, "diff payload"),
			originalContent:
				change.status === "A"
					? ""
					: capContent(
							await readBlobAtRevision(
								worktreePath,
								`HEAD:${change.oldPath ?? relativePath}`,
							),
							MAX_COMMIT_FILE_BYTES,
							"original",
						),
			modifiedContent:
				change.status === "D"
					? ""
					: capContent(
							await readWorkingTreeFile(absolutePath),
							MAX_COMMIT_FILE_BYTES,
							"modified",
						),
		};
	}

	async readCommitHistory(worktreePath: string): Promise<GitCommitHistory> {
		const mergeTargetRef = await resolveMergeTargetRef(worktreePath);
		if (!mergeTargetRef) {
			return { mergeTargetRef: null, entries: [] };
		}

		const mergeBaseStdout = await runGit(
			["merge-base", "HEAD", mergeTargetRef],
			{ cwd: worktreePath, label: "merge-base", timeoutMs: 10_000 },
		);
		const mergeBase = mergeBaseStdout.trim();
		const stdout = await runGit(
			["log", "--format=%H%x09%h%x09%s", `${mergeBase}..HEAD`],
			{
				cwd: worktreePath,
				label: "log.history",
				timeoutMs: 15_000,
				maxBufferBytes: 16 * 1024 * 1024,
			},
		);
		const entries = parseRecentCommits(stdout).map<GitCommitListEntry>(
			(entry) => ({
				...entry,
				isMergeTarget: false,
			}),
		);

		if (entries.length === 0) {
			const fallbackStdout = await runGit(
				["log", "--format=%H%x09%h%x09%s", "-n", "20", "HEAD"],
				{ cwd: worktreePath, label: "log.fallback", timeoutMs: 15_000 },
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

		const countFromTarget = Math.max(1, 20 - entries.length);
		const mergeBaseInfo = await runGit(
			[
				"log",
				"--format=%H%x09%h%x09%s",
				"-n",
				String(countFromTarget),
				mergeBase,
			],
			{ cwd: worktreePath, label: "log.merge-base", timeoutMs: 15_000 },
		);
		const targetEntries = parseRecentCommits(
			mergeBaseInfo,
		).map<GitCommitListEntry>((entry) => ({ ...entry, isMergeTarget: true }));

		return {
			mergeTargetRef,
			entries: [...entries, ...targetEntries],
		};
	}

	async readCommitDetail(
		worktreePath: string,
		sha: string,
	): Promise<GitCommitDetail> {
		const [headerStdout, parentStdout, filesStdout] = await Promise.all([
			runGit(["show", "--format=%H%x09%h%x09%s", "-s", sha], {
				cwd: worktreePath,
				label: "show.header",
				timeoutMs: 10_000,
			}),
			runGit(["show", "--format=%P", "-s", sha], {
				cwd: worktreePath,
				label: "show.parents",
				timeoutMs: 10_000,
			}),
			runGit(
				["show", "--format=", "--name-status", "--find-renames", sha],
				{
					cwd: worktreePath,
					label: "show.name-status",
					timeoutMs: 15_000,
					maxBufferBytes: 16 * 1024 * 1024,
				},
			),
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
						const path =
							isRename || isCopy
								? (toPath ?? fromPath ?? "")
								: (fromPath ?? "");
						const oldPath = isRename || isCopy ? (fromPath ?? null) : null;

						if (!["A", "M", "D", "R"].includes(status)) return null;

						return {
							path,
							oldPath,
							status,
							originalContent:
								status === "A" || parentSha === ""
									? ""
									: capContent(
											await readBlobAtRevision(
												worktreePath,
												`${parentSha}:${oldPath ?? path}`,
											),
											MAX_COMMIT_FILE_BYTES,
											"original",
										),
							modifiedContent:
								status === "D"
									? ""
									: capContent(
											await readBlobAtRevision(
												worktreePath,
												`${sha}:${path}`,
											),
											MAX_COMMIT_FILE_BYTES,
											"modified",
										),
						};
					}),
			)
		).filter((f): f is GitCommitFileDiff => f !== null);

		return {
			sha: entry.sha,
			shortSha: entry.shortSha,
			subject: entry.subject,
			files,
		};
	}

	async discardChange(
		worktreePath: string,
		relativePath: string,
	): Promise<void> {
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

		await runGit(
			[
				"restore",
				"--source=HEAD",
				"--staged",
				"--worktree",
				"--",
				relativePath,
			],
			{ cwd: worktreePath, label: "restore", timeoutMs: 15_000 },
		);
	}

	async getRemoteStatus(worktreePath: string): Promise<RemoteStatus> {
		try {
			await runGit(
				["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
				{ cwd: worktreePath, label: "rev-parse.upstream", timeoutMs: 10_000 },
			);
		} catch {
			return { hasRemote: false, ahead: 0, behind: 0 };
		}

		try {
			const [aheadStdout, behindStdout] = await Promise.all([
				runGit(["rev-list", "--count", "@{u}..HEAD"], {
					cwd: worktreePath,
					label: "rev-list.ahead",
					timeoutMs: 10_000,
				}),
				runGit(["rev-list", "--count", "HEAD..@{u}"], {
					cwd: worktreePath,
					label: "rev-list.behind",
					timeoutMs: 10_000,
				}),
			]);
			return {
				hasRemote: true,
				ahead: Number(aheadStdout.trim()) || 0,
				behind: Number(behindStdout.trim()) || 0,
			};
		} catch {
			return { hasRemote: false, ahead: 0, behind: 0 };
		}
	}

	async pushBranch(worktreePath: string, force: boolean): Promise<void> {
		const args = force ? ["push", "--force-with-lease"] : ["push"];
		await runGit(args, {
			cwd: worktreePath,
			label: "push",
			timeoutMs: 60_000,
		});
	}
}
