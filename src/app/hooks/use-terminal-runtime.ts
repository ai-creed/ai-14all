import { useCallback, useMemo, useRef } from "react";
import type { Dispatch, MutableRefObject } from "react";
import {
	workspaceReducer,
	isFloatingShell,
	type WorkspaceAction,
	type WorkspaceState,
} from "../../features/workspace/logic/workspace-state";
import type {
	AppWorkspacesState,
	AppWorkspacesAction,
} from "../../features/workspace/logic/app-workspaces-state";
import type { ProcessSession } from "../../../shared/models/process-session";
import {
	useTerminalSession,
	type UseTerminalSessionResult,
} from "../../features/terminals/hooks/use-terminal-session";
import { deriveAttentionState } from "../../features/terminals/logic/process-attention";
import { consumeOutputPreview } from "../../features/terminals/logic/output-preview";
import {
	recordReplayOutput,
	clearReplayOutput,
} from "../../features/terminals/logic/replay-buffer";
import { logRendererShellEvent } from "../../features/terminals/logic/shell-event-logger";
import { classifyOutput } from "../../features/terminals/logic/agent-attention";
import { diagnostics } from "../../lib/desktop-client";
import type { AgentAttentionReason } from "../../../shared/models/agent-attention";

type Options = {
	appWorkspacesRef: MutableRefObject<AppWorkspacesState>;
	inactiveWorkspaceStatesRef: MutableRefObject<Map<string, WorkspaceState>>;
	dispatch: (action: WorkspaceAction) => void;
	dispatchAppWorkspaces: Dispatch<AppWorkspacesAction>;
	getVisibleProcessIds: () => readonly string[];
	getActiveWorktreeId: () => string | null | undefined;
};

/**
 * Owns the terminal session runtime: subscribes to PTY output/exit/error
 * events, routes them to the owning workspace's reducer (active or inactive),
 * tracks an in-memory output preview buffer, and emits binding-change logs
 * for diagnostics.
 *
 * The handlers read shared refs at call time so burst events from background
 * workspaces accumulate correctly without waiting for React re-renders.
 */
export type UseTerminalRuntime = UseTerminalSessionResult & {
	findProcessByTerminalSessionId: (
		terminalSessionId: string,
	) => { process: ProcessSession; workspaceId: string } | null;
};

