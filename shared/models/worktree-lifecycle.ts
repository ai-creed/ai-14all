import type { GitCommitSummary } from "./git-summary.js";

export type CreateWorktreePreview = {
	name: string;
	branchName: string;
	path: string;
	baseRef: "origin/master";
	baseCommit: GitCommitSummary;
};

export type RemoveWorktreePreview = {
	worktreeId: string;
	label: string;
	branchName: string;
	path: string;
	isMain: boolean;
	isDirty: boolean;
};
