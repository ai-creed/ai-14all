import { useCallback } from "react";
import type { MutableRefObject } from "react";
import type { ProcessSession } from "../../../shared/models/process-session";
import type { TerminalSession } from "../../../shared/models/terminal-session";
import type { Worktree } from "../../../shared/models/worktree";
import { clearReplayOutput } from "../../features/terminals/logic/replay-buffer";
import { notifyToast } from "../../features/ui/toast/ToastProvider";
import {
	MAX_FLOATING_SHELLS,
	type WorkspaceAction,
	type WorkspaceState,
} from "../../features/workspace/logic/workspace-state";

type Options = {
	workspaceId: string | null;
	worktree: Worktree | null;
	workspaceStateRef: MutableRefObject<WorkspaceState>;
	outputPreviewBuffersRef: MutableRefObject<Map<string, string>>;
	/**
	 * Synchronous shadow lookup — returns the state the reducer will actually
	 * see (and, after a scoped dispatch, the state the reducer produced). Used
	 * to read the cap and to verify a registration was accepted, since
	 * workspaceStateRef lags dispatches (assigned during render).
	 */
	getWorkspaceStateById: (workspaceId: string) => WorkspaceState | null;
	createScopedWorkspaceDispatch: (
		workspaceId: string,
	) => (action: WorkspaceAction) => void;
	sessions: TerminalSession[];
	/** From useProcessActions — spawns the PTY + builds the ProcessSession. */
	spawnAdHocProcess: () => Promise<ProcessSession | null>;
	stopSession: (sessionId: string) => Promise<void>;
	removeSession: (sessionId: string) => void;
};

export type UseFloatingShellActions = {
	handleAddFloatingShell: () => Promise<void>;
	handleCloseFloatingShell: (processId: string) => Promise<void>;
	handlePinFloatingShell: (processId: string) => void;
	handleExpandFloatingShell: (processId: string) => void;
	handleMinimizeFloatingShell: (processId: string) => void;
};

/**
 * Lifecycle handlers for floating (throwaway) shells. The launch handler
 * enforces the cap BEFORE spawning so a no-op at the cap never creates a backend
 * PTY, and tears down the just-created PTY if a concurrent launch filled the
 * last slot during the async spawn (spec §5.7).
 */
export function useFloatingShellActions(
	options: Options,
): UseFloatingShellActions {
	const {
		workspaceId,
		worktree,
		workspaceStateRef,
		outputPreviewBuffersRef,
		getWorkspaceStateById,
		createScopedWorkspaceDispatch,
		sessions,
		spawnAdHocProcess,
		stopSession,
		removeSession,
	} = options;

	const floatingCount = useCallback(
		(worktreeId: string): number =>
			workspaceId
				? (getWorkspaceStateById(workspaceId)?.sessionsByWorktreeId[worktreeId]
						?.floatingShellIds.length ?? 0)
				: 0,
		[getWorkspaceStateById, workspaceId],
	);

	const teardownOrphan = useCallback(
		async (terminalSessionId: string | null) => {
			if (!terminalSessionId) return;
			try {
				await stopSession(terminalSessionId);
			} catch {
				// best effort
			}
			outputPreviewBuffersRef.current.delete(terminalSessionId);
			removeSession(terminalSessionId);
			clearReplayOutput(terminalSessionId);
		},
		[stopSession, removeSession, outputPreviewBuffersRef],
	);

	const handleAddFloatingShell = useCallback(async () => {
		if (!workspaceId || !worktree) return;
		const worktreeId = worktree.id;
		// Pre-spawn cap: no-op with a brief hint so the user knows why nothing
		// happened, and so we never create a backend PTY at the cap (spec §5.7).
		if (floatingCount(worktreeId) >= MAX_FLOATING_SHELLS) {
			notifyToast(`Maximum ${MAX_FLOATING_SHELLS} floating shells`);
			return;
		}
		const process = await spawnAdHocProcess();
		if (!process) return;
		// Re-check after the async spawn: if a concurrent launch filled the last
		// slot, tear the new PTY down instead of orphaning it.
		if (floatingCount(worktreeId) >= MAX_FLOATING_SHELLS) {
			await teardownOrphan(process.terminalSessionId);
			return;
		}
		createScopedWorkspaceDispatch(workspaceId)({
			type: "session/registerFloatingShell",
			worktreeId,
			process,
		});
		// Defensive post-dispatch verify: the reducer enforces the cap against the
		// synchronous shadow, which can reject after a race even when the recheck
		// above passed (the recheck reads a possibly-lagged view). If the new
		// process did not land in floatingShellIds, the reducer rejected it — tear
		// the PTY down so it is not orphaned.
		const after = getWorkspaceStateById(workspaceId);
		const accepted =
			after?.sessionsByWorktreeId[worktreeId]?.floatingShellIds.includes(
				process.id,
			) ?? false;
		if (!accepted) {
			await teardownOrphan(process.terminalSessionId);
		}
	}, [
		workspaceId,
		worktree,
		floatingCount,
		spawnAdHocProcess,
		teardownOrphan,
		getWorkspaceStateById,
		createScopedWorkspaceDispatch,
	]);

	const handleCloseFloatingShell = useCallback(
		async (processId: string) => {
			if (!workspaceId || !worktree) return;
			const worktreeId = worktree.id;
			const process =
				workspaceStateRef.current.processSessionsById[processId];
			const terminalId = process?.terminalSessionId ?? null;
			if (terminalId) {
				const session = sessions.find((s) => s.id === terminalId);
				try {
					if (
						session &&
						(session.status === "running" || session.status === "idle")
					) {
						await stopSession(terminalId);
					}
				} catch (err) {
					console.error("Failed to stop floating shell:", err);
				} finally {
					outputPreviewBuffersRef.current.delete(terminalId);
					removeSession(terminalId);
					clearReplayOutput(terminalId);
				}
			}
			createScopedWorkspaceDispatch(workspaceId)({
				type: "session/closeFloatingShell",
				worktreeId,
				processId,
			});
		},
		[
			workspaceId,
			worktree,
			workspaceStateRef,
			sessions,
			stopSession,
			removeSession,
			outputPreviewBuffersRef,
			createScopedWorkspaceDispatch,
		],
	);

	const dispatchForWorktree = useCallback(
		(action: WorkspaceAction) => {
			if (!workspaceId) return;
			createScopedWorkspaceDispatch(workspaceId)(action);
		},
		[workspaceId, createScopedWorkspaceDispatch],
	);

	const handlePinFloatingShell = useCallback(
		(processId: string) => {
			if (!worktree) return;
			dispatchForWorktree({
				type: "session/pinFloatingShellToSlot",
				worktreeId: worktree.id,
				processId,
			});
		},
		[worktree, dispatchForWorktree],
	);

	const handleExpandFloatingShell = useCallback(
		(processId: string) => {
			if (!worktree) return;
			dispatchForWorktree({
				type: "session/expandFloatingShell",
				worktreeId: worktree.id,
				processId,
			});
		},
		[worktree, dispatchForWorktree],
	);

	const handleMinimizeFloatingShell = useCallback(
		(processId: string) => {
			if (!worktree) return;
			dispatchForWorktree({
				type: "session/minimizeFloatingShell",
				worktreeId: worktree.id,
				processId,
			});
		},
		[worktree, dispatchForWorktree],
	);

	return {
		handleAddFloatingShell,
		handleCloseFloatingShell,
		handlePinFloatingShell,
		handleExpandFloatingShell,
		handleMinimizeFloatingShell,
	};
}
