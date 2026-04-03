import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import type { GitChange, GitChangeStatus } from "../../shared/models/git-change.js";
import type { GitDiff } from "../../shared/models/git-diff.js";

const execFileAsync = promisify(execFile);

async function readDiffCommand(
  args: string[],
  worktreePath: string,
): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd: worktreePath });
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

export class GitService {
  async listChangedFiles(worktreePath: string): Promise<GitChange[]> {
    const { stdout } = await execFileAsync(
      "git",
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
      const absolutePath = join(worktreePath, relativePath);
      const stdout = await readDiffCommand(
        ["diff", "--no-index", "--", "/dev/null", absolutePath],
        worktreePath,
      );
      return { path: relativePath, content: stdout };
    }

    // For renames, diff against HEAD with --find-renames and both old/new
    // paths so git can detect the rename and produce proper metadata.
    const diffArgs =
      change.status === "R" && change.oldPath
        ? ["diff", "--no-ext-diff", "--find-renames", "HEAD", "--", change.oldPath, relativePath]
        : ["diff", "--no-ext-diff", "--", relativePath];

    const stdout = await readDiffCommand(diffArgs, worktreePath);
    return { path: relativePath, content: stdout };
  }
}