export function useTerminalRuntime(options: Options): UseTerminalRuntime {
	const {
		appWorkspacesRef,
		inactiveWorkspaceStatesRef,
		dispatch,
		dispatchAppWorkspaces,
		getVisibleProcessIds,
		getActiveWorktreeId,
	} = options;

	const outputPreviewBuffersRef = useRef<Map<string, string>>(new Map());
	// Tracks the last classified agent reason per terminal session ID synchronously,
	// so onExit can read it without depending on React dispatch having flushed.
	const lastAgentReasonBySessionRef = useRef<Map<string, AgentAttentionReason>>(
		new Map(),
	);

	const findProcessByTerminalSessionId = useCallback(
		(
			terminalSessionId: string,
		): { process: ProcessSession; workspaceId: string } | null => {
			for (const ws of Object.values(appWorkspacesRef.current.workspacesById)) {
				if (!ws.workspaceState) continue;
				const process = Object.values(
					ws.workspaceState.processSessionsById,
				).find((p) => p.terminalSessionId === terminalSessionId);
				if (process) return { process, workspaceId: ws.workspaceId };
			}
			return null;
		},
		[appWorkspacesRef],
	);

	const applyActionForOwner = useCallback(
		(ownerWsId: string, action: WorkspaceAction) => {
			if (ownerWsId === appWorkspacesRef.current.activeWorkspaceId) {
				dispatch(action);
				return;
			}
			// Route to the inactive workspace. Read from the per-workspace shadow
			// map first so rapid burst events accumulate correctly instead of both
			// reads seeing the same pre-render snapshot.
			const baseState =
				inactiveWorkspaceStatesRef.current.get(ownerWsId) ??
				appWorkspacesRef.current.workspacesById[ownerWsId]?.workspaceState;
			if (!baseState) return;
			const nextState = workspaceReducer(baseState, action);
			inactiveWorkspaceStatesRef.current.set(ownerWsId, nextState);
			dispatchAppWorkspaces({
				type: "workspace/updateWorkspaceState",
				workspaceId: ownerWsId,
				workspaceState: nextState,
			});
		},
		[
			appWorkspacesRef,
			inactiveWorkspaceStatesRef,
			dispatch,
			dispatchAppWorkspaces,
		],
	);

	const handlers = useMemo(
		() => ({
			onOutput: (event: { sessionId: string; data: string }) => {
				const found = findProcessByTerminalSessionId(event.sessionId);
				if (!found) return;
				// Buffer raw output so a pane remounted later (e.g. after switching
				// the selected worktree-session away and back) can replay it into
				// its fresh xterm instead of rendering blank.
				recordReplayOutput(event.sessionId, event.data);
				const priorBuffer =
					outputPreviewBuffersRef.current.get(event.sessionId) ?? "";
				const previewUpdate = consumeOutputPreview(priorBuffer, event.data);
				if (previewUpdate.nextBuffer) {
					outputPreviewBuffersRef.current.set(
						event.sessionId,
						previewUpdate.nextBuffer,
					);
				} else {
					outputPreviewBuffersRef.current.delete(event.sessionId);
				}
				const { process, workspaceId: ownerWsId } = found;
				// Self-reporting mode (spec §5): once this worktree's agent reports
				// over MCP, terminal heuristics for AGENT processes are noise — skip
				// the classifier (and its telemetry) entirely and record plain
				// activity. Plain shells in the same worktree keep their legacy
				// error/failed patterns: the agent vouches for itself, not for
				// neighboring build/test shells.
				const ownerSession =
					appWorkspacesRef.current.workspacesById[ownerWsId]?.workspaceState
						?.sessionsByWorktreeId[process.worktreeId] ?? null;
				const selfReporting =
					process.agentDetected === true &&
					ownerSession?.mcpReportingActive === true;
				const now = Date.now();
				let agentReason: AgentAttentionReason | null = null;
				if (process.agentDetected && !selfReporting) {
					const classified = classifyOutput(event.data, {
						// Fires only on a non-active actionable verdict (the
						// classifier throttles); one-way fire-and-forget IPC.
						emit: (verdict) =>
							diagnostics.logAttentionEvent({
								type: "classifier",
								ts: now,
								worktreeId: process.worktreeId,
								processId: process.id,
								provider: process.provider ?? null,
								state: verdict.state,
								matchedPattern: verdict.matchedPattern,
								inputSample: verdict.inputSample,
								// `inputPrev` = up to 200 chars of output that
								// preceded the matched chunk, for post-hoc
								// analysis of classifier false positives. The
								// pure classifier has no buffer so it hardcodes
								// ""; this callsite owns the real preceding
								// context. `priorBuffer` is the session's
								// rolling output buffer read BEFORE
								// `event.data` was incorporated, so it cleanly
								// excludes the current chunk (no overlap).
								inputPrev: priorBuffer.slice(-200),
							}),
					});
					if (classified !== null) {
						agentReason = {
							state: classified,
							source: "terminal",
							summary: previewUpdate.preview ?? classified,
							nextAction: null,
							reportedAt: now,
						};
						lastAgentReasonBySessionRef.current.set(
							event.sessionId,
							agentReason,
						);
					}
				}
				const action: WorkspaceAction = {
					type: "session/recordProcessOutput",
					worktreeId: process.worktreeId,
					processId: process.id,
					attentionState: selfReporting
						? "activity"
						: deriveAttentionState(event.data),
					at: now,
					isViewed:
						getVisibleProcessIds().includes(process.id) &&
						process.worktreeId === getActiveWorktreeId(),
					lastOutputPreview: previewUpdate.preview,
					agentReason,
				};
				applyActionForOwner(ownerWsId, action);
			},
			onExit: (event: { sessionId: string; exitCode: number | null }) => {
				const found = findProcessByTerminalSessionId(event.sessionId);
				if (!found) return;
				outputPreviewBuffersRef.current.delete(event.sessionId);
				// Floating throwaway shells linger after exit (spec §5.4): retain the
				// replay buffer so a minimized or worktree-switched popover remounted
				// after exit still shows final output. Freed on dismissal
				// (handleCloseFloatingShell → clearReplayOutput). Slotted shells keep
				// the existing clear-on-exit behavior.
				const ownerState =
					appWorkspacesRef.current.workspacesById[found.workspaceId]
						?.workspaceState ?? null;
				const isFloating =
					ownerState !== null &&
					isFloatingShell(
						ownerState,
						found.process.worktreeId,
						found.process.id,
					);
				if (!isFloating) clearReplayOutput(event.sessionId);
				const lastAgentReason =
					lastAgentReasonBySessionRef.current.get(event.sessionId) ?? null;
				lastAgentReasonBySessionRef.current.delete(event.sessionId);
				const { process, workspaceId: ownerWsId } = found;
				const action: WorkspaceAction = {
					type: "session/updateProcessStatus",
					processId: process.id,
					status: "exited",
					exitCode: event.exitCode ?? null,
					at: Date.now(),
					// Pin the exit to its originating session. `findProcessByTerminalSessionId`
					// resolves ownership from a ref that can lag a concurrent restart's
					// rebind, so `process` may already point at a NEW session. The reducer
					// drops this action when the process's current terminalSessionId no
					// longer matches, keeping the restarted shell "running" (restart race).
					onlyIfTerminalSessionId: event.sessionId,
				};
				applyActionForOwner(ownerWsId, action);
				// `process` is a snapshot captured before applyActionForOwner ran,
				// so agentDetected here still reflects the pre-exit state. The
				// reducer resets agentDetected on the status transition, but the
				// lifecycle reason emitted below is keyed off pre-exit detection.
				if (process.agentDetected) {
					if (event.exitCode != null && event.exitCode !== 0) {
						const lifecycleAction: WorkspaceAction = {
							type: "session/reportProcessAgentAttention",
							worktreeId: process.worktreeId,
							processId: process.id,
							reason: {
								state: "failed",
								source: "lifecycle",
								summary: `exited with code ${event.exitCode}`,
								nextAction: null,
								reportedAt: Date.now(),
							},
						};
						applyActionForOwner(ownerWsId, lifecycleAction);
					} else if (
						event.exitCode === 0 &&
						lastAgentReason?.state === "ready"
					) {
						// Promote terminal ready to lifecycle so it persists after exit.
						// Uses lastAgentReasonBySessionRef (set synchronously in onOutput) to
						// avoid the race where React dispatch hasn't flushed appWorkspacesRef yet.
						const lifecycleAction: WorkspaceAction = {
							type: "session/reportProcessAgentAttention",
							worktreeId: process.worktreeId,
							processId: process.id,
							reason: {
								state: "ready",
								source: "lifecycle",
								summary: lastAgentReason.summary,
								nextAction: null,
								reportedAt: Date.now(),
							},
						};
						applyActionForOwner(ownerWsId, lifecycleAction);
					}
				}
				void logRendererShellEvent({
					event: "terminal-binding-changed",
					windowId: null,
					triggerEventId: null,
					reasonKind: "process_exit",
					reason: "pty_exit",
					isExpected: false,
					expectedBecause: null,
					data: {
						previousBinding: {
							terminalSessionId: event.sessionId,
							processId: process.id,
							workspaceId: ownerWsId,
						},
						nextBinding: null,
					},
				});
			},
			onError: (event: { sessionId: string }) => {
				const found = findProcessByTerminalSessionId(event.sessionId);
				if (!found) return;
				outputPreviewBuffersRef.current.delete(event.sessionId);
				// Mirror onExit: floating shells retain the replay buffer so a
				// minimized/switched popover can still show final output after error.
				const ownerState =
					appWorkspacesRef.current.workspacesById[found.workspaceId]
						?.workspaceState ?? null;
				const isFloating =
					ownerState !== null &&
					isFloatingShell(
						ownerState,
						found.process.worktreeId,
						found.process.id,
					);
				if (!isFloating) clearReplayOutput(event.sessionId);
				lastAgentReasonBySessionRef.current.delete(event.sessionId);
				const { process, workspaceId: ownerWsId } = found;
				const action: WorkspaceAction = {
					type: "session/updateProcessStatus",
					processId: process.id,
					status: "error",
					exitCode: null,
					at: Date.now(),
					// Pin the error to its originating session, mirroring the exit guard (onExit).
					// `findProcessByTerminalSessionId` resolves ownership from a ref that can lag
					// a concurrent restart's rebind, so stale error events for a restarted-away
					// session must be dropped to keep the rebound process "running" and not
					// bypass the terminal confirm gate (restart race, stale-event twin of exit).
					onlyIfTerminalSessionId: event.sessionId,
				};
				applyActionForOwner(ownerWsId, action);
				if (process.agentDetected) {
					const lifecycleAction: WorkspaceAction = {
						type: "session/reportProcessAgentAttention",
						worktreeId: process.worktreeId,
						processId: process.id,
						reason: {
							state: "failed",
							source: "lifecycle",
							summary: "terminal error",
							nextAction: null,
							reportedAt: Date.now(),
						},
					};
					applyActionForOwner(ownerWsId, lifecycleAction);
				}
			},
		}),
		[
			appWorkspacesRef,
			findProcessByTerminalSessionId,
			applyActionForOwner,
			getVisibleProcessIds,
			getActiveWorktreeId,
		],
	);

	const session = useTerminalSession(handlers);
	return {
		...session,
		findProcessByTerminalSessionId,
	};
}
