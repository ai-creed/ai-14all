// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execSync } from "node:child_process";
import {
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
	mkdirSync,
	statSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	FileService,
	MAX_EDITOR_FILE_BYTES,
} from "../../../../services/files/file-service.js";

vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...actual,
		stat: vi.fn(actual.stat),
		lstat: vi.fn(actual.lstat),
		realpath: vi.fn(actual.realpath),
		writeFile: vi.fn(actual.writeFile),
	};
});
import * as fsPromises from "node:fs/promises";
import { symlink, mkdir, writeFile } from "node:fs/promises";

describe("FileService", () => {
	let service: FileService;
	let tmpBase: string;
	let worktreeDir: string;

	beforeEach(() => {
		service = new FileService();
		tmpBase = mkdtempSync(join(tmpdir(), "ofa-file-test-"));
		worktreeDir = join(tmpBase, "worktree");
		mkdirSync(join(worktreeDir, "src"), { recursive: true });
		writeFileSync(
			join(worktreeDir, "src", "index.ts"),
			"console.log('hello');",
		);
	});

	afterEach(() => {
		rmSync(tmpBase, { recursive: true });
	});

	describe("readFile", () => {
		it("returns content for a valid text file", async () => {
			const result = await service.readFile(worktreeDir, "src/index.ts");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.view.content).toBe("console.log('hello');");
				expect(result.view.path).toBe("src/index.ts");
				expect(result.view.language).toBe("typescript");
			}
		});

		it("returns read-failed when the path is a directory", async () => {
			const result = await service.readFile(worktreeDir, "src");
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.reason.kind).toBe("read-failed");
		});

		it("returns path-escape when the path lexically escapes the worktree", async () => {
			const result = await service.readFile(worktreeDir, "../../etc/passwd");
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.reason.kind).toBe("path-escape");
		});

		it("returns path-escape for a symlinked file resolving outside the worktree", async () => {
			const outside = join(tmpBase, "outside.md");
			await writeFile(outside, "# outside");
			await symlink(outside, join(worktreeDir, "leak.md"));
			const result = await service.readFile(worktreeDir, "leak.md");
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.reason.kind).toBe("path-escape");
		});

		it("returns path-escape for a file under a symlinked parent directory resolving outside", async () => {
			const outsideDir = join(tmpBase, "outside-dir");
			await mkdir(outsideDir, { recursive: true });
			await writeFile(join(outsideDir, "a.md"), "# a");
			await symlink(outsideDir, join(worktreeDir, "linkdir"));
			const result = await service.readFile(worktreeDir, "linkdir/a.md");
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.reason.kind).toBe("path-escape");
		});

		it("still reads a symlink resolving inside the worktree", async () => {
			await writeFile(join(worktreeDir, "real.md"), "# real");
			await symlink(
				join(worktreeDir, "real.md"),
				join(worktreeDir, "alias.md"),
			);
			const result = await service.readFile(worktreeDir, "alias.md");
			expect(result.ok).toBe(true);
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

	describe("listWorktreeFiles", () => {
		let gitRepoDir: string;

		beforeEach(() => {
			gitRepoDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-ls-files-")));
			execSync("git init -q", { cwd: gitRepoDir });
			execSync("git config user.email test@ai-14all.dev", { cwd: gitRepoDir });
			execSync("git config user.name test", { cwd: gitRepoDir });
			mkdirSync(join(gitRepoDir, "src"), { recursive: true });
			writeFileSync(join(gitRepoDir, "src", "a.ts"), "export const a = 1;\n");
			writeFileSync(join(gitRepoDir, "README.md"), "# readme\n");
			writeFileSync(
				join(gitRepoDir, ".gitignore"),
				"ignored.txt\n.env\nnode_modules/\n",
			);
			writeFileSync(join(gitRepoDir, "ignored.txt"), "skip me\n");
			writeFileSync(join(gitRepoDir, ".env"), "SECRET=1\n");
			mkdirSync(join(gitRepoDir, "node_modules"), { recursive: true });
			writeFileSync(join(gitRepoDir, "node_modules", "pkg.js"), "x\n");
			execSync("git add -A && git commit -q -m init", { cwd: gitRepoDir });
			writeFileSync(join(gitRepoDir, "untracked.md"), "new\n");
		});

		afterEach(() => {
			rmSync(gitRepoDir, { recursive: true, force: true });
		});

		it("returns tracked + non-ignored untracked entries with ignored:false when includeIgnored is false", async () => {
			const svc = new FileService();
			const list = await svc.listWorktreeFiles(gitRepoDir, {
				includeIgnored: false,
			});
			const paths = list.map((e) => e.path);
			expect(paths).toEqual(
				expect.arrayContaining([
					".gitignore",
					"README.md",
					"src/a.ts",
					"untracked.md",
				]),
			);
			expect(paths).not.toContain("ignored.txt");
			expect(paths).not.toContain(".env");
			// denylist must filter node_modules regardless of git state
			expect(paths.some((p) => p.startsWith("node_modules/"))).toBe(false);
			for (const e of list) expect(e.ignored).toBe(false);
		});

		it("adds gitignored entries with ignored:true when includeIgnored is true; denylist still applies", async () => {
			const svc = new FileService();
			const list = await svc.listWorktreeFiles(gitRepoDir, {
				includeIgnored: true,
			});
			const byPath = new Map(list.map((e) => [e.path, e.ignored]));
			expect(byPath.get("README.md")).toBe(false);
			expect(byPath.get(".env")).toBe(true);
			expect(byPath.get("ignored.txt")).toBe(true);
			// node_modules elided even with includeIgnored=true (denylist)
			expect(
				[...byPath.keys()].some((p) => p.startsWith("node_modules/")),
			).toBe(false);
		});

		it("returns entries sorted by path", async () => {
			const svc = new FileService();
			const list = await svc.listWorktreeFiles(gitRepoDir, {
				includeIgnored: true,
			});
			const paths = list.map((e) => e.path);
			const sorted = [...paths].sort((a, b) => a.localeCompare(b));
			expect(paths).toEqual(sorted);
		});

		it("rejects when the directory is not a git working tree", async () => {
			const nonRepo = mkdtempSync(join(tmpdir(), "ofa-non-git-"));
			try {
				await expect(
					new FileService().listWorktreeFiles(nonRepo, {
						includeIgnored: false,
					}),
				).rejects.toThrow();
			} finally {
				rmSync(nonRepo, { recursive: true, force: true });
			}
		});
	});
});

