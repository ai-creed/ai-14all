// Maps worktree-relative files to/from `file://` URI strings. Pure (no monaco
// import) so it is unit-testable; the provider/opener convert at the boundary
// with monaco.Uri.parse(str) / uri.toString(). The model URI's basename is the
// real filename, so Monaco's peek shows a readable name.

function normalizeRoot(worktreeRoot: string): string {
	return normalizeAbsPosix(worktreeRoot).replace(/\/+$/, "");
}

/**
 * Collapses `.`/`..` segments in an absolute POSIX path so an inside-worktree
 * check cannot be fooled by traversal (e.g. `/wt/../outside.ts` → `/outside.ts`).
 * `..` never climbs above the filesystem root. Always returns a path starting
 * with "/". Pure string work — no node:path so the module stays renderer-safe.
 */
function normalizeAbsPosix(path: string): string {
	const out: string[] = [];
	for (const seg of path.split("/")) {
		if (seg === "" || seg === ".") continue;
		if (seg === "..") out.pop();
		else out.push(seg);
	}
	return `/${out.join("/")}`;
}

/** file:// URI string for a worktree-relative file under an absolute worktree root. */
export function toFileUri(worktreeRoot: string, relFile: string): string {
	const abs = `${normalizeRoot(worktreeRoot)}/${relFile.replace(/^\/+/, "")}`;
	const encoded = abs
		.split("/")
		.map((seg) => encodeURIComponent(seg))
		.join("/");
	// abs starts with "/", so encoded starts with "" then "/..." → file:///abs
	return `file://${encoded}`;
}

/** Worktree-relative file for a file:// URI inside worktreeRoot, or null if outside. */
export function fromFileUri(
	worktreeRoot: string,
	uriString: string,
): string | null {
	if (!uriString.startsWith("file://")) return null;
	const rawPath = uriString.slice("file://".length);
	const decoded = rawPath
		.split("/")
		.map((seg) => {
			try {
				return decodeURIComponent(seg);
			} catch {
				return seg;
			}
		})
		.join("/");
	// Normalize `.`/`..` (decoded first, so `%2e%2e` traversal is also caught)
	// before the prefix check, per spec §4.2 — a raw startsWith() would let
	// `/wt/../outside.ts` slip through as a worktree-relative path.
	const path = normalizeAbsPosix(decoded);
	const root = normalizeRoot(worktreeRoot);
	if (path === root) return "";
	const prefix = `${root}/`;
	if (!path.startsWith(prefix)) return null;
	return path.slice(prefix.length);
}
