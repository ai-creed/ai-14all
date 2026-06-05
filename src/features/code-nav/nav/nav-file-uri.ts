// Maps worktree-relative files to/from `file://` URI strings. Pure (no monaco
// import) so it is unit-testable; the provider/opener convert at the boundary
// with monaco.Uri.parse(str) / uri.toString(). The model URI's basename is the
// real filename, so Monaco's peek shows a readable name.

function normalizeRoot(worktreeRoot: string): string {
	return worktreeRoot.replace(/\/+$/, "");
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
	const path = rawPath
		.split("/")
		.map((seg) => {
			try {
				return decodeURIComponent(seg);
			} catch {
				return seg;
			}
		})
		.join("/");
	const root = normalizeRoot(worktreeRoot);
	if (path === root) return "";
	const prefix = `${root}/`;
	if (!path.startsWith(prefix)) return null;
	return path.slice(prefix.length);
}
