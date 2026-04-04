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

export type GitCommitFileDiff = {
	path: string;
	oldPath: string | null;
	status: "A" | "M" | "D" | "R";
	originalContent: string;
	modifiedContent: string;
};

export type GitCommitDetail = {
	sha: string;
	shortSha: string;
	subject: string;
	files: GitCommitFileDiff[];
};
