import type { GitChange } from "./git-change.js";

export type GitCommitSummary = {
	sha: string;
	shortSha: string;
	subject: string;
};

export type GitSummary = {
	branchName: string;
	isDirty: boolean;
	mergeTargetRef?: string | null;
	aheadCount?: number;
	behindCount?: number;
	changedFileCount: number;
	changedFiles: GitChange[];
	recentCommits: GitCommitSummary[];
};
