import type { GitCommitListEntry } from "../../../../shared/models/git-commit-review.js";

export type LinearCommitRow = GitCommitListEntry & {
	rowKind: "commit" | "mergeTarget";
};

export function buildLinearCommitGraph(
	entries: GitCommitListEntry[],
): LinearCommitRow[] {
	return entries.map((entry) => ({
		...entry,
		rowKind: entry.isMergeTarget ? "mergeTarget" : "commit",
	}));
}
