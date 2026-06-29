import type { GitChange } from "../../../../shared/models/git-change";
import type { ReviewedFileMark } from "../../../../shared/models/reviewed-file";

export type ReviewProgress = { reviewed: number; total: number };

/**
 * Generic form: which of `paths` are currently considered reviewed. A path
 * qualifies when a mark exists and either its content has not been loaded this
 * session (`currentHashes` has no entry → trust the persisted mark) or the
 * loaded hash matches the mark. This is the "reset rides the refresh path, no
 * watcher" tradeoff from the spec: precise once a file is opened, best-effort
 * before. Used for both the working-tree change list and the commit file list.
 */
export function reviewedPathsAmong(
	paths: string[],
	marks: ReviewedFileMark[],
	currentHashes: Record<string, string>,
): string[] {
	const out: string[] = [];
	for (const path of paths) {
		const mark = marks.find((m) => m.filePath === path);
		if (!mark) continue;
		const currentHash = currentHashes[path];
		if (currentHash === undefined || currentHash === mark.contentHash) {
			out.push(path);
		}
	}
	return out;
}

export function reviewedChangedPaths(
	changes: GitChange[],
	marks: ReviewedFileMark[],
	currentHashes: Record<string, string>,
): string[] {
	return reviewedPathsAmong(
		changes.map((c) => c.path),
		marks,
		currentHashes,
	);
}

export function computeReviewProgress(
	changes: GitChange[],
	marks: ReviewedFileMark[],
	currentHashes: Record<string, string>,
): ReviewProgress {
	return {
		reviewed: reviewedChangedPaths(changes, marks, currentHashes).length,
		total: changes.length,
	};
}
