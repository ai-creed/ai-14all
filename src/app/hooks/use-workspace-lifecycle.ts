import { useCallback } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type {
	PersistedSavedWorkspace,
	PersistedWorkspaceStateV2,
	PersistedWorktreeSession,
	RestorePreference,
	WorkspaceSnapshot,
} from "../../../shared/models/persisted-workspace-state";
import type { TerminalSession } from "../../../shared/models/terminal-session";
import type { Worktree } from "../../../shared/models/worktree";
import {
	repository as repositoryClient,
	reviewComments,
	terminals,
	workspace,
} from "../../lib/desktop-client";
import {
	buildWorktreeIdRebaseMapping,
	rebaseSnapshotPaths,
	reconcileSnapshotToWorktrees,
	shouldReattachSnapshot,
	splitPendingRestores,
} from "../../features/workspace/logic/workspace-persistence";
import {
	createWorkspaceState,
	workspaceReducer,
	type WorkspaceAction,
	type WorkspaceState,
} from "../../features/workspace/logic/workspace-state";
import type {
	AppWorkspacesAction,
	AppWorkspacesState,
} from "../../features/workspace/logic/app-workspaces-state";
import { commandSubmitKey } from "../../lib/command-submit-key";
import { describeRepositoryLoadError } from "../../features/repository/describe-repository-load-error";
import { logRendererShellEvent } from "../../features/terminals/logic/shell-event-logger";
import { logBindingChange } from "../logging/log-binding-change";

type StartupMode = "loading" | "prompt" | "ready";

type ActivationResult = {
	workspaceId: string;
	worktrees: Worktree[];
	workspaceState: WorkspaceState;
};

type Options = {
	// Workspace registry + shadow refs
	appWorkspaces: AppWorkspacesState;
	appWorkspacesRef: MutableRefObject<AppWorkspacesState>;
	prevActiveWorkspaceIdRef: MutableRefObject<string | null>;
	activeWorkspaceStateRef: MutableRefObject<WorkspaceState>;
	dispatchAppWorkspaces: (action: AppWorkspacesAction) => void;
	dispatch: (action: WorkspaceAction) => void;

	// Saved-snapshot / restore state
	savedSnapshot: WorkspaceSnapshot | null;
	savedDormantWorkspaces: PersistedSavedWorkspace[];
	setSavedSnapshot: Dispatch<SetStateAction<WorkspaceSnapshot | null>>;
	setRestorePreference: Dispatch<SetStateAction<RestorePreference>>;
	setPendingRestoreSessions: Dispatch<
		SetStateAction<Record<string, PersistedWorktreeSession>>
	>;
	// Settings-store write-through (Task 4): called whenever the user makes a
	// new restore-preference decision, alongside the existing legacy
	// workspace-state write, so the settings store stays authoritative for the
	// next launch's `useStartupRestore`.
	persistRestorePreference: (preference: RestorePreference) => void;

	// Misc UI state setters
	setStartupMode: Dispatch<SetStateAction<StartupMode>>;
	setStartupError: Dispatch<SetStateAction<string | null>>;
	setError: Dispatch<SetStateAction<string | null>>;
	setRestoreWarning: Dispatch<SetStateAction<string | null>>;
	setWorkspacePickerOpen: Dispatch<SetStateAction<boolean>>;

	// Terminal-runtime hooks (from useTerminalRuntime)
	createSession: (
		workspaceId: string,
		worktreeId: string,
		worktreePath: string,
	) => Promise<TerminalSession>;
	sendInput: (terminalSessionId: string, data: string) => Promise<void>;
	adoptSession: (session: TerminalSession) => void;

	// Default-shell housekeeping (from useDefaultShellOnEmptyWorktree)
	resetDefaultShellEnsured: () => void;
};

export type UseWorkspaceLifecycle = {
	activateWorkspace: (workspaceId: string) => Promise<ActivationResult | null>;
	handleLoadPath: (path: string) => Promise<void>;
	restoreWorkspace: (
		snapshot: WorkspaceSnapshot,
		nextPreference: RestorePreference,
		dormantWorkspaces?: PersistedSavedWorkspace[],
	) => Promise<void>;
	handleRestoreDecision: (input: {
		shouldRestore: boolean;
		rememberChoice: boolean;
	}) => Promise<void>;
	recreatePersistedProcesses: (
		worktree: Worktree,
		sessionSnapshot: PersistedWorktreeSession,
		targetWorkspaceId: string,
		dispatchFn?: (action: WorkspaceAction) => void,
	) => Promise<void>;
};

