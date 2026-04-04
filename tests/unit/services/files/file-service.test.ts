// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileService } from "../../../../services/files/file-service.js";

describe("FileService", () => {
	let service: FileService;
	let worktreeDir: string;

	beforeEach(() => {
		service = new FileService();
		worktreeDir = mkdtempSync(join(tmpdir(), "ofa-file-test-"));
		mkdirSync(join(worktreeDir, "src"), { recursive: true });
		writeFileSync(
			join(worktreeDir, "src", "index.ts"),
			"console.log('hello');",
		);
	});

	afterEach(() => {
		rmSync(worktreeDir, { recursive: true });
	});

	describe("readFile", () => {
		it("returns content for a valid text file", async () => {
			const result = await service.readFile(worktreeDir, "src/index.ts");
			expect(result.content).toBe("console.log('hello');");
			expect(result.path).toBe("src/index.ts");
			expect(result.language).toBe("typescript");
		});

		it("rejects when the path is a directory", async () => {
			await expect(service.readFile(worktreeDir, "src")).rejects.toThrow();
		});

		it("rejects when the path escapes the worktree", async () => {
			await expect(
				service.readFile(worktreeDir, "../../etc/passwd"),
			).rejects.toThrow();
		});
	});

	describe("listFiles", () => {
		it("returns relative paths for files in the worktree", async () => {
			const files = await service.listFiles(worktreeDir);
			expect(files).toContain("src/index.ts");
		});
	});

	describe("listScopedFiles", () => {
		it("lists only files under the provided relative roots", async () => {
			mkdirSync(join(worktreeDir, "docs"), { recursive: true });
			writeFileSync(join(worktreeDir, "docs", "notes.md"), "# notes\n");

			const files = await service.listScopedFiles(worktreeDir, ["src"]);

			expect(files).toEqual(["src/index.ts"]);
		});

		it("skips a non-existent root without throwing", async () => {
			const result = await service.listScopedFiles(worktreeDir, [
				"src",
				"nonexistent-dir",
			]);
			expect(result).toEqual(["src/index.ts"]);
		});

		it("deduplicates and sorts files across overlapping roots", async () => {
			mkdirSync(join(worktreeDir, "src", "nested"), { recursive: true });
			writeFileSync(
				join(worktreeDir, "src", "nested", "extra.ts"),
				"export {};\n",
			);

			const files = await service.listScopedFiles(worktreeDir, [
				"src",
				"src/nested",
			]);

			expect(files).toEqual(["src/index.ts", "src/nested/extra.ts"]);
		});

		it('lists immediate root-level files when scope root is "."', async () => {
			// worktreeDir already has src/index.ts; add a root-level file
			writeFileSync(join(worktreeDir, "README.md"), "# readme\n");

			const result = await service.listScopedFiles(worktreeDir, ["."]);

			// Should contain the root-level file but NOT recurse into src/
			expect(result).toContain("README.md");
			expect(result.some((p) => p.startsWith("src/"))).toBe(false);
		});
	});
});
