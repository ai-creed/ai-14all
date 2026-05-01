import type { AgentAttentionReasonsBySource } from "./agent-attention";

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
	agentAttentionReasons: AgentAttentionReasonsBySource;
	agentAttentionClearedAt: number | null;
	// Sticky: flips false→true when label/command first matches isAgentProcess,
	// resets only when the process exits/errors/restarts. Pinned at detection
	// time so subsequent OSC title overwrites by the agent CLI itself don't
	// drop us back into "not an agent" mid-run.
	agentDetected: boolean;
};
