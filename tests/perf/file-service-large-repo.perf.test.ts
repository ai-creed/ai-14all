// @vitest-environment node
import { describe, expect, it } from "vitest";
import { FileService } from "../../services/files/file-service.js";
import { GitService } from "../../services/git/git-service.js";
import { createLargeRepo } from "../unit/fixtures/create-large-repo.js";

// Perf smoke gates. These run with the standard test command but use the
// large-repo fixture and assert generous time budgets calibrated for CI.
// Tighten thresholds once nightly perf measurement is wired up.

describe("perf — file + git operations on a large repo", () => {
	it("listTrackedFiles completes under 1500ms on a 2000-file repo", async () => {
		const repo = createLargeRepo({
			fileCount: 2000,
			changedFileCount: 0,
			largeUntrackedKB: 0,
			binaryChangedFile: false,
			largeCommitFiles: 0,
		});
		try {
			const svc = new FileService();
			const start = performance.now();
			const files = await svc.listTrackedFiles(repo.rootPath);
			const elapsed = performance.now() - start;
			console.log(`[perf] listTrackedFiles(2000-file): ${elapsed.toFixed(0)}ms`);
			expect(files.length).toBeGreaterThanOrEqual(2000);
			expect(elapsed).toBeLessThan(1500);
		} finally {
			repo.cleanup();
		}
	}, 60_000);

	it("readSummary completes under 1500ms on a 100-changed-file repo", async () => {
		const repo = createLargeRepo({
			fileCount: 200,
			changedFileCount: 100,
			largeUntrackedKB: 0,
			binaryChangedFile: false,
			largeCommitFiles: 0,
		});
		try {
			const svc = new GitService();
			const start = performance.now();
			const summary = await svc.readSummary(repo.rootPath);
			const elapsed = performance.now() - start;
			console.log(
				`[perf] readSummary(100-changed): ${elapsed.toFixed(0)}ms, changed=${summary.changedFileCount}`,
			);
			expect(summary.changedFileCount).toBe(100);
			expect(elapsed).toBeLessThan(1500);
		} finally {
			repo.cleanup();
		}
	}, 60_000);

	it("readFile rejects too-large untracked file under 200ms", async () => {
		const repo = createLargeRepo({
			fileCount: 5,
			changedFileCount: 0,
			largeUntrackedKB: 6000,
			binaryChangedFile: false,
			largeCommitFiles: 0,
		});
		try {
			const svc = new FileService();
			const start = performance.now();
			const result = await svc.readFile(repo.rootPath, "large-untracked.txt");
			const elapsed = performance.now() - start;
			console.log(`[perf] readFile(too-large): ${elapsed.toFixed(0)}ms`);
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.reason.kind).toBe("too-large");
			expect(elapsed).toBeLessThan(200);
		} finally {
			repo.cleanup();
		}
	}, 30_000);
});
