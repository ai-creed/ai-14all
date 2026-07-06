export const AGENT_RESUME_BRIDGE_READY = "agent-resume-bridge:ready";
export const AGENT_RESUME_BRIDGE_GOODBYE = "agent-resume-bridge:goodbye";
export const AGENT_RESUME_BRIDGE_REQUEST = "agent-resume-bridge:request";
export const AGENT_RESUME_BRIDGE_REPLY = "agent-resume-bridge:reply";

export type AgentResumeBridgeRequest = {
	id: string;
	worktreeId: string;
	terminalSessionId: string;
	provider: string;
	resumeCommand: string;
	reportedAt: number;
};

export type AgentResumeBridgeReplyOk = { id: string; ok: true };

export type AgentResumeBridgeReplyError = {
	id: string;
	ok: false;
	error: string;
	message: string;
};

export type AgentResumeBridgeReply =
	| AgentResumeBridgeReplyOk
	| AgentResumeBridgeReplyError;