describe("FileService.openForEdit", () => {
	function makeWorktree(): string {
		return mkdtempSync(join(tmpdir(), "ai14all-editor-"));
	}

	it("returns content and mtimeMs for a whitelisted text file", async () => {
		const wt = makeWorktree();
		writeFileSync(join(wt, "NOTES.md"), "hello\n", "utf8");
		const svc = new FileService();
		const res = await svc.openForEdit(wt, "NOTES.md");
		expect(res.ok).toBe(true);
		if (res.ok) {
			expect(res.content).toBe("hello\n");
			expect(res.mtimeMs).toBeGreaterThan(0);
		}
	});

	it("rejects non-whitelisted extension", async () => {
		const wt = makeWorktree();
		writeFileSync(join(wt, "image.png"), Buffer.from([1, 2, 3]));
		const svc = new FileService();
		const res = await svc.openForEdit(wt, "image.png");
		expect(res).toEqual({ ok: false, reason: "not-editable" });
	});

	it("rejects binary content via null-byte sniff", async () => {
		const wt = makeWorktree();
		writeFileSync(join(wt, "a.json"), Buffer.from([0x7b, 0x00, 0x7d]));
		const svc = new FileService();
		const res = await svc.openForEdit(wt, "a.json");
		expect(res).toEqual({ ok: false, reason: "binary" });
	});

	it("rejects files larger than the size cap", async () => {
		const wt = makeWorktree();
		const big = "x".repeat(MAX_EDITOR_FILE_BYTES + 1);
		writeFileSync(join(wt, "big.md"), big, "utf8");
		const svc = new FileService();
		const res = await svc.openForEdit(wt, "big.md");
		expect(res).toEqual({ ok: false, reason: "too-large" });
	});

	it("rejects path escapes", async () => {
		const wt = makeWorktree();
		const svc = new FileService();
		const res = await svc.openForEdit(wt, "../outside.md");
		expect(res).toEqual({ ok: false, reason: "path-escape" });
	});

	it("returns not-found for missing files", async () => {
		const wt = makeWorktree();
		const svc = new FileService();
		const res = await svc.openForEdit(wt, "missing.md");
		expect(res).toEqual({ ok: false, reason: "not-found" });
	});

	it("returns permission-denied when stat throws EACCES", async () => {
		const wt = makeWorktree();
		writeFileSync(join(wt, "notes.md"), "");
		vi.mocked(fsPromises.stat).mockRejectedValueOnce(
			Object.assign(new Error("EACCES"), { code: "EACCES" }),
		);
		const svc = new FileService();
		const res = await svc.openForEdit(wt, "notes.md");
		expect(res).toEqual({ ok: false, reason: "permission-denied" });
		vi.mocked(fsPromises.stat).mockRestore();
	});
});

