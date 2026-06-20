import nodePath from "node:path";

type PathLike = Pick<typeof nodePath, "resolve" | "sep">;

/**
 * Resolve `relativePath` against `worktreePath` and report whether the result
 * stays inside (or equal to) the worktree — the shared guard behind every
 * file/git read, edit, and discard.
 *
 * The boundary test uses `pathImpl.sep`, NOT a hardcoded "/", because
 * `resolve()` returns OS-native separators: on Windows it yields backslashes,
 * so a "/" check rejects every in-worktree path as an escape (the "path escapes
 * the worktree" bug in the review/editor chrome).
 *
 * Lives under `services/` (not `shared/`) because it imports `node:path`, which
 * the browser renderer cannot. `pathImpl` defaults to the host `node:path`; pass
 * `path.win32` or `path.posix` to exercise either platform's separator
 * behaviour from any host, which is how the cross-platform regression tests run
 * on a POSIX CI.
 */
export function resolveWithinWorktree(
	worktreePath: string,
	relativePath: string,
	pathImpl: PathLike = nodePath,
): { absolute: string; root: string; inside: boolean } {
	const absolute = pathImpl.resolve(worktreePath, relativePath);
	const root = pathImpl.resolve(worktreePath);
	const inside = absolute === root || absolute.startsWith(root + pathImpl.sep);
	return { absolute, root, inside };
}
