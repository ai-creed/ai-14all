import { useCallback } from "react";
import type { MutableRefObject } from "react";
import { commandSubmitKey } from "../../lib/command-submit-key";
import type { ProcessSession } from "../../../shared/models/process-session";
import type { TerminalSession } from "../../../shared/models/terminal-session";
import type { Worktree } from "../../../shared/models/worktree";
import { isAgentProcess } from "../../features/terminals/logic/agent-attention";
import { detectAgentProvider } from "../../features/workspace/logic/agent-provider-detection";
import { notifyToast } from "../../features/ui/toast/ToastProvider";
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
	/** Spawn an ad-hoc shell PTY + build its ProcessSession, or null on failure
	 * (a toast is shown). When `command` is given it is RECORDED on the session
	 * but NOT sent — the caller sends it after subscribing to exit. Caller places
	 * it into a slot. */
	spawnAdHocProcess: (opts?: {
		command?: string;
		label?: string;
	}) => Promise<ProcessSession | null>;
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

	const spawnAdHocProcess = useCallback(
		async (opts?: {
			command?: string;
			label?: string;
		}): Promise<ProcessSession | null> => {
			if (!worktree || !workspaceId) return null;
			const targetWorkspaceId = workspaceId;
			const targetWorktree = worktree;
			try {
				const termSession = await createSession(
					targetWorkspaceId,
					targetWorktree.id,
					targetWorktree.path,
				);
				const targetWorkspaceState = getWorkspaceStateById(targetWorkspaceId);
				const adHocNumber =
					targetWorkspaceState?.nextAdHocNumberByWorktreeId[
						targetWorktree.id
					] ?? 1;
				const label = opts?.label ?? `shell ${adHocNumber}`;
				const command = opts?.command ?? null;
				// Do NOT send the command here. The caller subscribes to the session's
				// exit first (so a fast command cannot exit before the listener
				// exists), then sends it. We only record it on the ProcessSession.
				return {
					id: crypto.randomUUID(),
					workspaceId: targetWorkspaceId,
					worktreeId: targetWorktree.id,
					terminalSessionId: termSession.id,
					origin: "adHoc",
					presetId: null,
					label,
					command,
					status: "running",
					lastActivityAt: null,
					lastOutputPreview: null,
					exitCode: null,
					pinned: false,
					attentionState: "idle",
					agentAttentionReasons: {},
					agentAttentionClearedAt: null,
					agentDetected: isAgentProcess(label, command),
					provider: null,
				};
			} catch (err) {
				// Spawn failed: toast + return null so the caller dispatches nothing
				// — no orphan slot, layout unchanged.
				console.error("Failed to create terminal session:", err);
				notifyToast("Failed to start shell");
				return null;
			}
		},
		[worktree, workspaceId, createSession, getWorkspaceStateById],
	);

	const handleAddAdHoc = useCallback(async () => {
		if (!workspaceId) return;
		const process = await spawnAdHocProcess();
		if (!process) return;
		// registerProcess auto-places into the first empty slot, else promotes the
		// layout bucket (see workspace-state reducer).
		createScopedWorkspaceDispatch(workspaceId)({
			type: "session/registerProcess",
			worktreeId: process.worktreeId,
			process,
		});
	}, [workspaceId, spawnAdHocProcess, createScopedWorkspaceDispatch]);

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
			let terminal: TerminalSession;
			try {
				terminal = await createSession(
					targetWorkspaceId,
					targetWorktree.id,
					targetWorktree.path,
				);
			} catch (err) {
				// Spawn failed: toast + no dispatch -> no orphan slot.
				console.error("Failed to launch preset:", err);
				notifyToast("Failed to launch preset");
				return;
			}
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
					provider: detectAgentProvider(preset.command, preset.label, null),
				},
			});
			// Submit with the platform's Enter byte: `\r` on Windows (ConPTY only
			// runs a line on CR), `\n` elsewhere — see commandSubmitKey.
			await sendInput(terminal.id, `${preset.command}${commandSubmitKey()}`);
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
				await sendInput(terminal.id, `${process.command}${commandSubmitKey()}`);
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
		spawnAdHocProcess,
		handleCloseProcess,
		handleLaunchPreset,
		handleStopProcess,
		handleRestartProcess,
	};
}
