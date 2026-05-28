// Directory names always elided from the worktree file listing regardless of
// the "Show ignored" toggle. Matching is segment-equality so legitimate paths
// like `node_modules_legit/` or `distance/` are not affected.
export const IGNORED_DENYLIST: readonly string[] = [
	"node_modules",
	".git",
	"dist",
	"build",
	".next",
	".cache",
	".turbo",
	"target",
	".venv",
	"venv",
	"__pycache__",
	".gradle",
	".idea",
	"vendor",
];

const DENY = new Set(IGNORED_DENYLIST);

export function isUnderDenylistedDir(path: string): boolean {
	if (!path) return false;
	for (const seg of path.split("/")) {
		if (seg && DENY.has(seg)) return true;
	}
	return false;
}
