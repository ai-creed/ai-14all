import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
	readdir,
	readFile as fsReadFile,
	stat,
	writeFile,
} from "node:fs/promises";
import { join, resolve, extname } from "node:path";
import type { FileView } from "../../shared/models/file-view.js";
import type {
	OpenFileForEditResult,
	SaveFileResult,
} from "../../shared/contracts/commands.js";
import { getGitBinaryPath } from "../git/git-binary.js";
import { isEditable } from "../../shared/editor/editable-files.js";

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
			const absoluteRoot = resolve(worktreePath, relativeRoot);
			const normalizedWorktree = resolve(worktreePath);
			if (
				!absoluteRoot.startsWith(normalizedWorktree + "/") &&
				absoluteRoot !== normalizedWorktree
			) {
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

	async listTrackedFiles(worktreePath: string): Promise<string[]> {
		const gitBinary = getGitBinaryPath();
		const { stdout } = await execFileAsync(
			gitBinary,
			["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
			{ cwd: worktreePath, maxBuffer: 64 * 1024 * 1024 },
		);
		return stdout.split("\0").filter((entry) => entry.length > 0);
	}

	private resolveInsideWorktree(
		worktreePath: string,
		relativePath: string,
	): { ok: true; absolute: string } | { ok: false; reason: "path-escape" } {
		const absolutePath = resolve(worktreePath, relativePath);
		const normalizedWorktree = resolve(worktreePath);
		const inside =
			absolutePath === normalizedWorktree ||
			absolutePath.startsWith(normalizedWorktree + "/");
		return inside
			? { ok: true, absolute: absolutePath }
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
	): Promise<FileView> {
		const resolved = this.resolveInsideWorktree(worktreePath, relativePath);
		if (!resolved.ok) throw new Error(`Path escapes worktree: ${relativePath}`);
		const absolutePath = resolved.absolute;

		// Reject directories
		const fileStat = await stat(absolutePath);
		if (fileStat.isDirectory()) {
			throw new Error(`Path is a directory: ${relativePath}`);
		}

		const content = await fsReadFile(absolutePath, "utf-8");
		const language = detectLanguage(relativePath);

		return { path: relativePath, content, language };
	}
}
