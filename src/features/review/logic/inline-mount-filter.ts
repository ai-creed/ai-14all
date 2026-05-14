import type { ReviewComment } from "../../../../shared/models/review-comment";
import type { ReviewMode } from "../../../../shared/models/worktree-session";

type Args = {
	reviewMode: ReviewMode;
	filePath: string | null;
	commitSha: string | null;
};

export type InlineFilterResult = {
	inline: ReviewComment[];
	otherModes: ReviewComment[];
};

export function filterForInlineMount(
	comments: ReviewComment[],
	args: Args,
): InlineFilterResult {
	const inline: ReviewComment[] = [];
	const otherModes: ReviewComment[] = [];
	for (const c of comments) {
		if (matchesInline(c, args)) inline.push(c);
		else otherModes.push(c);
	}
	return { inline, otherModes };
}

function matchesInline(c: ReviewComment, args: Args): boolean {
	if (args.reviewMode === "files") return false;
	if (args.filePath === null || c.filePath !== args.filePath) return false;
	if (args.reviewMode === "changes") return c.source === "working-tree";
	if (args.reviewMode === "commits") {
		return c.source === "commit" && c.commitSha === args.commitSha;
	}
	return false;
}
