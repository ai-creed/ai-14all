// @vitest-environment node
import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createLargeRepo } from "./create-large-repo";

describe("createLargeRepo", () => {
	it("creates a deterministic repo with seed + changed + binary files (smoke)", () => {
		const repo = createLargeRepo({
			fileCount: 10,
			changedFileCount: 2,
			largeCommitFiles: 0,
			largeUntrackedKB: 1,
			binaryChangedFile: true,
		});
		try {
			expect(existsSync(repo.rootPath)).toBe(true);
			const tracked = execSync("git ls-files | wc -l", {
				cwd: repo.rootPath,
				encoding: "utf8",
			}).trim();
			expect(Number(tracked)).toBeGreaterThanOrEqual(10);
			expect(existsSync(`${repo.rootPath}/large-untracked.txt`)).toBe(true);
			expect(existsSync(`${repo.rootPath}/binary.bin`)).toBe(true);
		} finally {
			repo.cleanup();
		}
		expect(existsSync(repo.rootPath)).toBe(false);
	});

	it("supports a multi-file commit fixture", () => {
		const repo = createLargeRepo({
			fileCount: 5,
			changedFileCount: 0,
			largeCommitFiles: 10,
			largeUntrackedKB: 0,
			binaryChangedFile: false,
		});
		try {
			const log = execSync("git log --oneline", {
				cwd: repo.rootPath,
				encoding: "utf8",
			}).trim();
			expect(log.split("\n").length).toBe(2);
		} finally {
			repo.cleanup();
		}
	});
});