describe("FileService.saveFile", () => {
	function makeWorktree(): string {
		return mkdtempSync(join(tmpdir(), "ai14all-save-"));
	}

	it("writes content and returns a new mtimeMs when expected matches", async () => {
		const wt = makeWorktree();
		writeFileSync(join(wt, "NOTES.md"), "a\n", "utf8");
		const mtime = statSync(join(wt, "NOTES.md")).mtimeMs;
		const svc = new FileService();
		const res = await svc.saveFile(wt, "NOTES.md", "b\n", mtime);
		expect(res.ok).toBe(true);
		if (res.ok) expect(res.mtimeMs).toBeGreaterThanOrEqual(mtime);
		const readback = await svc.openForEdit(wt, "NOTES.md");
		expect(readback.ok).toBe(true);
		if (readback.ok) expect(readback.content).toBe("b\n");
	});

	it("returns mtime-conflict when expectedMtimeMs is stale", async () => {
		const wt = makeWorktree();
		writeFileSync(join(wt, "NOTES.md"), "a\n", "utf8");
		const svc = new FileService();
		const res = await svc.saveFile(wt, "NOTES.md", "b\n", 0); // 0 is always stale
		expect(res.ok).toBe(false);
		if (!res.ok && res.reason === "mtime-conflict") {
			expect(res.currentMtimeMs).toBeGreaterThan(0);
		} else {
			throw new Error("expected mtime-conflict");
		}
	});

	it("rejects non-whitelisted files", async () => {
		const wt = makeWorktree();
		writeFileSync(join(wt, "a.png"), "x", "utf8");
		const svc = new FileService();
		const res = await svc.saveFile(wt, "a.png", "y", 0);
		expect(res).toEqual({ ok: false, reason: "not-editable" });
	});

	it("rejects path escapes", async () => {
		const wt = makeWorktree();
		const svc = new FileService();
		const res = await svc.saveFile(wt, "../escape.md", "x", 0);
		expect(res).toEqual({ ok: false, reason: "path-escape" });
	});

	it("returns not-found when the file does not exist", async () => {
		const wt = makeWorktree();
		const svc = new FileService();
		const res = await svc.saveFile(wt, "ghost.md", "x", 0);
		expect(res).toEqual({ ok: false, reason: "not-found" });
	});

	it("returns permission-denied when writeFile throws EACCES", async () => {
		const wt = makeWorktree();
		writeFileSync(join(wt, "notes.md"), "a\n", "utf8");
		const mtime = statSync(join(wt, "notes.md")).mtimeMs;
		vi.mocked(fsPromises.writeFile).mockRejectedValueOnce(
			Object.assign(new Error("EACCES"), { code: "EACCES" }),
		);
		const svc = new FileService();
		const res = await svc.saveFile(wt, "notes.md", "b\n", mtime);
		expect(res).toEqual({ ok: false, reason: "permission-denied" });
	});

	it("returns disk-full when writeFile throws ENOSPC", async () => {
		const wt = makeWorktree();
		writeFileSync(join(wt, "notes.md"), "a\n", "utf8");
		const mtime = statSync(join(wt, "notes.md")).mtimeMs;
		vi.mocked(fsPromises.writeFile).mockRejectedValueOnce(
			Object.assign(new Error("ENOSPC"), { code: "ENOSPC" }),
		);
		const svc = new FileService();
		const res = await svc.saveFile(wt, "notes.md", "b\n", mtime);
		expect(res).toEqual({ ok: false, reason: "disk-full" });
	});

	it("returns ok:true with Date.now() fallback when post-write stat throws", async () => {
		const wt = makeWorktree();
		writeFileSync(join(wt, "notes.md"), "a\n", "utf8");
		const mtime = statSync(join(wt, "notes.md")).mtimeMs;
		// First stat call (pre-write mtime check) passes through; second (post-write) throws
		const statMock = vi.mocked(fsPromises.stat);
		let statCallCount = 0;
		statMock.mockImplementation(async (...args) => {
			statCallCount++;
			if (statCallCount === 2) {
				throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
			}
			const { stat: realStat } =
				await vi.importActual<typeof import("node:fs/promises")>(
					"node:fs/promises",
				);
			return realStat(...(args as Parameters<typeof realStat>));
		});
		const before = Date.now();
		const svc = new FileService();
		const res = await svc.saveFile(wt, "notes.md", "b\n", mtime);
		const after = Date.now();
		statMock.mockRestore();
		expect(res.ok).toBe(true);
		if (res.ok) {
			expect(res.mtimeMs).toBeGreaterThanOrEqual(before);
			expect(res.mtimeMs).toBeLessThanOrEqual(after);
		}
	});
});
