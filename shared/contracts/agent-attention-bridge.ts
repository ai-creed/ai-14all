import type { AgentAttentionState } from "../models/agent-attention.js";

export const AGENT_ATTENTION_BRIDGE_READY = "agent-attention-bridge:ready";
export const AGENT_ATTENTION_BRIDGE_GOODBYE = "agent-attention-bridge:goodbye";
export const AGENT_ATTENTION_BRIDGE_REQUEST = "agent-attention-bridge:request";
export const AGENT_ATTENTION_BRIDGE_REPLY = "agent-attention-bridge:reply";

export type AgentAttentionBridgeRequest = {
	id: string;
	worktreeId: string;
	state: Exclude<AgentAttentionState, "stale" | "idle">;
	summary: string;
	nextAction: string | null;
	reportedAt: number;
};

export type AgentAttentionBridgeReplyOk = { id: string; ok: true };

export type AgentAttentionBridgeReplyError = {
	id: string;
	ok: false;
	error: string;
	message: string;
};

export type AgentAttentionBridgeReply =
	| AgentAttentionBridgeReplyOk
	| AgentAttentionBridgeReplyError;
