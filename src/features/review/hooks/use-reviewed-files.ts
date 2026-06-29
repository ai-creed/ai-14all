import { useCallback, useMemo, useState } from "react";
import type { ReviewedFileMark } from "../../../../shared/models/reviewed-file";
import type { WorkspaceAction } from "../../workspace/logic/workspace-state";
import { hashContent } from "../logic/content-hash";
import { isFileReviewed } from "../logic/reviewed-files";
import { reviewedPathsAmong, type ReviewProgress } from "../logic/review-progress";

export type ReviewedFilesApi = {
	recordHash: (filePath: string, content: string) => void;
	isReviewed: (filePath: string) => boolean;
	reviewedPaths: (paths: string[]) => string[];
	progress: (paths: string[]) => ReviewProgress;
	toggleViewed: (filePath: string, content: string) => void;
};

export function useReviewedFiles(args: {
	worktreeId: string;
	marks: ReviewedFileMark[];
	dispatch: (action: WorkspaceAction) => void;
}): ReviewedFilesApi {
	const { worktreeId, marks, dispatch } = args;
	// Memory-only map of path → latest known content hash. Populated as diff
	// editors mount; an absent entry means "not loaded this session", so a
	// persisted mark is trusted until its content is seen (no-watcher tradeoff).
	const [hashes, setHashes] = useState<Record<string, string>>({});

	const recordHash = useCallback((filePath: string, content: string) => {
		const h = hashContent(content);
		setHashes((prev) => (prev[filePath] === h ? prev : { ...prev, [filePath]: h }));
	}, []);

	const isReviewed = useCallback(
		(filePath: string) => {
			const h = hashes[filePath];
			return h !== undefined && isFileReviewed(marks, filePath, h);
		},
		[hashes, marks],
	);

	const reviewedPaths = useCallback(
		(paths: string[]) => reviewedPathsAmong(paths, marks, hashes),
		[marks, hashes],
	);

	const progress = useCallback(
		(paths: string[]): ReviewProgress => ({
			reviewed: reviewedPathsAmong(paths, marks, hashes).length,
			total: paths.length,
		}),
		[marks, hashes],
	);

	const toggleViewed = useCallback(
		(filePath: string, content: string) => {
			const h = hashContent(content);
			const already = marks.some(
				(m) => m.filePath === filePath && m.contentHash === h,
			);
			dispatch(
				already
					? { type: "session/unmarkFileViewed", worktreeId, filePath }
					: { type: "session/markFileViewed", worktreeId, filePath, contentHash: h },
			);
		},
		[marks, worktreeId, dispatch],
	);

	return useMemo(
		() => ({ recordHash, isReviewed, reviewedPaths, progress, toggleViewed }),
		[recordHash, isReviewed, reviewedPaths, progress, toggleViewed],
	);
}
