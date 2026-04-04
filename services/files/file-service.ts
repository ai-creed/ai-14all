import { readdir, readFile as fsReadFile, stat } from "node:fs/promises";
import { join, resolve, extname } from "node:path";
import type { FileView } from "../../shared/models/file-view.js";

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
					const nested: string[] = [];
					await walkDir(worktreePath, relativeRoot, nested);
					nested.forEach((entry) => files.add(entry));
				} else if (stats.isFile()) {
					files.add(relativeRoot);
				}
			} catch {
				// Path does not exist (e.g. deleted file) — skip it silently
			}
		}

		return [...files].sort((a, b) => a.localeCompare(b));
	}

	async readFile(
		worktreePath: string,
		relativePath: string,
	): Promise<FileView> {
		// Reject path escapes outside the worktree
		const absolutePath = resolve(worktreePath, relativePath);
		const normalizedWorktree = resolve(worktreePath);
		if (
			!absolutePath.startsWith(normalizedWorktree + "/") &&
			absolutePath !== normalizedWorktree
		) {
			throw new Error(`Path escapes worktree: ${relativePath}`);
		}

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
