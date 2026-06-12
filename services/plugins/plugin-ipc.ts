import type { IpcMain, WebContents } from "electron";
import {
	PLUGINS_AGENT_CLIS,
	PLUGINS_LIST,
	PLUGINS_REPROBE,
	PLUGINS_SET_ENABLED,
	PLUGINS_STATE_CHANGED,
	PLUGINS_WHISPER_COMMAND,
	PLUGINS_WHISPER_STATE_CHANGED,
	SetPluginEnabledSchema,
	WhisperCommandSchema,
	type WhisperCommand,
	type WhisperCommandResult,
} from "../../shared/contracts/plugins.js";
import type {
	AgentCliProbes,
	WhisperWorktreeState,
} from "../../shared/models/ecosystem-plugin.js";
import type { PluginRegistry } from "./plugin-registry.js";

export type PluginIpcDeps = {
	ipcMain: IpcMain;
	registry: PluginRegistry;
	config: { setEnabled(id: string, enabled: boolean): void };
	/**
	 * Server-side id→path resolution (Privileged IPC Trust Boundary,
	 * AGENTS.md): wired to WorkspaceRegistryService.get +
	 * WorktreeService.findWorktree, both of which THROW on unknown ids —
	 * the rejection propagates to the renderer; do not add `if (!x)` checks.
	 */
	resolveWorktreeCwd: (
		workspaceId: string,
		worktreeId: string,
	) => Promise<string>;
	runWhisperCommand: (
		cmd: WhisperCommand,
		cwd: string,
	) => Promise<WhisperCommandResult>;
	/** The capability probe service: cached agent-CLI probes + the
	 * invalidation hook the spec's re-probe triggers funnel through. */
	probes: {
		agentClis: () => Promise<AgentCliProbes>;
		invalidate: () => void;
	};
	getWebContents: () => WebContents | null;
};

export function registerPluginIpc(deps: PluginIpcDeps): { dispose: () => void } {
	const { ipcMain, registry } = deps;

	ipcMain.handle(PLUGINS_LIST, () => registry.snapshots());

	ipcMain.handle(PLUGINS_SET_ENABLED, async (_event, raw: unknown) => {
		const payload = SetPluginEnabledSchema.parse(raw);
		deps.probes.invalidate(); // toggle flip is a re-probe trigger
		deps.config.setEnabled(payload.id, payload.enabled);
		await registry.idle();
		return registry.snapshots();
	});

	ipcMain.handle(PLUGINS_REPROBE, async () => {
		deps.probes.invalidate(); // panel-open / manual re-probe trigger
		await registry.reprobe();
		return registry.snapshots();
	});

	ipcMain.handle(PLUGINS_AGENT_CLIS, () => deps.probes.agentClis());

	ipcMain.handle(PLUGINS_WHISPER_COMMAND, async (_event, raw: unknown) => {
		const command = WhisperCommandSchema.parse(raw);
		const cwd = await deps.resolveWorktreeCwd(
			command.workspaceId,
			command.worktreeId,
		);
		return deps.runWhisperCommand(command, cwd);
	});

	const unsubscribe = registry.onSnapshots((snapshots) => {
		deps.getWebContents()?.send(PLUGINS_STATE_CHANGED, snapshots);
	});

	return {
		dispose() {
			unsubscribe();
			for (const channel of [
				PLUGINS_LIST,
				PLUGINS_SET_ENABLED,
				PLUGINS_REPROBE,
				PLUGINS_AGENT_CLIS,
				PLUGINS_WHISPER_COMMAND,
			])
				ipcMain.removeHandler(channel);
		},
	};
}

/** Called by the whisper driver (a later task) to push lens state to the renderer. */
export function pushWhisperState(
	getWebContents: () => WebContents | null,
	states: WhisperWorktreeState[],
): void {
	getWebContents()?.send(PLUGINS_WHISPER_STATE_CHANGED, states);
}
