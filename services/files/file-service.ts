import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
	readdir,
	readFile as fsReadFile,
	stat,
	lstat,
	realpath,
	writeFile,
} from "node:fs/promises";
import { join, extname, sep } from "node:path";
import type { FileReadResult } from "../../shared/models/file-view.js";
import type {
	OpenFileForEditResult,
	SaveFileResult,
	WorktreeFileEntry,
} from "../../shared/contracts/commands.js";
import { getGitBinaryPath } from "../git/git-binary.js";
import { isEditable } from "../../shared/editor/editable-files.js";
import { isLikelyBinary } from "./binary-detect.js";
import { MAX_FILE_VIEW_BYTES } from "../../shared/files/size-limits.js";
import { isUnderDenylistedDir } from "../../shared/files/ignored-denylist.js";
import { resolveWithinWorktree } from "./worktree-path.js";

export const MAX_EDITOR_FILE_BYTES = 1_000_000;

const execFileAsync = promisify(execFile);

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "out"]);
const MAX_FILES = 200;

function detectLanguage(filePath: string): string {
	const ext = extname(filePath).toLowerCase();
	switch (ext) {
		case ".ts":
		case ".tsx":
			return "typescript";
		case ".js":
		case ".jsx":
			return "javascript";
		case ".json":
			return "json";
		case ".md":
			return "markdown";
		case ".css":
			return "css";
		case ".html":
			return "html";
		default:
			return "plaintext";
	}
}

async function walkDir(
	baseDir: string,
	relDir: string,
	results: string[],
): Promise<void> {
	if (results.length >= MAX_FILES) return;

	const entries = await readdir(join(baseDir, relDir), { withFileTypes: true });

	for (const entry of entries) {
		if (results.length >= MAX_FILES) break;

		const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;

		if (entry.isDirectory()) {
			if (!SKIP_DIRS.has(entry.name)) {
				await walkDir(baseDir, relPath, results);
			}
		} else if (entry.isFile()) {
			results.push(relPath);
		}
	}
}

export class FileService {
	async listFiles(worktreePath: string): Promise<string[]> {
		const results: string[] = [];
		await walkDir(worktreePath, "", results);
		return results;
	}

	async listScopedFiles(
		worktreePath: string,
		relativeRoots: string[],
	): Promise<string[]> {
		const uniqueRoots = [...new Set(relativeRoots.filter(Boolean))].sort();
		if (uniqueRoots.length === 0) return [];

		const files = new Set<string>();
		for (const relativeRoot of uniqueRoots) {
			const {
				absolute: absoluteRoot,
				root: normalizedWorktree,
				inside,
			} = resolveWithinWorktree(worktreePath, relativeRoot);
			if (!inside) {
				throw new Error(`Path escapes worktree: ${relativeRoot}`);
			}

			try {
				const stats = await stat(absoluteRoot);
				if (stats.isDirectory()) {
					if (absoluteRoot === normalizedWorktree) {
						// Root scope: list only immediate files, no recursion
						const entries = await readdir(absoluteRoot, {
							withFileTypes: true,
						});
						for (const entry of entries) {
							if (entry.isFile()) {
								files.add(entry.name);
							}
						}
					} else {
						const nested: string[] = [];
						await walkDir(worktreePath, relativeRoot, nested);
						nested.forEach((entry) => files.add(entry));
					}
				} else if (stats.isFile()) {
					files.add(relativeRoot);
				}
			} catch {
				// Path does not exist (e.g. deleted file) — skip silently
			}
		}

		return [...files].sort((a, b) => a.localeCompare(b));
	}

