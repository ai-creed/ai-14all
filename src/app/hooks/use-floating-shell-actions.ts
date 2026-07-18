import { useCallback, useState } from "react";
import type { MutableRefObject } from "react";
import type { ProcessSession } from "../../../shared/models/process-session";
import type { TerminalSession } from "../../../shared/models/terminal-session";
import type { Worktree } from "../../../shared/models/worktree";
import { clearReplayOutput } from "../../features/terminals/logic/replay-buffer";
import { notifyToast } from "../../features/ui/toast/ToastProvider";
import { commandSubmitKey } from "../../lib/command-submit-key";
import {
	MAX_FLOATING_SHELLS,
	type WorkspaceAction,
	type WorkspaceState,
} from "../../features/workspace/logic/workspace-state";
import { useSettings } from "./use-settings";

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
	/** From useProcessActions — spawns the PTY + builds the ProcessSession.
	 * When `command` is given it is recorded but NOT sent here. */
	spawnAdHocProcess: (opts?: {
		command?: string;
		label?: string;
	}) => Promise<ProcessSession | null>;
	stopSession: (sessionId: string) => Promise<void>;
	removeSession: (sessionId: string) => void;
	/** Subscribe to a terminal session's exit; returns an unsubscribe fn. */
	subscribeSessionExit: (
		sessionId: string,
		cb: (exitCode: number | null) => void,
	) => () => void;
	/** Submit a command to a session's PTY (called AFTER subscribing to exit). */
	sendInput: (sessionId: string, data: string) => Promise<void>;
};

export type UseFloatingShellActions = {
	handleAddFloatingShell: () => Promise<void>;
	handleCloseFloatingShell: (processId: string) => Promise<void>;
	pendingFloatingClose: { processId: string; label: string } | null;
	confirmPendingFloatingClose: (dontAskAgain: boolean) => void;
	cancelPendingFloatingClose: () => void;
	handlePinFloatingShell: (processId: string) => void;
	handleExpandFloatingShell: (processId: string) => void;
	handleMinimizeFloatingShell: (processId: string) => void;
	runCommandInFloatingShell: (
		command: string,
		opts: {
			label: string;
			onExit?: (exitCode: number | null) => void;
			autoCloseOnZero?: boolean;
		},
	) => Promise<void>;
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
		subscribeSessionExit,
		sendInput,
	} = options;

	const { settings, update } = useSettings();
	const [pendingFloatingClose, setPendingFloatingClose] = useState<{
		processId: string;
		label: string;
	} | null>(null);

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

	// Ungated teardown — the single place that actually stops the PTY and
	// dispatches the close. Programmatic cleanup (autoCloseOnZero) calls this
	// directly and must never see a confirmation dialog; user-facing Kill
	// surfaces go through the gated `handleCloseFloatingShell` below instead.
	const closeFloatingShellNow = useCallback(
		async (processId: string) => {
			if (!workspaceId || !worktree) return;
			const worktreeId = worktree.id;
			const process = workspaceStateRef.current.processSessionsById[processId];
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

	// User-facing gate (spec §5.4): both Kill surfaces (popover + minimized
	// pill) call this. Programmatic cleanup (autoCloseOnZero) calls
	// closeFloatingShellNow directly and must never see a dialog.
	const handleCloseFloatingShell = useCallback(
		async (processId: string) => {
			const process = workspaceStateRef.current.processSessionsById[processId];
			if (process?.status === "running" && settings.terminalConfirm.close) {
				setPendingFloatingClose({ processId, label: process.label });
				return;
			}
			await closeFloatingShellNow(processId);
		},
		[workspaceStateRef, settings.terminalConfirm.close, closeFloatingShellNow],
	);

	const confirmPendingFloatingClose = useCallback(
		(dontAskAgain: boolean) => {
			if (!pendingFloatingClose) return;
			if (dontAskAgain) void update({ terminalConfirm: { close: false } });
			void closeFloatingShellNow(pendingFloatingClose.processId);
			setPendingFloatingClose(null);
		},
		[pendingFloatingClose, update, closeFloatingShellNow],
	);

	const cancelPendingFloatingClose = useCallback(
		() => setPendingFloatingClose(null),
		[],
	);

	const runCommandInFloatingShell = useCallback(
		async (
			command: string,
			opts: {
				label: string;
				onExit?: (exitCode: number | null) => void;
				autoCloseOnZero?: boolean;
			},
		) => {
			if (!workspaceId || !worktree) return;
			const worktreeId = worktree.id;
			// Same pre-spawn cap as handleAddFloatingShell: no backend PTY at the cap.
			if (floatingCount(worktreeId) >= MAX_FLOATING_SHELLS) {
				notifyToast(`Maximum ${MAX_FLOATING_SHELLS} floating shells`);
				return;
			}
			const process = await spawnAdHocProcess({
				command,
				label: opts.label,
			});
			if (!process) return;
			if (floatingCount(worktreeId) >= MAX_FLOATING_SHELLS) {
				await teardownOrphan(process.terminalSessionId);
				return;
			}
			// spawnAdHocProcess always produces a terminalSessionId; guard for TS
			// before registering so an absent id aborts cleanly with nothing registered.
			const terminalSessionId = process.terminalSessionId;
			if (!terminalSessionId) return;
			const dispatch = createScopedWorkspaceDispatch(workspaceId);
			dispatch({
				type: "session/registerFloatingShell",
				worktreeId,
				process,
			});
			const after = getWorkspaceStateById(workspaceId);
			const accepted =
				after?.sessionsByWorktreeId[worktreeId]?.floatingShellIds.includes(
					process.id,
				) ?? false;
			if (!accepted) {
				await teardownOrphan(process.terminalSessionId);
				return;
			}
			// Auto-expand so the user watches the command run.
			dispatch({
				type: "session/expandFloatingShell",
				worktreeId,
				processId: process.id,
			});
			// Subscribe to exit BEFORE sending the command, so a command that exits
			// immediately cannot beat the listener (the old grid path subscribed then
			// sent, too). On exit: run the caller's hook (e.g. re-probe), then
			// auto-close on a clean exit, leaving a failed command lingering so the
			// error is readable.
			const off = subscribeSessionExit(terminalSessionId, (exitCode) => {
				off();
				opts.onExit?.(exitCode);
				if (opts.autoCloseOnZero && exitCode === 0) {
					void closeFloatingShellNow(process.id);
				}
			});
			// Now run the command — the exit listener is already installed.
			await sendInput(terminalSessionId, `${command}${commandSubmitKey()}`);
		},
		[
			workspaceId,
			worktree,
			floatingCount,
			spawnAdHocProcess,
			teardownOrphan,
			getWorkspaceStateById,
			createScopedWorkspaceDispatch,
			subscribeSessionExit,
			sendInput,
			closeFloatingShellNow,
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
		pendingFloatingClose,
		confirmPendingFloatingClose,
		cancelPendingFloatingClose,
		handlePinFloatingShell,
		handleExpandFloatingShell,
		handleMinimizeFloatingShell,
		runCommandInFloatingShell,
	};
}
