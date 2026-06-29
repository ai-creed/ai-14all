import type { ReviewComment } from "../../../../shared/models/review-comment";

export function filterHideAddressed(
	comments: ReviewComment[],
	hide: boolean,
): ReviewComment[] {
	return hide ? comments.filter((c) => c.status !== "addressed") : comments;
}

export function groupCommentsByFile(
	comments: ReviewComment[],
): Array<[string, ReviewComment[]]> {
	const byFile = new Map<string, ReviewComment[]>();
	for (const c of comments) {
		const arr = byFile.get(c.filePath) ?? [];
		arr.push(c);
		byFile.set(c.filePath, arr);
	}
	return [...byFile.entries()];
}

export function firstLine(body: string): string {
	for (const line of body.split("\n")) {
		if (line.trim().length > 0) return line;
	}
	return "";
}