/**
 * Bundle of workspace-level lifecycle handlers: activate (hydrate dormant),
 * load a brand-new repository, restore from snapshot, drive the post-prompt
 * decision, and recreate persisted process sessions inside a worktree.
 *
 * These functions all share refs into the workspace registry and call into
 * terminal-runtime + default-shell hooks, which is why they are colocated
 * here rather than spread across multiple smaller hooks.
 */
export function useWorkspaceLifecycle(options: Options): UseWorkspaceLifecycle {
	const {
		appWorkspaces,
		appWorkspacesRef,
		prevActiveWorkspaceIdRef,
		activeWorkspaceStateRef,
		dispatchAppWorkspaces,
		dispatch,
		savedSnapshot,
		savedDormantWorkspaces,
		setSavedSnapshot,
		setRestorePreference,
		setPendingRestoreSessions,
		persistRestorePreference,
		setStartupMode,
		setStartupError,
		setError,
		setRestoreWarning,
		setWorkspacePickerOpen,
		createSession,
		sendInput,
		adoptSession,
		resetDefaultShellEnsured,
	} = options;

	const recreatePersistedProcesses = useCallback(
		async (
			worktree: Worktree,
			sessionSnapshot: PersistedWorktreeSession,
			targetWorkspaceId: string,
			dispatchFn: (action: WorkspaceAction) => void = dispatch,
		) => {
			let liveSessions: Map<string, TerminalSession> = new Map();
			try {
				void logRendererShellEvent({
					event: "renderer-reconnect-list-start",
					windowId: null,
					data: { targetWorkspaceId },
				});
				const list = await terminals.list(targetWorkspaceId);
				liveSessions = new Map(list.map((session) => [session.id, session]));
				void logRendererShellEvent({
					event: "renderer-reconnect-list-success",
					windowId: null,
					data: {
						targetWorkspaceId,
						liveBackendSessionIds: list.map((s) => s.id),
					},
				});
			} catch {
				// Fall back to fresh creation when the backend cannot enumerate sessions.
			}

			for (const process of sessionSnapshot.processSessions) {
				try {
					const liveSession = process.terminalSessionId
						? liveSessions.get(process.terminalSessionId)
						: undefined;

					if (liveSession) {
						void logRendererShellEvent({
							event: "renderer-reconnect-adopt",
							windowId: null,
							reasonKind: "system_reconnect",
							reason: "renderer_reload",
							data: {
								terminalSessionId: liveSession.id,
								processId: process.id,
							},
						});
						void logBindingChange({
							reasonKind: "system_reconnect",
							reason: "renderer_reload",
							isExpected: true,
							expectedBecause: "renderer_reload_reconnect",
							previousBinding: null,
							nextBinding: {
								terminalSessionId: liveSession.id,
								processId: process.id,
								targetWorkspaceId,
							},
						});
						adoptSession(liveSession);
						dispatchFn({
							type: "session/replaceProcessTerminal",
							processId: process.id,
							terminalSessionId: liveSession.id,
						});
						const processStatus =
							liveSession.status === "error"
								? "error"
								: liveSession.status === "exited"
									? "exited"
									: "running";
						// `at` intentionally omitted: reducer falls back to lastActivityAt.
						// Passing Date.now() here would over-retire reasons from the disconnect gap.
						dispatchFn({
							type: "session/updateProcessStatus",
							processId: process.id,
							status: processStatus,
							exitCode: liveSession.exitCode,
						});
					} else {
						void logRendererShellEvent({
							event: "renderer-reconnect-fallback-create",
							windowId: null,
							reasonKind: "system_reconnect",
							reason: "renderer_reload",
							data: { processId: process.id, worktreeId: worktree.id },
						});
						const terminal = await createSession(
							targetWorkspaceId,
							worktree.id,
							worktree.path,
						);
						dispatchFn({
							type: "session/replaceProcessTerminal",
							processId: process.id,
							terminalSessionId: terminal.id,
						});
						dispatchFn({
							type: "session/updateProcessStatus",
							processId: process.id,
							status: "running",
							exitCode: null,
						});

						if (process.command) {
							// `\r` on Windows, `\n` elsewhere — see commandSubmitKey.
							await sendInput(
								terminal.id,
								`${process.command}${commandSubmitKey()}`,
							);
						}
					}
				} catch {
					// `at` intentionally omitted: reducer falls back to lastActivityAt.
					// Passing Date.now() here would over-retire reasons from the disconnect gap.
					dispatchFn({
						type: "session/updateProcessStatus",
						processId: process.id,
						status: "error",
						exitCode: null,
					});
				}
			}
		},
		[dispatch, adoptSession, createSession, sendInput],
	);

	const activateWorkspace = useCallback(
		async (workspaceId: string): Promise<ActivationResult | null> => {
			const target = appWorkspacesRef.current.workspacesById[workspaceId];
			if (!target) return null;

			if (target.workspaceState) {
				prevActiveWorkspaceIdRef.current = workspaceId;
				activeWorkspaceStateRef.current = target.workspaceState;
				dispatchAppWorkspaces({ type: "workspace/select", workspaceId });
				return {
					workspaceId,
					worktrees: target.worktrees,
					workspaceState: target.workspaceState,
				};
			}

			// Dormant — hydrate it
			const { workspaceId: openedId, repository } =
				await workspace.openRepository(target.repository.rootPath);
			const newWorktrees = await repositoryClient.listWorktrees(openedId);

			const snapshot = target.persistedSnapshot?.snapshot;
			let nextWorkspaceState = createWorkspaceState(newWorktrees);
			let reconciledSnapshot: WorkspaceSnapshot | null = null;
			if (snapshot) {
				const rebasedSnapshot = rebaseSnapshotPaths(
					snapshot,
					snapshot.repositoryPath,
					repository.rootPath,
				);
				reconciledSnapshot = reconcileSnapshotToWorktrees(
					rebasedSnapshot,
					snapshot,
					newWorktrees,
				);
				nextWorkspaceState = workspaceReducer(
					createWorkspaceState(newWorktrees),
					{
						type: "workspace/restoreSnapshot",
						worktrees: newWorktrees,
						snapshot: reconciledSnapshot,
						workspaceId: openedId,
					},
				);
				const rebaseMapping = buildWorktreeIdRebaseMapping(
					snapshot,
					snapshot.repositoryPath,
					repository.rootPath,
				);
				if (Object.keys(rebaseMapping).length > 0) {
					try {
						await reviewComments.rebaseWorktreeIds(rebaseMapping);
					} catch (err) {
						console.warn("[review] rebase IPC failed", err);
					}
				}
			}

			dispatchAppWorkspaces({
				type: "workspace/register",
				workspace: {
					workspaceId: openedId,
					repository,
					worktrees: newWorktrees,
					workspaceState: nextWorkspaceState,
					persistedSnapshot: target.persistedSnapshot,
					hydrationState: "active",
					loadError: null,
				},
			});
			dispatchAppWorkspaces({
				type: "workspace/select",
				workspaceId: openedId,
			});
			if (openedId !== workspaceId) {
				dispatchAppWorkspaces({ type: "workspace/remove", workspaceId });
			}

			// Prime the shadow ref so async dispatch calls during recreatePersistedProcesses
			// see the correct initial state rather than a stale pre-render snapshot.
			prevActiveWorkspaceIdRef.current = openedId;
			activeWorkspaceStateRef.current = nextWorkspaceState;

			if (reconciledSnapshot) {
				const { selectedSession, pendingByWorktreeId } =
					splitPendingRestores(reconciledSnapshot);
				setPendingRestoreSessions(pendingByWorktreeId);
				setSavedSnapshot(reconciledSnapshot);
				const selectedWorktree = reconciledSnapshot.selectedWorktreeId
					? (newWorktrees.find(
							(wt) => wt.id === reconciledSnapshot!.selectedWorktreeId,
						) ?? null)
					: null;
				if (selectedWorktree && selectedSession) {
					// Build a scoped dispatch pinned to openedId. If the user switches
					// workspace before recreatePersistedProcesses finishes, the global
					// dispatch() would follow prevActiveWorkspaceIdRef.current (now pointing
					// at the new active workspace). The scoped dispatch bypasses that ref so
					// late loop iterations still write to the workspace being hydrated.
					const capturedId = openedId;
					const localShadow = { current: nextWorkspaceState };
					const scopedDispatch = (action: WorkspaceAction) => {
						localShadow.current = workspaceReducer(localShadow.current, action);
						dispatchAppWorkspaces({
							type: "workspace/updateWorkspaceState",
							workspaceId: capturedId,
							workspaceState: localShadow.current,
						});
					};
					await recreatePersistedProcesses(
						selectedWorktree,
						selectedSession,
						openedId,
						scopedDispatch,
					);
				}
			}

			return {
				workspaceId: openedId,
				worktrees: newWorktrees,
				workspaceState: nextWorkspaceState,
			};
		},
		[
			appWorkspacesRef,
			prevActiveWorkspaceIdRef,
			activeWorkspaceStateRef,
			dispatchAppWorkspaces,
			setPendingRestoreSessions,
			setSavedSnapshot,
			recreatePersistedProcesses,
		],
	);

	const handleLoadPath = useCallback(
		async (path: string) => {
			const { workspaceId: newWorkspaceId, repository: newRepo } =
				await workspace.openRepository(path);

			// If the same workspace is already active, just close the picker without
			// re-loading — preserve all in-progress session state.
			if (
				newWorkspaceId === appWorkspaces.activeWorkspaceId &&
				appWorkspaces.workspacesById[newWorkspaceId]
			) {
				setWorkspacePickerOpen(false);
				setError(null);
				setStartupError(null);
				return;
			}

			const newWorktrees = await repositoryClient.listWorktrees(newWorkspaceId);

			if (shouldReattachSnapshot(newRepo, savedSnapshot)) {
				const originalSnapshot = savedSnapshot!;
				const rebasedSnapshot = rebaseSnapshotPaths(
					originalSnapshot,
					originalSnapshot.repositoryPath,
					newRepo.rootPath,
				);
				const nextSnapshot: WorkspaceSnapshot = {
					...reconcileSnapshotToWorktrees(
						rebasedSnapshot,
						originalSnapshot,
						newWorktrees,
					),
					repositoryPath: newRepo.rootPath,
					repoId: newRepo.repoId,
				};

				const rebaseMapping = buildWorktreeIdRebaseMapping(
					originalSnapshot,
					originalSnapshot.repositoryPath,
					newRepo.rootPath,
				);
				if (Object.keys(rebaseMapping).length > 0) {
					try {
						await reviewComments.rebaseWorktreeIds(rebaseMapping);
					} catch (err) {
						console.warn("[review] rebase IPC failed", err);
					}
				}

				const initialState = createWorkspaceState(newWorktrees);
				const stateWithSnapshot = workspaceReducer(initialState, {
					type: "workspace/restoreSnapshot",
					worktrees: newWorktrees,
					snapshot: nextSnapshot,
					workspaceId: newWorkspaceId,
				});

				dispatchAppWorkspaces({
					type: "workspace/register",
					workspace: {
						workspaceId: newWorkspaceId,
						repository: newRepo,
						worktrees: newWorktrees,
						workspaceState: stateWithSnapshot,
						persistedSnapshot: null,
						hydrationState: "active",
						loadError: null,
					},
				});
				dispatchAppWorkspaces({
					type: "workspace/select",
					workspaceId: newWorkspaceId,
				});

				// Prime the shadow ref so async dispatch calls during recreatePersistedProcesses
				// see the correct initial state rather than a stale pre-render snapshot.
				prevActiveWorkspaceIdRef.current = newWorkspaceId;
				activeWorkspaceStateRef.current = stateWithSnapshot;

				const { selectedSession, pendingByWorktreeId } =
					splitPendingRestores(nextSnapshot);
				setPendingRestoreSessions(pendingByWorktreeId);
				setSavedSnapshot(nextSnapshot);

				const selectedWorktree = newWorktrees.find(
					(w) => w.id === nextSnapshot.selectedWorktreeId,
				);
				const degradedNote = !newRepo.repoId
					? " Repository identity could not be verified — future recovery will rely on folder name matching."
					: "";
				if (selectedWorktree && selectedSession) {
					await recreatePersistedProcesses(
						selectedWorktree,
						selectedSession,
						newWorkspaceId,
					);
					setRestoreWarning(
						`Recovered your previous workspace after the repository path changed.${degradedNote}`,
					);
				} else if (nextSnapshot.selectedWorktreeId && !selectedWorktree) {
					setRestoreWarning(
						`Recovered the previous workspace, but the selected worktree is no longer available.${degradedNote}`,
					);
					if (selectedSession) {
						setPendingRestoreSessions((prev) => ({
							...prev,
							[selectedSession.worktreeId]: selectedSession,
						}));
					}
				}
				setError(null);
				setStartupError(null);
				setWorkspacePickerOpen(false);
				return;
			}

			// Normal load (no reattachment)
			const existing = appWorkspaces.workspacesById[newWorkspaceId];
			const initialState =
				existing?.workspaceState ?? createWorkspaceState(newWorktrees);
			const freshState = workspaceReducer(initialState, {
				type: "workspace/loadWorktrees",
				worktrees: newWorktrees,
			});

			dispatchAppWorkspaces({
				type: "workspace/register",
				workspace: {
					workspaceId: newWorkspaceId,
					repository: newRepo,
					worktrees: newWorktrees,
					workspaceState: freshState,
					persistedSnapshot: existing?.persistedSnapshot ?? null,
					hydrationState: "active",
					loadError: null,
				},
			});
			dispatchAppWorkspaces({
				type: "workspace/select",
				workspaceId: newWorkspaceId,
			});

			prevActiveWorkspaceIdRef.current = newWorkspaceId;
			activeWorkspaceStateRef.current = freshState;

			resetDefaultShellEnsured();
			setPendingRestoreSessions({});
			setError(null);
			setStartupError(null);
			setRestoreWarning(null);
			setWorkspacePickerOpen(false);
		},
		[
			appWorkspaces,
			savedSnapshot,
			prevActiveWorkspaceIdRef,
			activeWorkspaceStateRef,
			dispatchAppWorkspaces,
			setPendingRestoreSessions,
			setSavedSnapshot,
			setError,
			setStartupError,
			setRestoreWarning,
			setWorkspacePickerOpen,
			recreatePersistedProcesses,
			resetDefaultShellEnsured,
		],
	);

	const restoreWorkspace = useCallback(
		async (
			snapshot: WorkspaceSnapshot,
			nextPreference: RestorePreference,
			dormantWorkspaces: PersistedSavedWorkspace[] = [],
		) => {
			try {
				const { workspaceId: restoredWorkspaceId, repository: restoredRepo } =
					await workspace.openRepository(snapshot.repositoryPath);
				const wts = await repositoryClient.listWorktrees(restoredWorkspaceId);

				const initialState = createWorkspaceState(wts);
				const stateWithSnapshot = workspaceReducer(initialState, {
					type: "workspace/restoreSnapshot",
					worktrees: wts,
					snapshot,
					workspaceId: restoredWorkspaceId,
				});

				dispatchAppWorkspaces({
					type: "workspace/register",
					workspace: {
						workspaceId: restoredWorkspaceId,
						repository: restoredRepo,
						worktrees: wts,
						workspaceState: stateWithSnapshot,
						persistedSnapshot: null,
						hydrationState: "active",
						loadError: null,
					},
				});
				dispatchAppWorkspaces({
					type: "workspace/select",
					workspaceId: restoredWorkspaceId,
				});

				prevActiveWorkspaceIdRef.current = restoredWorkspaceId;
				activeWorkspaceStateRef.current = stateWithSnapshot;

				// Register non-active saved workspaces as dormant so they appear in the
				// grouped sessions sidebar immediately after restore, without re-opening them.
				for (const saved of dormantWorkspaces) {
					dispatchAppWorkspaces({
						type: "workspace/register",
						workspace: {
							workspaceId: saved.workspaceId,
							repository: {
								id: saved.workspaceId,
								name:
									saved.repositoryPath.split("/").filter(Boolean).at(-1) ??
									saved.repositoryPath,
								rootPath: saved.repositoryPath,
								repoId: saved.repoId ?? null,
							},
							worktrees: [],
							workspaceState: null,
							persistedSnapshot: saved,
							hydrationState: "dormant",
							loadError: null,
						},
					});
				}

				const { selectedSession, pendingByWorktreeId } =
					splitPendingRestores(snapshot);
				setPendingRestoreSessions(pendingByWorktreeId);
				setRestorePreference(nextPreference);
				setSavedSnapshot(snapshot);
				setStartupMode("ready");
				setStartupError(null);

				const selectedWorktree = wts.find(
					(worktree) => worktree.id === (snapshot.selectedWorktreeId ?? ""),
				);
				if (selectedWorktree && selectedSession) {
					await recreatePersistedProcesses(
						selectedWorktree,
						selectedSession,
						restoredWorkspaceId,
					);
				} else if (snapshot.selectedWorktreeId && !selectedWorktree) {
					setRestoreWarning(
						"Previously selected worktree is no longer available. Opened the first available session instead.",
					);
					// Keep the saved session in pending so the next persist write
					// re-serialises it. Without this the session is permanently lost
					// after the first write because buildWorkspaceSnapshot only reads
					// from workspaceState, which has no entry for a missing worktree.
					if (selectedSession) {
						setPendingRestoreSessions((prev) => ({
							...prev,
							[selectedSession.worktreeId]: selectedSession,
						}));
					}
				}
			} catch (err) {
				const reason = describeRepositoryLoadError(err);
				setStartupError(
					`Could not reopen the previous workspace from its saved path. ${reason} Pick a repository to continue.`,
				);
				// Preserve the snapshot so the user can manually reopen after path changes.
				// Reset to "prompt" so alwaysRestore doesn't loop on a broken path.
				setRestorePreference("prompt");
				setSavedSnapshot(snapshot);
				const fallbackState: PersistedWorkspaceStateV2 = {
					version: 2,
					restorePreference: "prompt",
					activeWorkspaceId: null,
					workspaceOrder: [],
					workspaces: snapshot
						? [
								{
									workspaceId: "fallback",
									repositoryPath: snapshot.repositoryPath,
									repoId: snapshot.repoId ?? null,
									snapshot,
								},
							]
						: [],
				};
				void workspace.writeRestoreState(fallbackState);
				setStartupMode("ready");
			}
		},
		[
			prevActiveWorkspaceIdRef,
			activeWorkspaceStateRef,
			dispatchAppWorkspaces,
			setPendingRestoreSessions,
			setRestorePreference,
			setSavedSnapshot,
			setStartupMode,
			setStartupError,
			setRestoreWarning,
			recreatePersistedProcesses,
		],
	);

	const handleRestoreDecision = useCallback(
		async (input: { shouldRestore: boolean; rememberChoice: boolean }) => {
			const { shouldRestore, rememberChoice } = input;
			const nextPreference: RestorePreference = rememberChoice
				? shouldRestore
					? "alwaysRestore"
					: "alwaysStartClean"
				: "prompt";
			// Settings-store write-through: persist regardless of which branch
			// below runs, so "restore & remember" (alwaysRestore) is honored on
			// the next launch too, not just "don't restore & remember".
			persistRestorePreference(nextPreference);

			if (!shouldRestore) {
				// Preserve the snapshot so the user can restore it on a future launch
				// if they change their preference back to "prompt" or "alwaysRestore".
				setRestorePreference(nextPreference);
				const nextState: PersistedWorkspaceStateV2 = {
					version: 2,
					restorePreference: nextPreference,
					activeWorkspaceId: null,
					workspaceOrder: savedSnapshot ? ["fallback"] : [],
					workspaces: savedSnapshot
						? [
								{
									workspaceId: "fallback",
									repositoryPath: savedSnapshot.repositoryPath,
									repoId: savedSnapshot.repoId ?? null,
									snapshot: savedSnapshot,
								},
							]
						: [],
				};
				await workspace.writeRestoreState(nextState);
				setStartupMode("ready");
				return;
			}

			if (savedSnapshot) {
				await restoreWorkspace(
					savedSnapshot,
					nextPreference,
					savedDormantWorkspaces,
				);
			}
		},
		[
			savedSnapshot,
			savedDormantWorkspaces,
			setRestorePreference,
			persistRestorePreference,
			setStartupMode,
			restoreWorkspace,
		],
	);

	return {
		activateWorkspace,
		handleLoadPath,
		restoreWorkspace,
		handleRestoreDecision,
		recreatePersistedProcesses,
	};
}
