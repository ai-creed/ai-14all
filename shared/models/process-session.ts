export type ProcessOrigin = "adHoc" | "preset";
export type ProcessAttentionState = "idle" | "activity" | "actionRequired";
export type ProcessStatus = "running" | "exited" | "error" | "restarting";

export type ProcessSession = {
	id: string;
	workspaceId: string;
	worktreeId: string;
	terminalSessionId: string | null;
	origin: ProcessOrigin;
	presetId: string | null;
	label: string;
	command: string | null;
	status: ProcessStatus;
	lastActivityAt: number | null;
	lastOutputPreview: string | null;
	exitCode: number | null;
	pinned: boolean;
	attentionState: ProcessAttentionState;
};
