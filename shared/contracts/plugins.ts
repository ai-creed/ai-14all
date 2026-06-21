import { z } from "zod";
import { ECOSYSTEM_PLUGIN_IDS } from "../models/ecosystem-plugin.js";
import type {
	AgentCliProbes,
	EcosystemPluginId,
	PluginSnapshot,
	WhisperWorktreeState,
} from "../models/ecosystem-plugin.js";
import {
	type AgentAttentionSource,
	type AgentAttentionState,
} from "../models/agent-attention.js";
import type { AgentProvider } from "../models/agent-attention.js";

// renderer → main (invoke)
export const PLUGINS_LIST = "plugins:list";
export const PLUGINS_SET_ENABLED = "plugins:setEnabled";
export const PLUGINS_REPROBE = "plugins:reprobe";
export const PLUGINS_AGENT_CLIS = "plugins:agentClis";
export const PLUGINS_WHISPER_COMMAND = "plugins:whisperCommand";

// main → renderer (push)
export const PLUGINS_STATE_CHANGED = "plugins:stateChanged";
export const PLUGINS_WHISPER_STATE_CHANGED = "plugins:whisperStateChanged";

// renderer → main (fire-and-forget push of the resolved session slice)
export const PLUGINS_SAMANTHA_SESSION_STATE = "plugins:samanthaSessionState";
// main → renderer (push of the Samantha connection-health state)
export const PLUGINS_SAMANTHA_HEALTH = "plugins:samanthaHealth";

export const SetPluginEnabledSchema = z.object({
	id: z.enum(ECOSYSTEM_PLUGIN_IDS),
	enabled: z.boolean(),
});

// Privileged IPC Trust Boundary (AGENTS.md): renderer-facing payloads carry
// identifiers only; the main process resolves worktree paths server-side via
// WorkspaceRegistryService.get + WorktreeService.findWorktree. No raw
// filesystem path ever crosses this schema.
const WorktreeRefSchema = z.object({
	workspaceId: z.string(),
	worktreeId: z.string(),
});

export const WhisperCommandSchema = z.discriminatedUnion("kind", [
	WorktreeRefSchema.extend({
		kind: z.literal("workflow-pause"),
		workflowId: z.string(),
	}),
	WorktreeRefSchema.extend({
		kind: z.literal("workflow-resume"),
		workflowId: z.string(),
		message: z.string().nullable(),
	}),
	WorktreeRefSchema.extend({
		kind: z.literal("workflow-cancel"),
		workflowId: z.string(),
	}),
	WorktreeRefSchema.extend({
		kind: z.literal("collab-tell"),
		target: z.enum(["claude", "codex", "ezio"]),
		instruction: z.string(),
	}),
	WorktreeRefSchema.extend({
		kind: z.literal("collab-recover"),
	}),
]);

export type WhisperCommand = z.infer<typeof WhisperCommandSchema>;

export type WhisperCommandResult = {
	ok: boolean;
	exitCode: number | null;
	stdout: string;
	stderr: string;
};

export const SamanthaSessionTransitionSchema = z.object({
	at: z.number(),
	from: z.enum(["waiting", "failed", "ready", "stale", "active", "idle"]),
	to: z.enum(["waiting", "failed", "ready", "stale", "active", "idle"]),
	summary: z.string(),
	source: z.enum(["mcp", "terminal", "lifecycle", "workflow"]),
});

export const SamanthaWorktreeSliceSchema = z.object({
	worktreeId: z.string(),
	provider: z.enum(["claude", "codex", "ezio", "other"]).nullable(),
	attention: z.enum(["waiting", "failed", "ready", "stale", "active", "idle"]),
	summary: z.string(),
	task: z.string().nullable(),
	nextAction: z.string().nullable(),
	updatedAt: z.number(),
	recent: z.array(SamanthaSessionTransitionSchema),
});

export const SamanthaSessionSliceSchema = z.object({
	worktrees: z.array(SamanthaWorktreeSliceSchema),
	app: z.object({
		focusedWorktreeId: z.string().nullable(),
		mode: z.enum(["loading", "prompt", "ready"]),
	}),
});

export type SamanthaSessionTransition = {
	at: number;
	from: AgentAttentionState;
	to: AgentAttentionState;
	summary: string;
	source: AgentAttentionSource;
};

export type SamanthaWorktreeSlice = {
	worktreeId: string;
	provider: AgentProvider | null;
	attention: AgentAttentionState;
	summary: string;
	task: string | null;
	nextAction: string | null;
	updatedAt: number;
	recent: SamanthaSessionTransition[];
};

export type SamanthaSessionSlice = {
	worktrees: SamanthaWorktreeSlice[];
	app: { focusedWorktreeId: string | null; mode: "loading" | "prompt" | "ready" };
};

export type SamanthaHealth = {
	link: "connecting" | "connected" | "reconnecting" | "samantha-not-running";
};

export type PluginsApi = {
	list(): Promise<PluginSnapshot[]>;
	setEnabled(
		id: EcosystemPluginId,
		enabled: boolean,
	): Promise<PluginSnapshot[]>;
	reprobe(): Promise<PluginSnapshot[]>;
	agentClis(): Promise<AgentCliProbes>;
	runWhisperCommand(command: WhisperCommand): Promise<WhisperCommandResult>;
	onStateChanged(handler: (snapshots: PluginSnapshot[]) => void): () => void;
	onWhisperStateChanged(
		handler: (states: WhisperWorktreeState[]) => void,
	): () => void;
	publishSamanthaSessionState(slice: SamanthaSessionSlice): void;
	onSamanthaHealth(handler: (health: SamanthaHealth) => void): () => void;
};
