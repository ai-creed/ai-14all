import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import type { Repository } from "../../shared/models/repository.js";
import type { Worktree } from "../../shared/models/worktree.js";
import { parseWorktreePorcelain } from "./parse-worktree-porcelain.js";

const execFileAsync = promisify(execFile);

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
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
      stat(toplevel)
    ]);

    if (rootStat.ino !== toplevelStat.ino || rootStat.dev !== toplevelStat.dev) {
      throw new Error(
        `Path is not the git repository root. Root is: ${toplevel}`
      );
    }

    return {
      id: randomUUID(),
      name: basename(toplevel),
      rootPath
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
      repository.rootPath
    );
    return parseWorktreePorcelain(output, repository.id);
  }
}