	async listWorktreeFiles(
		worktreePath: string,
		opts: { includeIgnored: boolean },
	): Promise<WorktreeFileEntry[]> {
		const gitBinary = getGitBinaryPath();
		const { stdout: trackedStdout } = await execFileAsync(
			gitBinary,
			["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
			{ cwd: worktreePath, maxBuffer: 64 * 1024 * 1024 },
		);
		const tracked = trackedStdout
			.split("\0")
			.filter((entry) => entry.length > 0 && !isUnderDenylistedDir(entry));
		const seen = new Set<string>(tracked);
		const result: WorktreeFileEntry[] = tracked.map((path) => ({
			path,
			ignored: false,
		}));

		if (opts.includeIgnored) {
			const { stdout: ignoredStdout } = await execFileAsync(
				gitBinary,
				["ls-files", "--others", "--ignored", "--exclude-standard", "-z"],
				{ cwd: worktreePath, maxBuffer: 64 * 1024 * 1024 },
			);
			for (const entry of ignoredStdout.split("\0")) {
				if (!entry.length) continue;
				if (seen.has(entry)) continue;
				if (isUnderDenylistedDir(entry)) continue;
				seen.add(entry);
				result.push({ path: entry, ignored: true });
			}
		}

		return result.sort((a, b) => a.path.localeCompare(b.path));
	}

	private resolveInsideWorktree(
		worktreePath: string,
		relativePath: string,
	): { ok: true; absolute: string } | { ok: false; reason: "path-escape" } {
		const { absolute, inside } = resolveWithinWorktree(
			worktreePath,
			relativePath,
		);
		return inside
			? { ok: true, absolute }
			: { ok: false, reason: "path-escape" };
	}

	async openForEdit(
		worktreePath: string,
		relativePath: string,
	): Promise<OpenFileForEditResult> {
		const resolved = this.resolveInsideWorktree(worktreePath, relativePath);
		if (!resolved.ok) return resolved;
		const basename = relativePath.split("/").pop() ?? "";
		if (!isEditable(basename)) return { ok: false, reason: "not-editable" };
		try {
			const lstats = await lstat(resolved.absolute);
			if (lstats.isSymbolicLink()) {
				const [realWorktree, realFile] = await Promise.all([
					realpath(worktreePath),
					realpath(resolved.absolute),
				]);
				if (
					realFile !== realWorktree &&
					!realFile.startsWith(realWorktree + sep)
				)
					return { ok: false, reason: "path-escape" };
			}
		} catch (err) {
			const code = (err as NodeJS.ErrnoException).code;
			if (code === "ENOENT") return { ok: false, reason: "not-found" };
			if (code === "EACCES") return { ok: false, reason: "permission-denied" };
			return { ok: false, reason: "read-failed" };
		}
		let stats: import("node:fs").Stats;
		try {
			stats = await stat(resolved.absolute);
		} catch (err) {
			const code = (err as NodeJS.ErrnoException).code;
			if (code === "ENOENT") return { ok: false, reason: "not-found" };
			if (code === "EACCES") return { ok: false, reason: "permission-denied" };
			return { ok: false, reason: "read-failed" };
		}
		if (stats.size > MAX_EDITOR_FILE_BYTES)
			return { ok: false, reason: "too-large" };
		let buffer: Buffer;
		try {
			buffer = await fsReadFile(resolved.absolute);
		} catch (err) {
			const code = (err as NodeJS.ErrnoException).code;
			if (code === "EACCES") return { ok: false, reason: "permission-denied" };
			return { ok: false, reason: "read-failed" };
		}
		const sniff = buffer.subarray(0, Math.min(buffer.length, 8192));
		if (sniff.includes(0)) return { ok: false, reason: "binary" };
		return {
			ok: true,
			content: buffer.toString("utf8"),
			mtimeMs: stats.mtimeMs,
		};
	}

	async saveFile(
		worktreePath: string,
		relativePath: string,
		content: string,
		expectedMtimeMs: number,
	): Promise<SaveFileResult> {
		const resolved = this.resolveInsideWorktree(worktreePath, relativePath);
		if (!resolved.ok) return resolved;
		const basename = relativePath.split("/").pop() ?? "";
		if (!isEditable(basename)) return { ok: false, reason: "not-editable" };
		try {
			const lstats = await lstat(resolved.absolute);
			if (lstats.isSymbolicLink()) {
				const [realWorktree, realFile] = await Promise.all([
					realpath(worktreePath),
					realpath(resolved.absolute),
				]);
				if (
					realFile !== realWorktree &&
					!realFile.startsWith(realWorktree + sep)
				)
					return { ok: false, reason: "path-escape" };
			}
		} catch (err) {
			const code = (err as NodeJS.ErrnoException).code;
			if (code === "ENOENT") return { ok: false, reason: "not-found" };
			if (code === "EACCES") return { ok: false, reason: "permission-denied" };
			return { ok: false, reason: "write-failed" };
		}
		let stats: import("node:fs").Stats;
		try {
			stats = await stat(resolved.absolute);
		} catch (err) {
			const code = (err as NodeJS.ErrnoException).code;
			if (code === "ENOENT") return { ok: false, reason: "not-found" };
			if (code === "EACCES") return { ok: false, reason: "permission-denied" };
			return { ok: false, reason: "write-failed" };
		}
		if (stats.mtimeMs !== expectedMtimeMs) {
			return {
				ok: false,
				reason: "mtime-conflict",
				currentMtimeMs: stats.mtimeMs,
			};
		}

		try {
			await writeFile(resolved.absolute, content, "utf8");
		} catch (err) {
			const code = (err as NodeJS.ErrnoException).code;
			if (code === "EACCES" || code === "EROFS")
				return { ok: false, reason: "permission-denied" };
			if (code === "ENOSPC") return { ok: false, reason: "disk-full" };
			return { ok: false, reason: "write-failed" };
		}
		try {
			const newStats = await stat(resolved.absolute);
			return { ok: true, mtimeMs: newStats.mtimeMs };
		} catch {
			// Write succeeded; fall back to current time as approximate mtime
			return { ok: true, mtimeMs: Date.now() };
		}
	}

	async readFile(
		worktreePath: string,
		relativePath: string,
	): Promise<FileReadResult> {
		const resolved = this.resolveInsideWorktree(worktreePath, relativePath);
		if (!resolved.ok) {
			return {
				ok: false,
				path: relativePath,
				reason: { kind: "read-failed" },
			};
		}
		const absolutePath = resolved.absolute;

		let fileStat: import("node:fs").Stats;
		try {
			fileStat = await stat(absolutePath);
		} catch {
			return {
				ok: false,
				path: relativePath,
				reason: { kind: "not-found" },
			};
		}
		if (fileStat.isDirectory()) {
			return {
				ok: false,
				path: relativePath,
				reason: { kind: "read-failed" },
			};
		}
		if (fileStat.size > MAX_FILE_VIEW_BYTES) {
			return {
				ok: false,
				path: relativePath,
				reason: { kind: "too-large", size: fileStat.size },
			};
		}

		let buffer: Buffer;
		try {
			buffer = await fsReadFile(absolutePath);
		} catch {
			return {
				ok: false,
				path: relativePath,
				reason: { kind: "read-failed" },
			};
		}
		if (isLikelyBinary(buffer)) {
			return {
				ok: false,
				path: relativePath,
				reason: { kind: "binary" },
			};
		}

		return {
			ok: true,
			view: {
				path: relativePath,
				content: buffer.toString("utf8"),
				language: detectLanguage(relativePath),
			},
		};
	}
}
