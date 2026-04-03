import {
	mkdtempSync,
	writeFileSync,
	mkdirSync,
	rmSync,
	realpathSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

export type TestRepo = {
	repoPath: string;
	worktreePath: string;
	cleanup: () => void;
};

/**
 * Creates a temporary git repository with:
 * - An initial commit containing src/index.ts and README.md
 * - One linked worktree on a "feature-a" branch
 *
 * Uses realpathSync so paths match macOS resolved symlinks (e.g. /private/var).
 */
export function createTestRepo(): TestRepo {
	const raw = mkdtempSync(join(tmpdir(), "ofa-e2e-"));
	const repoPath = realpathSync(raw);

	// Initialize repo
	execSync("git init", { cwd: repoPath, stdio: "ignore" });
	execSync("git config user.email 'e2e@test.com'", {
		cwd: repoPath,
		stdio: "ignore",
	});
	execSync("git config user.name 'E2E Test'", {
		cwd: repoPath,
		stdio: "ignore",
	});

	// Create source files
	mkdirSync(join(repoPath, "src"), { recursive: true });
	writeFileSync(
		join(repoPath, "src", "index.ts"),
		'export const hello = "world";\n',
	);
	writeFileSync(join(repoPath, "README.md"), "# Test Repo\n");

	// Initial commit
	execSync("git add -A", { cwd: repoPath, stdio: "ignore" });
	execSync('git commit -m "initial commit"', {
		cwd: repoPath,
		stdio: "ignore",
	});

	// Create linked worktree on feature-a branch
	execSync("git branch feature-a", { cwd: repoPath, stdio: "ignore" });
	const worktreeDir = join(repoPath, ".worktrees", "feature-a");
	mkdirSync(join(repoPath, ".worktrees"), { recursive: true });
	execSync(`git worktree add "${worktreeDir}" feature-a`, {
		cwd: repoPath,
		stdio: "ignore",
	});
	const worktreePath = realpathSync(worktreeDir);

	// Add dirty content so the Changes flow has files to show
	writeFileSync(
		join(worktreePath, "src", "index.ts"),
		'export const hello = "phase-2";\n',
	);
	writeFileSync(
		join(worktreePath, "src", "new-file.ts"),
		"export const added = true;\n",
	);

	return {
		repoPath,
		worktreePath,
		cleanup: () => {
			try {
				execSync(`git worktree remove "${worktreePath}" --force`, {
					cwd: repoPath,
					stdio: "ignore",
				});
			} catch {
				// worktree may already be removed
			}
			rmSync(repoPath, { recursive: true, force: true });
		},
	};
}
