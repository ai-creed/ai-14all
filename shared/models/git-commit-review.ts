export type GitCommitListEntry = {
	sha: string;
	shortSha: string;
	subject: string;
	isMergeTarget: boolean;
};

export type GitCommitHistory = {
	mergeTargetRef: string | null;
	entries: GitCommitListEntry[];
};

// Lightweight per-file entry returned by `readCommitDetail`. No file content
// is loaded eagerly — the renderer requests `readCommitFileDiff(sha, path)`
// for each section as the user expands it, so opening a 50-file commit no
// longer fans out 100 parallel `git show` subprocesses up front.
export type GitCommitFileEntry = {
	path: string;
	oldPath: string | null;
	status: "A" | "M" | "D" | "R";
};

// Full per-file diff payload returned by the on-demand single-file fetch.
export type GitCommitFileDiff = GitCommitFileEntry & {
	originalContent: string;
	modifiedContent: string;
};

export type GitCommitDetail = {
	sha: string;
	shortSha: string;
	subject: string;
	files: GitCommitFileEntry[];
};
