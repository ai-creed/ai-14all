import { useCallback } from "react";
import type { MutableRefObject } from "react";
import type { ProcessSession } from "../../../shared/models/process-session";
import type { TerminalSession } from "../../../shared/models/terminal-session";
import type { Worktree } from "../../../shared/models/worktree";
import { isAgentProcess } from "../../features/terminals/logic/agent-attention";
import { detectAgentProvider } from "../../features/workspace/logic/agent-provider-detection";
import type {
	WorkspaceAction,
	WorkspaceState,
} from "../../features/workspace/logic/workspace-state";

type Options = {
	workspaceId: string | null;
	worktree: Worktree | null;
	workspaceState: WorkspaceState;
	workspaceStateRef: MutableRefObject<WorkspaceState>;
	outputPreviewBuffersRef: MutableRefObject<Map<string, string>>;
	getWorkspaceStateById: (workspaceId: string) => WorkspaceState | null;
	createScopedWorkspaceDispatch: (
		workspaceId: string,
	) => (action: WorkspaceAction) => void;
	sessions: TerminalSession[];
	createSession: (
		workspaceId: string,
		worktreeId: string,
		cwd: string,
	) => Promise<TerminalSession>;
	sendInput: (sessionId: string, data: string) => Promise<void>;
	stopSession: (sessionId: string) => Promise<void>;
	removeSession: (sessionId: string) => void;
};

export type UseProcessActions = {
	handleAddAdHoc: () => Promise<void>;
	handleCloseProcess: (processId: string) => Promise<void>;
	handleLaunchPreset: (presetId: string) => Promise<void>;
	handleStopProcess: (processId: string) => Promise<void>;
	handleRestartProcess: (processId: string) => Promise<void>;
};

/**
 * Bundle of process/terminal-session lifecycle handlers (create ad-hoc shell,
 * close, launch preset, stop, restart). All handlers operate on the active
 * workspace + worktree and dispatch through the scoped workspace dispatcher
 * so background workspaces see correct accumulation.
 */
