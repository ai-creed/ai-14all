import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";

export interface WorkspaceIdentity {
	repoId: string;
	workspaceRel: string;
	workspaceLabel: string;
	branch: string | null;
}

export function sha256Short(input: string, n = 16): string {
	return createHash("sha256").update(input).digest("hex").slice(0, n);
}

const ABS_PATH_RE = /^(\/|~|[A-Za-z]:[\\/]|\\\\)/;
export function isAbsolutePathLike(s: string): boolean {
	return ABS_PATH_RE.test(s);
}
export function assertNoAbsolutePaths(values: Iterable<unknown>): void {
	for (const v of values) {
		if (typeof v === "string" && isAbsolutePathLike(v)) {
			throw new Error(
				"insights: refusing to store an absolute-path-like value",
			);
		}
	}
}
// Recursive: walks strings, arrays, and nested objects so no persisted leaf escapes the guard.
export function assertNoAbsolutePathsDeep(value: unknown): void {
	if (typeof value === "string") {
		if (isAbsolutePathLike(value)) {
			throw new Error(
				"insights: refusing to store an absolute-path-like value",
			);
		}
		return;
	}
	if (Array.isArray(value)) {
		for (const v of value) assertNoAbsolutePathsDeep(v);
		return;
	}
	if (value && typeof value === "object") {
		for (const v of Object.values(value)) assertNoAbsolutePathsDeep(v);
		return;
	}
}

function realpathSafe(p: string): string {
	try {
		return realpathSync(p);
	} catch {
		return p;
	}
}

// Walk up until a `.git` entry (dir or file) is found; return the dir holding it.
function findWorktreeRoot(start: string): string | null {
	let dir = realpathSafe(start);
	for (;;) {
		if (existsSync(join(dir, ".git"))) return dir;
		const parent = dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

function branchFromHead(headDir: string): string | null {
	try {
		const head = readFileSync(join(headDir, "HEAD"), "utf8").trim();
		const m = head.match(/^ref:\s*refs\/heads\/(.+)$/);
		return m ? m[1] : null;
	} catch {
		return null;
	}
}

export function resolveWorkspaceIdentity(
	workspaceRoot: string,
): WorkspaceIdentity {
	const wtRoot = findWorktreeRoot(workspaceRoot);
	if (!wtRoot) {
		const real = realpathSafe(workspaceRoot);
		return {
			repoId: sha256Short(real),
			workspaceRel: basename(real),
			workspaceLabel: basename(real),
			branch: null,
		};
	}
	const gitPath = join(wtRoot, ".git");
	let repoRoot = wtRoot;
	let headDir = gitPath; // where HEAD lives
	if (statSync(gitPath).isFile()) {
		// Linked worktree: ".git" file points at <mainrepo>/.git/worktrees/<name>
		const m = readFileSync(gitPath, "utf8")
			.trim()
			.match(/^gitdir:\s*(.+)$/);
		if (m) {
			const gitdir = m[1]; // .../.git/worktrees/<name>
			headDir = gitdir;
			const commonDir = dirname(dirname(gitdir)); // .../.git
			repoRoot = dirname(commonDir); // main repo root
		}
	}
	repoRoot = realpathSafe(repoRoot);
	const wtReal = realpathSafe(wtRoot);
	const rel = relative(repoRoot, wtReal);
	const workspaceRel =
		rel === "" ? "" : rel.startsWith("..") ? basename(wtReal) : rel;
	return {
		repoId: sha256Short(repoRoot),
		workspaceRel,
		workspaceLabel: basename(wtReal),
		branch: branchFromHead(headDir),
	};
}
