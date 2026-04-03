export type GitChangeStatus = "M" | "A" | "D" | "R" | "??";

export type GitChange = {
	path: string;
	status: GitChangeStatus;
	/** For renames, the original (source) path before the rename. */
	oldPath?: string;
};
