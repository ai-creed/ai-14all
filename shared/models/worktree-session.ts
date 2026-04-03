export type ReviewMode = "files" | "changes";

export type TerminalTab = {
	sessionId: string;
	label: string;
};

export type WorktreeSession = {
	id: string;
	worktreeId: string;
	title: string;
	note: string;
	reviewMode: ReviewMode;
	selectedFilePath: string | null;
	selectedChangedFilePath: string | null;
	activeTerminalSessionId: string | null;
	terminalTabs: TerminalTab[];
};
