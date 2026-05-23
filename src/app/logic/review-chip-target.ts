import type { GitChange } from "../../../shared/models/git-change";

/**
 * The first changed file that has on-disk working-tree content (i.e. not a
 * deletion), or null if there is none. Used as the default selection when the
 * "x changed" chip opens Files mode — deleted files render as "file not found"
 * in the FileViewer, so they are never chosen as the default target.
 */
export function firstViewableChangedFile(
	changes: GitChange[],
): GitChange | null {
	return changes.find((c) => c.status !== "D") ?? null;
}
