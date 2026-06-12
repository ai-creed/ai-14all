import { z } from "zod";
import { ECOSYSTEM_PLUGIN_IDS } from "../models/ecosystem-plugin.js";
import type {
	AgentCliProbes,
	EcosystemPluginId,
	PluginSnapshot,
	WhisperWorktreeState,
} from "../models/ecosystem-plugin.js";

// renderer → main (invoke)
export const PLUGINS_LIST = "plugins:list";
export const PLUGINS_SET_ENABLED = "plugins:setEnabled";
export const PLUGINS_REPROBE = "plugins:reprobe";
export const PLUGINS_AGENT_CLIS = "plugins:agentClis";
export const PLUGINS_WHISPER_COMMAND = "plugins:whisperCommand";

// main → renderer (push)
export const PLUGINS_STATE_CHANGED = "plugins:stateChanged";
export const PLUGINS_WHISPER_STATE_CHANGED = "plugins:whisperStateChanged";

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
};
