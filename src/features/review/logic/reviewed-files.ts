import type { ReviewedFileMark } from "../../../../shared/models/reviewed-file";

export function isFileReviewed(
	marks: ReviewedFileMark[],
	filePath: string,
	currentHash: string,
): boolean {
	const mark = marks.find((m) => m.filePath === filePath);
	return mark !== undefined && mark.contentHash === currentHash;
}

export function upsertReviewedMark(
	marks: ReviewedFileMark[],
	filePath: string,
	contentHash: string,
): ReviewedFileMark[] {
	const others = marks.filter((m) => m.filePath !== filePath);
	return [...others, { filePath, contentHash }];
}

export function removeReviewedMark(
	marks: ReviewedFileMark[],
	filePath: string,
): ReviewedFileMark[] {
	return marks.filter((m) => m.filePath !== filePath);
}