export function useProcessActions(options: Options): UseProcessActions {
	const {
		workspaceId,
		worktree,
		workspaceState,
		workspaceStateRef,
		outputPreviewBuffersRef,
		getWorkspaceStateById,
		createScopedWorkspaceDispatch,
		sessions,
		createSession,
		sendInput,
		stopSession,
		removeSession,
	} = options;

	const handleAddAdHoc = useCallback(async () => {
		if (!worktree || !workspaceId) return;
		const targetWorkspaceId = workspaceId;
		const targetWorktree = worktree;
		try {
			const termSession = await createSession(
				targetWorkspaceId,
				targetWorktree.id,
				targetWorktree.path,
			);
			const targetWorkspaceState = getWorkspaceStateById(targetWorkspaceId);
			if (!targetWorkspaceState) return;
			const adHocNumber =
				targetWorkspaceState.nextAdHocNumberByWorktreeId[targetWorktree.id] ??
				1;
			const adHocLabel = `shell ${adHocNumber}`;
			const process: ProcessSession = {
				id: crypto.randomUUID(),
				workspaceId: targetWorkspaceId,
				worktreeId: targetWorktree.id,
				terminalSessionId: termSession.id,
				origin: "adHoc",
				presetId: null,
				label: adHocLabel,
				command: null,
				status: "running",
				lastActivityAt: null,
				lastOutputPreview: null,
				exitCode: null,
				pinned: false,
				attentionState: "idle",
				agentAttentionReasons: {},
				agentAttentionClearedAt: null,
				agentDetected: isAgentProcess(adHocLabel, null),
				provider: null,
			};
			createScopedWorkspaceDispatch(targetWorkspaceId)({
				type: "session/registerProcess",
				worktreeId: targetWorktree.id,
				process,
			});
		} catch (err) {
			console.error("Failed to create terminal session:", err);
			throw err;
		}
	}, [
		worktree,
		workspaceId,
		createSession,
		getWorkspaceStateById,
		createScopedWorkspaceDispatch,
	]);

	const handleCloseProcess = useCallback(
		async (processId: string) => {
			if (!worktree || !workspaceId) return;
			const targetWorkspaceId = workspaceId;
			const targetWorktreeId = worktree.id;
			const process = workspaceStateRef.current.processSessionsById[processId];
			if (!process) return;
			const terminalId = process.terminalSessionId;
			if (terminalId) {
				const session = sessions.find((entry) => entry.id === terminalId);
				try {
					if (
						session &&
						(session.status === "running" || session.status === "idle")
					) {
						await stopSession(terminalId);
					}
				} catch (err) {
					console.error("Failed to stop terminal session:", err);
				} finally {
					outputPreviewBuffersRef.current.delete(terminalId);
					removeSession(terminalId);
				}
			}
			createScopedWorkspaceDispatch(targetWorkspaceId)({
				type: "session/closeProcess",
				worktreeId: targetWorktreeId,
				processId,
			});
		},
		[
			worktree,
			workspaceId,
			workspaceStateRef,
			outputPreviewBuffersRef,
			sessions,
			stopSession,
			removeSession,
			createScopedWorkspaceDispatch,
		],
	);

	const handleLaunchPreset = useCallback(
		async (presetId: string) => {
			if (!worktree || !workspaceId) return;
			const targetWorkspaceId = workspaceId;
			const targetWorktree = worktree;
			const preset = workspaceState.commandPresets.find(
				(p) => p.id === presetId,
			);
			if (!preset) return;
			const terminal = await createSession(
				targetWorkspaceId,
				targetWorktree.id,
				targetWorktree.path,
			);
			createScopedWorkspaceDispatch(targetWorkspaceId)({
				type: "session/registerProcess",
				worktreeId: targetWorktree.id,
				process: {
					id: crypto.randomUUID(),
					workspaceId: targetWorkspaceId,
					worktreeId: targetWorktree.id,
					terminalSessionId: terminal.id,
					origin: "preset",
					presetId: preset.id,
					label: preset.label,
					command: preset.command,
					status: "running",
					lastActivityAt: null,
					lastOutputPreview: null,
					exitCode: null,
					pinned: true,
					attentionState: "idle",
					agentAttentionReasons: {},
					agentAttentionClearedAt: null,
					agentDetected: isAgentProcess(preset.label, preset.command),
					provider: detectAgentProvider(
						preset.command,
						preset.label,
						null,
					),
				},
			});
			await sendInput(terminal.id, `${preset.command}\n`);
		},
		[
			worktree,
			workspaceId,
			workspaceState.commandPresets,
			createSession,
			sendInput,
			createScopedWorkspaceDispatch,
		],
	);

	const handleStopProcess = useCallback(
		async (processId: string) => {
			const process = workspaceState.processSessionsById[processId];
			if (!process?.terminalSessionId) return;
			await stopSession(process.terminalSessionId);
		},
		[workspaceState.processSessionsById, stopSession],
	);

	const handleRestartProcess = useCallback(
		async (processId: string) => {
			const process = workspaceState.processSessionsById[processId];
			if (!process || !worktree || !workspaceId) return;
			const targetWorkspaceId = workspaceId;
			const targetWorktree = worktree;

			if (process.terminalSessionId) {
				try {
					await stopSession(process.terminalSessionId);
				} catch {
					// best effort
				}
				outputPreviewBuffersRef.current.delete(process.terminalSessionId);
				removeSession(process.terminalSessionId);
			}

			const terminal = await createSession(
				targetWorkspaceId,
				targetWorktree.id,
				targetWorktree.path,
			);
			const dispatchToTargetWorkspace =
				createScopedWorkspaceDispatch(targetWorkspaceId);
			dispatchToTargetWorkspace({
				type: "session/replaceProcessTerminal",
				processId,
				terminalSessionId: terminal.id,
			});
			dispatchToTargetWorkspace({
				type: "session/updateProcessStatus",
				processId,
				status: "running",
				exitCode: null,
			});

			if (process.command) {
				await sendInput(terminal.id, `${process.command}\n`);
			}
		},
		[
			workspaceState.processSessionsById,
			worktree,
			workspaceId,
			outputPreviewBuffersRef,
			createSession,
			sendInput,
			stopSession,
			removeSession,
			createScopedWorkspaceDispatch,
		],
	);

	return {
		handleAddAdHoc,
		handleCloseProcess,
		handleLaunchPreset,
		handleStopProcess,
		handleRestartProcess,
	};
}
