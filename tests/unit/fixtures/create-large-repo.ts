import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type LargeRepoOptions = {
	fileCount?: number;
	changedFileCount?: number;
	largeUntrackedKB?: number;
	binaryChangedFile?: boolean;
	largeCommitFiles?: number;
};

export type LargeRepoHandle = {
	rootPath: string;
	cleanup: () => void;
};

/**
 * Create a deterministic git repo for scalability fixtures. Useful for
 * exercising file list, change list, diff, and commit-detail performance
 * paths without touching real user data.
 */
export function createLargeRepo(
	opts: LargeRepoOptions = {},
): LargeRepoHandle {
	const {
		fileCount = 2000,
		changedFileCount = 100,
		largeUntrackedKB = 6000,
		binaryChangedFile = true,
		largeCommitFiles = 200,
	} = opts;

	const rootPath = mkdtempSync(join(tmpdir(), "ai14all-large-repo-"));
	const run = (cmd: string) => execSync(cmd, { cwd: rootPath, stdio: "ignore" });

	run("git init -q -b main");
	run('git config user.email test@example.com');
	run('git config user.name Test');

	// Seed `fileCount` deterministic small files and commit them.
	for (let i = 0; i < fileCount; i++) {
		const path = join(rootPath, `file-${String(i).padStart(5, "0")}.txt`);
		writeFileSync(path, `seeded content ${i}\n`);
	}
	run("git add -A && git commit -q -m seed");

	// Modify the first `changedFileCount` files to create a changed-file fixture.
	for (let i = 0; i < changedFileCount; i++) {
		const path = join(rootPath, `file-${String(i).padStart(5, "0")}.txt`);
		writeFileSync(path, `modified content ${i}\n`);
	}

	// Drop a large untracked text file (above MAX_FILE_VIEW_BYTES default).
	if (largeUntrackedKB > 0) {
		const big = "x".repeat(1024).repeat(largeUntrackedKB);
		writeFileSync(join(rootPath, "large-untracked.txt"), big);
	}

	// Drop a small binary file (NUL bytes) to exercise binary detection.
	if (binaryChangedFile) {
		const buf = Buffer.alloc(2048);
		for (let i = 0; i < buf.length; i++) buf[i] = i % 256;
		writeFileSync(join(rootPath, "binary.bin"), buf);
	}

	// Optionally commit a large batch of new files to exercise commit-detail.
	if (largeCommitFiles > 0) {
		for (let i = 0; i < largeCommitFiles; i++) {
			const path = join(rootPath, `commit-${String(i).padStart(4, "0")}.txt`);
			writeFileSync(path, `commit content ${i}\n`);
		}
		run('git add -A && git commit -q -m "large commit"');
	}

	const cleanup = () => {
		rmSync(rootPath, { recursive: true, force: true });
	};
	return { rootPath, cleanup };
}
