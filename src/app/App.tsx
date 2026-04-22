import {
	useCallback,
	useEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
	type MouseEvent as ReactMouseEvent,
} from "react";
import * as ScrollArea from "@radix-ui/react-scroll-area";
import * as Tabs from "@radix-ui/react-tabs";
import type { Worktree } from "../../shared/models/worktree";
import type { GitDiff } from "../../shared/models/git-diff";
import type { ProcessSession } from "../../shared/models/process-session";
import type { TerminalSession } from "../../shared/models/terminal-session";
import type {
	PersistedWorktreeSession,
	PersistedSavedWorkspace,
	RestorePreference,
	WorkspaceSnapshot,
	PersistedWorkspaceStateV2,
} from "../../shared/models/persisted-workspace-state";
import type {
	CreateWorktreePreview,
	RemoveWorktreePreview,
} from "../../shared/models/worktree-lifecycle";
import {
	buildSavedWorkspace,
	rebaseSnapshotPaths,
	reconcileSnapshotToWorktrees,
	shouldReattachSnapshot,
	splitPendingRestores,
} from "../features/workspace/workspace-persistence";
import { RepositoryInput } from "../features/repository/RepositoryInput";
import { RestorePrompt } from "../features/repository/RestorePrompt";
import {
	SessionSidebar,
	type SessionSidebarWorkspace,
} from "../features/workspace/SessionSidebar";
import { SessionChipBar } from "../features/workspace/SessionChipBar";
import { NoteSheet } from "../features/workspace/NoteSheet";
import { displayTitle } from "../features/workspace/session-display-title";
import {
	createWorkspaceState,
	workspaceReducer,
	type WorkspaceAction,
	type WorkspaceState,
} from "../features/workspace/workspace-state";
import {
	appWorkspacesReducer,
	createAppWorkspacesState,
} from "../features/workspace/app-workspaces-state";
import { TerminalTabs } from "../features/terminals/TerminalTabs";
import { TerminalPane } from "../features/terminals/TerminalPane";
import { PresetManager } from "../features/terminals/PresetManager";
import { NewWorktreeDialog } from "../features/workspace/NewWorktreeDialog";
import { RemoveWorktreeDialog } from "../features/workspace/RemoveWorktreeDialog";
import { LoadWorkspaceDialog } from "../features/workspace/LoadWorkspaceDialog";
import { useTerminalSession } from "../features/terminals/useTerminalSession";
import { deriveAttentionState } from "../features/terminals/process-attention";
import { consumeOutputPreview } from "../features/terminals/output-preview";
import { WorktreeTree } from "../features/viewer/WorktreeTree";
import { MarkdownPreviewModal } from "../features/viewer/MarkdownPreviewModal";
import { EditorModal } from "../features/viewer/EditorModal";
import { isEditable } from "../../shared/editor/editable-files";
import { FilesOverlay } from "../features/files/FilesOverlay";
import { FileViewer } from "../features/viewer/FileViewer";
import { ChangesList } from "../features/git/ChangesList";
import { DiscardChangeDialog } from "../features/git/DiscardChangeDialog";
import { DiffViewer } from "../features/viewer/DiffViewer";
import { CommitList } from "../features/git/CommitList";
import { CommitDiffStack } from "../features/git/CommitDiffStack";
import { ReviewDrawer } from "../features/review/ReviewDrawer";
import { useReviewDrawerAutoExpand } from "../features/review/use-review-drawer-auto-expand";
import { buildWorktreeProcessSummary } from "../features/workspace/sidebar-shell-summary";
import type {
	GitCommitHistory,
	GitCommitDetail,
} from "../../shared/models/git-commit-review";
import type { RemoteStatus } from "../../shared/models/git-remote-status";
import type { GitChangeStatus } from "../../shared/models/git-change";
import {
	git,
	terminals,
	workspace,
	repository as repositoryClient,
	files,
} from "../lib/desktop-client";
import { logRendererShellEvent } from "../features/terminals/shell-event-logger";
import { useTheme } from "../lib/useTheme";
import { describeRepositoryLoadError } from "../features/repository/describe-repository-load-error";

type StartupMode = "loading" | "prompt" | "ready";

function normalizeTerminalTitle(title: string): string | null {
	const normalized = title.trim().replace(/\s+/g, " ");
	if (!normalized) return null;
	if (normalized.startsWith("/") || normalized.startsWith("~/")) return null;
	if (/^[A-Za-z]:[\\/]/.test(normalized)) return null;
	return normalized;
}

export function App() {
	const { resolvedTheme } = useTheme();
	const [reviewRailWidth, setReviewRailWidth] = useState(320);
	const [reviewPanelHeight, setReviewPanelHeight] = useState(280);
	const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
	const [sidebarWidth, setSidebarWidth] = useState(240);
	const [pendingRename, setPendingRename] = useState<{ workspaceId: string; worktreeId: string } | null>(null);
	const [sidebarNow, setSidebarNow] = useState(() => Date.now());
	const [noteSheetOpen, setNoteSheetOpen] = useState(false);
	const [filesOverlayOpen, setFilesOverlayOpen] = useState(false);

	// Multi-workspace registry
	const [appWorkspaces, dispatchAppWorkspaces] = useReducer(
		appWorkspacesReducer,
		createAppWorkspacesState(),
	);

	// Derive active workspace data
	const activeWorkspace = appWorkspaces.activeWorkspaceId
		? (appWorkspaces.workspacesById[appWorkspaces.activeWorkspaceId] ?? null)
		: null;
	const repository = activeWorkspace?.repository ?? null;
	const worktrees = activeWorkspace?.worktrees ?? [];
	const activeWorkspaceId = appWorkspaces.activeWorkspaceId;
	const workspaceState =
		activeWorkspace?.workspaceState ?? createWorkspaceState([]);

	// Stable ref to the full multi-workspace state — used by onOutput/onExit to
	// route events from inactive workspaces without depending on the render cycle.
	const appWorkspacesRef = useRef(appWorkspaces);
	appWorkspacesRef.current = appWorkspaces;

	// Keep a "shadow" ref for the active workspace's workspaceState that is
	// updated synchronously when dispatch is called, so that multiple sequential
	// dispatch calls in async code each see the accumulated state rather than
	// a stale render snapshot.
	const activeWorkspaceStateRef = useRef(workspaceState);
	// Per-workspace shadow state for inactive workspaces. Mirrors the role of
	// activeWorkspaceStateRef for background PTY events: updated synchronously in
	// the onOutput/onExit else branches so burst events accumulate rather than
	// overwriting each other before the next React render.
	const inactiveWorkspaceStatesRef = useRef<Map<string, WorkspaceState>>(
		new Map(),
	);
	const outputPreviewBuffersRef = useRef<Map<string, string>>(new Map());
	// Reset the shadow ref whenever the active workspace changes (e.g. workspace
	// switch or initial register). The workspaceState derived from the render is
	// authoritative at render time.
	const prevActiveWorkspaceIdRef = useRef<string | null>(null);
	if (prevActiveWorkspaceIdRef.current !== appWorkspaces.activeWorkspaceId) {
		prevActiveWorkspaceIdRef.current = appWorkspaces.activeWorkspaceId;
		activeWorkspaceStateRef.current = workspaceState;
		// Drop the inactive shadow for the workspace that just became active — the
		// active shadow ref now owns accumulation for it.
		if (appWorkspaces.activeWorkspaceId) {
			inactiveWorkspaceStatesRef.current.delete(
				appWorkspaces.activeWorkspaceId,
			);
		}
	}

	useEffect(() => {
		const interval = window.setInterval(() => {
			setSidebarNow(Date.now());
		}, 1_000);
		return () => window.clearInterval(interval);
	}, []);

	// Stable dispatch wrapper — always applies to the shadow ref so sequential
	// async calls accumulate correctly without waiting for React to re-render.
	const dispatch = useCallback(
		(action: WorkspaceAction) => {
			const wsId = prevActiveWorkspaceIdRef.current;
			if (!wsId) return;
			const nextState = workspaceReducer(
				activeWorkspaceStateRef.current,
				action,
			);
			activeWorkspaceStateRef.current = nextState;
			dispatchAppWorkspaces({
				type: "workspace/updateWorkspaceState",
				workspaceId: wsId,
				workspaceState: nextState,
			});
		},
		// dispatchAppWorkspaces is stable (from useReducer); no deps needed
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[],
	);

	function getWorkspaceStateById(workspaceId: string): WorkspaceState | null {
		if (workspaceId === appWorkspacesRef.current.activeWorkspaceId) {
			return activeWorkspaceStateRef.current;
		}
		return (
			inactiveWorkspaceStatesRef.current.get(workspaceId) ??
			appWorkspacesRef.current.workspacesById[workspaceId]?.workspaceState ??
			null
		);
	}

	function createScopedWorkspaceDispatch(workspaceId: string) {
		const localShadow = { current: getWorkspaceStateById(workspaceId) };
		return (action: WorkspaceAction) => {
			const baseState =
				localShadow.current ?? getWorkspaceStateById(workspaceId);
			if (!baseState) return;
			const nextState = workspaceReducer(baseState, action);
			localShadow.current = nextState;
			if (workspaceId === appWorkspacesRef.current.activeWorkspaceId) {
				prevActiveWorkspaceIdRef.current = workspaceId;
				activeWorkspaceStateRef.current = nextState;
				inactiveWorkspaceStatesRef.current.delete(workspaceId);
			} else {
				inactiveWorkspaceStatesRef.current.set(workspaceId, nextState);
			}
			dispatchAppWorkspaces({
				type: "workspace/updateWorkspaceState",
				workspaceId,
				workspaceState: nextState,
			});
		};
	}

	const worktreesRef = useRef(worktrees);
	worktreesRef.current = worktrees;
	const workspaceStateRef = useRef(workspaceState);
	workspaceStateRef.current = workspaceState;
	const [refreshKey, setRefreshKey] = useState(0);
	const [windowFocused, setWindowFocused] = useState(
		typeof document !== "undefined" ? document.hasFocus() : true,
	);
	const previousFocusedRef = useRef(windowFocused);

	type ReviewLoadState<T> = {
		data: T | null;
		stale: boolean;
		message: string | null;
	};

	const [commitHistoryState, setCommitHistoryState] = useState<
		ReviewLoadState<GitCommitHistory>
	>({
		data: null,
		stale: false,
		message: null,
	});
	const [commitDetailState, setCommitDetailState] = useState<
		ReviewLoadState<GitCommitDetail>
	>({
		data: null,
		stale: false,
		message: null,
	});
	const [diffState, setDiffState] = useState<ReviewLoadState<GitDiff>>({
		data: null,
		stale: false,
		message: null,
	});
	const [error, setError] = useState<string | null>(null);
	const [presetManagerOpen, setPresetManagerOpen] = useState(false);
	const [createDialogOpen, setCreateDialogOpen] = useState(false);
	const [createName, setCreateName] = useState("");
	const [createSessionTitle, setCreateSessionTitle] = useState("");
	const [createPreview, setCreatePreview] =
		useState<CreateWorktreePreview | null>(null);
	const [createLoading, setCreateLoading] = useState(false);
	const [createError, setCreateError] = useState<string | null>(null);
	const [createBusy, setCreateBusy] = useState(false);
	const [remoteStatus, setRemoteStatus] = useState<RemoteStatus | null>(null);
	const [discardPath, setDiscardPath] = useState<string | null>(null);
	const [treePreviewPath, setTreePreviewPath] = useState<string | null>(null);
	const [editorTarget, setEditorTarget] = useState<{
		workspaceId: string;
		worktreeId: string;
		relativePath: string;
		content: string;
		mtimeMs: number;
	} | null>(null);
	const [openEditorError, setOpenEditorError] = useState<string | null>(null);
	const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
	const [removeTargetId, setRemoveTargetId] = useState<string | null>(null);
	const [removePreview, setRemovePreview] =
		useState<RemoveWorktreePreview | null>(null);
	const [removeError, setRemoveError] = useState<string | null>(null);
	const [removeBusy, setRemoveBusy] = useState(false);
	const [confirmedDirtyRemoval, setConfirmedDirtyRemoval] = useState(false);
	const [startupMode, setStartupMode] = useState<StartupMode>("loading");
	const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);

	// V2 restore state — restorePreference lives here; workspace snapshots are in appWorkspaces
	const [restorePreference, setRestorePreference] =
		useState<RestorePreference>("prompt");
	// V1 snapshot preserved for start-clean flow and snapshot reattachment
	const [savedSnapshot, setSavedSnapshot] = useState<WorkspaceSnapshot | null>(
		null,
	);
	// Non-active workspaces from v2 restore state — registered as dormant on startup
	const [savedDormantWorkspaces, setSavedDormantWorkspaces] = useState<
		PersistedSavedWorkspace[]
	>([]);

	const [startupError, setStartupError] = useState<string | null>(null);
	const [restoreWarning, setRestoreWarning] = useState<string | null>(null);
	const [pendingRestoreSessions, setPendingRestoreSessions] = useState<
		Record<string, PersistedWorktreeSession>
	>({});

	// ---------------------------------------------------------------------------
	// Startup / restore effect
	// ---------------------------------------------------------------------------

	useEffect(() => {
		void logRendererShellEvent({
			event: "renderer-start",
			windowId: null,
			data: { activeWorkspaceId: appWorkspacesRef.current.activeWorkspaceId },
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useEffect(() => {
		let cancelled = false;

		void workspace
			.readRestoreState()
			.then(async (result) => {
				if (cancelled) return;

				const activeSaved = result.activeWorkspaceId
					? result.workspaces.find(
							(w) => w.workspaceId === result.activeWorkspaceId,
						)
					: result.workspaces[0];
				const snapshot = activeSaved?.snapshot ?? null;
				const dormantSaved = result.workspaces.filter(
					(w) => w.workspaceId !== (activeSaved?.workspaceId ?? ""),
				);

				setRestorePreference(result.restorePreference);
				setSavedSnapshot(snapshot);
				setSavedDormantWorkspaces(dormantSaved);

				if (!snapshot) {
					setStartupMode("ready");
					return;
				}
				if (result.restorePreference === "alwaysStartClean") {
					setStartupMode("ready");
					return;
				}
				if (result.restorePreference === "alwaysRestore") {
					void restoreWorkspace(
						snapshot,
						result.restorePreference,
						dormantSaved,
					);
					return;
				}

				// A renderer reload should reconnect immediately when the main process
				// still owns live terminal sessions for the saved workspace.
				if (activeSaved?.workspaceId) {
					try {
						void logRendererShellEvent({
							event: "renderer-reconnect-list-start",
							windowId: null,
							data: { targetWorkspaceId: activeSaved.workspaceId },
						});
						const liveSessions = await terminals.list(activeSaved.workspaceId);
						if (cancelled) return;
						void logRendererShellEvent({
							event: "renderer-reconnect-list-success",
							windowId: null,
							data: {
								targetWorkspaceId: activeSaved.workspaceId,
								liveBackendSessionIds: liveSessions.map((s) => s.id),
							},
						});
						if (liveSessions.length > 0) {
							void logRendererShellEvent({
								event: "renderer-reload-detected",
								windowId: null,
								reasonKind: "window_lifecycle",
								reason: "renderer_reload",
								data: {
									targetWorkspaceId: activeSaved.workspaceId,
									liveSessionCount: liveSessions.length,
								},
							});
							void restoreWorkspace(
								snapshot,
								result.restorePreference,
								dormantSaved,
							);
							return;
						}
					} catch {
						// Fall through to the regular prompt path.
					}
				}

				setStartupMode("prompt");
			})
			.catch((err) => {
				if (cancelled) return;
				setStartupError(`Failed to load workspace state: ${String(err)}`);
				setStartupMode("ready");
			});

		return () => {
			cancelled = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps -- startup-only effect; restoreWorkspace is intentionally excluded to prevent re-runs on re-render
	}, []);

	useEffect(
		() =>
			workspace.onOpenPicker(() => {
				if (startupMode !== "ready") return;
				setError(null);
				setStartupError(null);
				setWorkspacePickerOpen(true);
			}),
		[startupMode],
	);

	const activeWorktree =
		worktrees.find((w) => w.id === workspaceState.selectedWorktreeId) ?? null;
	const activeSession = workspaceState.selectedWorktreeId
		? (workspaceState.sessionsByWorktreeId[workspaceState.selectedWorktreeId] ??
			null)
		: null;
	const activeProcesses = (activeSession?.processSessionIds ?? [])
		.map((id) => workspaceState.processSessionsById[id])
		.filter(Boolean)
		.sort((a, b) => Number(b.pinned) - Number(a.pinned));
	const splitVisibleProcessIds =
		activeSession?.terminalLayoutMode === "split"
			? [
					activeSession.splitLeftProcessId,
					activeSession.splitRightProcessId,
				].filter((id): id is string => !!id)
			: [];
	const visibleProcessIds =
		activeSession?.terminalLayoutMode === "split"
			? splitVisibleProcessIds
			: activeSession?.activeProcessSessionId
				? [activeSession.activeProcessSessionId]
				: [];
	const visibleTerminalSessionIds = visibleProcessIds.flatMap((processId) => {
		const terminalSessionId =
			workspaceState.processSessionsById[processId]?.terminalSessionId;
		return terminalSessionId ? [terminalSessionId] : [];
	});

	const openEditorForFile = useCallback(
		async (relativePath: string) => {
			if (!activeWorktree || !activeWorkspaceId) return;
			const basename = relativePath.split("/").pop() ?? "";
			if (!isEditable(basename)) return;
			try {
				const res = await files.openForEdit(activeWorkspaceId, activeWorktree.id, relativePath);
				if (!res.ok) {
					setOpenEditorError(`Cannot open file: ${res.reason}`);
					return;
				}
				setOpenEditorError(null);
				setEditorTarget({
					workspaceId: activeWorkspaceId,
					worktreeId: activeWorktree.id,
					relativePath,
					content: res.content,
					mtimeMs: res.mtimeMs,
				});
			} catch {
				setOpenEditorError("Failed to open file for editing");
			}
		},
		[activeWorktree, activeWorkspaceId],
	);

	const trackedFilesLoader = useCallback(async () => {
		if (!activeWorkspaceId || !activeWorktree) return [];
		return files.listTracked(activeWorkspaceId, activeWorktree.id);
	}, [activeWorkspaceId, activeWorktree]);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (!(e.metaKey || e.ctrlKey) || e.key !== "e") return;
			if (editorTarget !== null) return; // modal owns it while open
			const selectedPath = activeSession?.selectedFilePath ?? null;
			if (!selectedPath) return;
			const basename = selectedPath.split("/").pop() ?? "";
			if (!isEditable(basename)) return;
			e.preventDefault();
			void openEditorForFile(selectedPath);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [editorTarget, openEditorForFile, activeSession?.selectedFilePath]);

	function findProcessByTerminalSessionId(
		terminalSessionId: string,
	): { process: ProcessSession; workspaceId: string } | null {
		// Search all hydrated workspaces so events from inactive workspaces are
		// still routed correctly while they run in the background.
		for (const ws of Object.values(appWorkspacesRef.current.workspacesById)) {
			if (!ws.workspaceState) continue;
			const process = Object.values(ws.workspaceState.processSessionsById).find(
				(p) => p.terminalSessionId === terminalSessionId,
			);
			if (process) return { process, workspaceId: ws.workspaceId };
		}
		return null;
	}

	function selectActiveProcess(processId: string) {
		if (!activeWorktree) return;
		dispatch({
			type: "session/selectProcess",
			worktreeId: activeWorktree.id,
			processId,
		});
		dispatch({
			type: "session/markProcessViewed",
			worktreeId: activeWorktree.id,
			processId,
		});
	}

	function logBindingChange(input: {
		triggerEventId?: string | null;
		reasonKind:
			| "user_action"
			| "system_reconnect"
			| "window_lifecycle"
			| "renderer_drop"
			| "process_exit"
			| "backend_cleanup"
			| "unknown";
		reason: string;
		isExpected: boolean;
		expectedBecause: string | null;
		previousBinding: Record<string, unknown> | null;
		nextBinding: Record<string, unknown> | null;
	}) {
		return logRendererShellEvent({
			event: "terminal-binding-changed",
			windowId: null,
			triggerEventId: input.triggerEventId ?? null,
			reasonKind: input.reasonKind,
			reason: input.reason,
			isExpected: input.isExpected,
			expectedBecause: input.expectedBecause,
			data: {
				previousBinding: input.previousBinding,
				nextBinding: input.nextBinding,
			},
		});
	}

	const {
		sessions,
		createSession,
		sendInput,
		stopSession,
		removeSession,
		adoptSession,
	} = useTerminalSession({
		onOutput: (event) => {
			const found = findProcessByTerminalSessionId(event.sessionId);
			if (!found) return;
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
			const action: WorkspaceAction = {
				type: "session/recordProcessOutput",
				worktreeId: process.worktreeId,
				processId: process.id,
				attentionState: deriveAttentionState(event.data),
				at: Date.now(),
				isViewed:
					visibleProcessIds.includes(process.id) &&
					process.worktreeId === activeWorktree?.id,
				lastOutputPreview: previewUpdate.preview,
			};
			if (ownerWsId === appWorkspacesRef.current.activeWorkspaceId) {
				dispatch(action);
			} else {
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
			}
		},
		onExit: (event) => {
			const found = findProcessByTerminalSessionId(event.sessionId);
			if (!found) return;
			outputPreviewBuffersRef.current.delete(event.sessionId);
			const { process, workspaceId: ownerWsId } = found;
			const action: WorkspaceAction = {
				type: "session/updateProcessStatus",
				processId: process.id,
				status: "exited",
				exitCode: event.exitCode ?? null,
			};
			if (ownerWsId === appWorkspacesRef.current.activeWorkspaceId) {
				dispatch(action);
			} else {
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
			}
			void logBindingChange({
				reasonKind: "process_exit",
				reason: "pty_exit",
				isExpected: false,
				expectedBecause: null,
				previousBinding: {
					terminalSessionId: event.sessionId,
					processId: process.id,
					workspaceId: ownerWsId,
				},
				nextBinding: null,
			});
		},
		onError: (event) => {
			const found = findProcessByTerminalSessionId(event.sessionId);
			if (!found) return;
			outputPreviewBuffersRef.current.delete(event.sessionId);
			const { process, workspaceId: ownerWsId } = found;
			const action: WorkspaceAction = {
				type: "session/updateProcessStatus",
				processId: process.id,
				status: "error",
				exitCode: null,
			};
			if (ownerWsId === appWorkspacesRef.current.activeWorkspaceId) {
				dispatch(action);
			} else {
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
			}
		},
	});
	const orderedSessions =
		activeSession?.terminalLayoutMode === "split"
			? [
					...visibleTerminalSessionIds.flatMap((sessionId) => {
						const session = sessions.find(
							(candidate) => candidate.id === sessionId,
						);
						return session ? [session] : [];
					}),
					...sessions.filter(
						(session) => !visibleTerminalSessionIds.includes(session.id),
					),
				]
			: sessions;

	// ---------------------------------------------------------------------------
	// handleLoadPath — called from RepositoryInput and restoreWorkspace
	// ---------------------------------------------------------------------------

	async function activateWorkspace(workspaceId: string): Promise<{
		workspaceId: string;
		worktrees: Worktree[];
		workspaceState: WorkspaceState;
	} | null> {
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

		// Apply persisted snapshot if available
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
		dispatchAppWorkspaces({ type: "workspace/select", workspaceId: openedId });
		if (openedId !== workspaceId) {
			// The backend assigned a different workspaceId — remove the stale dormant entry
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
	}

	async function handleLoadPath(path: string) {
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

		// Check for snapshot reattachment
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

		// Prime the shadow ref for any async dispatch calls that follow.
		prevActiveWorkspaceIdRef.current = newWorkspaceId;
		activeWorkspaceStateRef.current = freshState;

		defaultShellEnsuredByWorktreeRef.current.clear();
		setPendingRestoreSessions({});
		setError(null);
		setStartupError(null);
		setRestoreWarning(null);
		setWorkspacePickerOpen(false);
	}

	async function restoreWorkspace(
		snapshot: WorkspaceSnapshot,
		nextPreference: RestorePreference,
		dormantWorkspaces: PersistedSavedWorkspace[] = [],
	) {
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

			// Prime the shadow ref so async dispatch calls during recreatePersistedProcesses
			// see the correct initial state rather than a stale pre-render snapshot.
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
	}

	async function recreatePersistedProcesses(
		worktree: Worktree,
		sessionSnapshot: PersistedWorktreeSession,
		targetWorkspaceId: string,
		dispatchFn: (action: WorkspaceAction) => void = dispatch,
	) {
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
						data: { terminalSessionId: liveSession.id, processId: process.id },
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
						await sendInput(terminal.id, `${process.command}\n`);
					}
				}
			} catch {
				dispatchFn({
					type: "session/updateProcessStatus",
					processId: process.id,
					status: "error",
					exitCode: null,
				});
			}
		}
	}

	// Derive git data from cached session state
	const activeSummary = activeSession?.gitSummary ?? null;
	const gitSummaryError = activeSession?.gitSummaryError ?? false;
	const gitSummaryStale = activeSession?.gitSummaryStale ?? false;
	const gitSummaryMessage = activeSession?.gitSummaryMessage ?? null;
	const changes = useMemo(
		() => activeSummary?.changedFiles ?? [],
		[activeSummary],
	);

	const gitStatusMap = useMemo(() => {
		const map = new Map<string, GitChangeStatus>();
		for (const change of changes) map.set(change.path, change.status);
		return map;
	}, [changes]);

	// ---------------------------------------------------------------------------
	// Review drawer auto-expand — clean→dirty transitions (spec §4.3)
	// ---------------------------------------------------------------------------
	const summaryReady =
		activeSession?.gitSummary !== null &&
		activeSession?.gitSummary !== undefined;
	const openReviewDrawer = useCallback(
		(worktreeId: string) => {
			dispatch({
				type: "session/setReviewDrawerOpen",
				worktreeId,
				open: true,
			});
		},
		[dispatch],
	);
	const autoExpand = useReviewDrawerAutoExpand({
		activeWorktreeId: activeWorktree?.id ?? null,
		changedCount: changes.length,
		summaryReady,
		currentlyOpen: activeSession?.reviewDrawerOpen ?? false,
		open: openReviewDrawer,
	});

	// ---------------------------------------------------------------------------
	// Persist effect — writes V2 state
	// ---------------------------------------------------------------------------

	const persistableStateV2: PersistedWorkspaceStateV2 = useMemo(() => {
		const workspaces = appWorkspaces.workspaceOrder.flatMap((wsId) => {
			const ws = appWorkspaces.workspacesById[wsId];
			if (!ws) return [];

			// For dormant workspaces, preserve the original persisted snapshot
			if (!ws.workspaceState && ws.persistedSnapshot) {
				return [ws.persistedSnapshot];
			}
			if (!ws.workspaceState) return [];

			// Build live snapshot, merging in any orphaned pending sessions
			const base = buildSavedWorkspace(
				ws.workspaceId,
				ws.repository.rootPath,
				ws.repository.repoId ?? null,
				ws.workspaceState,
			);

			// For the active workspace, include orphaned pending sessions
			if (
				ws.workspaceId === appWorkspaces.activeWorkspaceId &&
				Object.keys(pendingRestoreSessions).length > 0
			) {
				const baseIds = new Set(
					base.snapshot.worktreeSessions.map((s) => s.worktreeId),
				);
				const orphaned = Object.values(pendingRestoreSessions).filter(
					(s) => !baseIds.has(s.worktreeId),
				);
				if (orphaned.length > 0) {
					return [
						{
							...base,
							snapshot: {
								...base.snapshot,
								worktreeSessions: [
									...base.snapshot.worktreeSessions,
									...orphaned,
								],
							},
						},
					];
				}
			}

			return [base];
		});

		// When no workspaces are loaded but we have a saved snapshot (e.g. after
		// start-clean or restore failure), preserve the snapshot so it survives
		// the next launch. This mirrors the v1 behavior of keeping snapshot alive.
		const effectiveWorkspaces =
			workspaces.length === 0 && savedSnapshot
				? [
						{
							workspaceId: "fallback",
							repositoryPath: savedSnapshot.repositoryPath,
							repoId: savedSnapshot.repoId ?? null,
							snapshot: savedSnapshot,
						},
					]
				: workspaces;

		return {
			version: 2,
			restorePreference,
			activeWorkspaceId: appWorkspaces.activeWorkspaceId,
			workspaceOrder: appWorkspaces.workspaceOrder,
			workspaces: effectiveWorkspaces,
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps -- deep equality via JSON for change detection
	}, [appWorkspaces, restorePreference, pendingRestoreSessions, savedSnapshot]);

	const persistableStateJson = useMemo(
		() => JSON.stringify(persistableStateV2),
		[persistableStateV2],
	);

	useEffect(() => {
		if (startupMode !== "ready") return;
		void workspace.writeRestoreState(persistableStateV2);
		// eslint-disable-next-line react-hooks/exhaustive-deps -- persistableStateJson for change detection; persistableStateV2 for the write
	}, [startupMode, persistableStateJson]);

	useEffect(() => {
		setTreePreviewPath(null);
	}, [activeWorktree?.id]);

	const defaultShellEnsuredByWorktreeRef = useRef<Set<string>>(new Set());

	useEffect(() => {
		if (startupMode !== "ready") return;
		if (!activeWorktree || !activeSession) return;
		if (activeSession.processSessionIds.length > 0) return;
		if (defaultShellEnsuredByWorktreeRef.current.has(activeWorktree.id)) return;

		defaultShellEnsuredByWorktreeRef.current.add(activeWorktree.id);
		void handleAddAdHoc().catch(() => {
			defaultShellEnsuredByWorktreeRef.current.delete(activeWorktree.id);
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps -- guarded one-time default shell creation per worktree
	}, [
		startupMode,
		activeWorktree?.id,
		activeSession?.processSessionIds.length,
	]);

	// Fetch git summary when active worktree changes or user refreshes
	useEffect(() => {
		if (!activeWorktree?.path) return;
		let cancelled = false;

		dispatch({
			type: "session/startGitSummaryRefresh",
			worktreeId: activeWorktree.id,
		});

		git
			.readSummary(activeWorktree.path)
			.then((summary) => {
				if (cancelled) return;
				dispatch({
					type: "session/cacheGitSummarySuccess",
					worktreeId: activeWorktree.id,
					gitSummary: summary,
				});
			})
			.catch((err) => {
				if (cancelled) return;
				dispatch({
					type: "session/cacheGitSummaryFailure",
					worktreeId: activeWorktree.id,
					message: err instanceof Error ? err.message : String(err),
				});
			});

		return () => {
			cancelled = true;
		};
	}, [activeWorktree?.id, activeWorktree?.path, refreshKey]);

	useEffect(() => {
		if (!createDialogOpen || !createName.trim() || !activeWorkspaceId) {
			setCreatePreview(null);
			setCreateError(null);
			return;
		}
		let cancelled = false;
		const timeoutId = window.setTimeout(() => {
			setCreateLoading(true);
			repositoryClient
				.previewCreateWorktree(activeWorkspaceId, createName)
				.then((preview) => {
					if (cancelled) return;
					setCreatePreview(preview);
					setCreateError(null);
				})
				.catch((err) => {
					if (cancelled) return;
					setCreatePreview(null);
					setCreateError(err instanceof Error ? err.message : String(err));
				})
				.finally(() => {
					if (!cancelled) setCreateLoading(false);
				});
		}, 350);
		return () => {
			cancelled = true;
			window.clearTimeout(timeoutId);
		};
	}, [createDialogOpen, createName]);

	useEffect(() => {
		if (!removeDialogOpen || !removeTargetId || !activeWorkspaceId) {
			setRemovePreview(null);
			setRemoveError(null);
			return;
		}
		let cancelled = false;
		repositoryClient
			.previewRemoveWorktree(activeWorkspaceId, removeTargetId)
			.then((preview) => {
				if (!cancelled) {
					setRemovePreview(preview);
					setRemoveError(null);
				}
			})
			.catch((err) => {
				if (!cancelled) {
					setRemovePreview(null);
					setRemoveError(err instanceof Error ? err.message : String(err));
				}
			});
		return () => {
			cancelled = true;
		};
	}, [removeDialogOpen, removeTargetId]);

	async function refreshWorktreeInventory(options?: {
		preferredSelectedWorktreeId?: string | null;
		skipRuntimeCleanupWorktreeIds?: string[];
	}) {
		if (!repository || !activeWorkspaceId) return;
		const latest = await repositoryClient.listWorktrees(activeWorkspaceId);
		const latestIds = new Set(latest.map((worktree) => worktree.id));
		const skipCleanupIds = new Set(
			options?.skipRuntimeCleanupWorktreeIds ?? [],
		);
		const removedWorktreeIds = worktreesRef.current
			.filter((worktree) => !latestIds.has(worktree.id))
			.filter((worktree) => !skipCleanupIds.has(worktree.id))
			.map((worktree) => worktree.id);

		for (const removedWorktreeId of removedWorktreeIds) {
			const removedSession =
				workspaceStateRef.current.sessionsByWorktreeId[removedWorktreeId];
			if (!removedSession) continue;
			for (const processId of removedSession.processSessionIds) {
				const process =
					workspaceStateRef.current.processSessionsById[processId];
				if (!process?.terminalSessionId) continue;
				try {
					await stopSession(process.terminalSessionId);
				} catch {
					// External worktree removal already invalidated the cwd; still
					// clear the renderer's runtime copy so stale terminals disappear.
				}
				removeSession(process.terminalSessionId);
			}
		}

		// Update the active workspace's worktrees list in appWorkspaces
		if (appWorkspaces.activeWorkspaceId) {
			const currentWs =
				appWorkspaces.workspacesById[appWorkspaces.activeWorkspaceId];
			if (currentWs) {
				const reconciled = workspaceReducer(workspaceStateRef.current, {
					type: "workspace/reconcileWorktrees",
					worktrees: latest,
				});
				dispatchAppWorkspaces({
					type: "workspace/register",
					workspace: {
						...currentWs,
						worktrees: latest,
						workspaceState: reconciled,
					},
				});
				// Sync the shadow ref so subsequent dispatch() calls in this function
				// see the reconciled state rather than the pre-reconcile snapshot.
				activeWorkspaceStateRef.current = reconciled;
			}
		}

		if (
			options?.preferredSelectedWorktreeId &&
			latestIds.has(options.preferredSelectedWorktreeId)
		) {
			dispatch({
				type: "session/selectWorktree",
				worktreeId: options.preferredSelectedWorktreeId,
			});
		}
	}

	async function handleRefreshChanges() {
		await refreshWorktreeInventory();
		setRefreshKey((k) => k + 1);
	}

	async function handleDiscardChange() {
		if (!activeWorktree?.path || !discardPath) return;
		await git.discardChange(activeWorktree.path, discardPath);
		setRefreshKey((k) => k + 1);
	}

	async function handlePushBranch(force: boolean) {
		if (!activeWorktree?.path) return;
		await git.pushBranch(activeWorktree.path, force);
		setRefreshKey((k) => k + 1);
	}

	useEffect(() => {
		const handleFocus = () => {
			setWindowFocused(true);
			void logRendererShellEvent({
				event: "renderer-window-focus",
				windowId: null,
				reasonKind: "window_lifecycle",
				reason: "app_focus",
				data: {
					activeWorkspaceId: appWorkspacesRef.current.activeWorkspaceId,
					activeWorktreeId: activeWorkspaceStateRef.current.selectedWorktreeId,
				},
			});
			void logRendererShellEvent({
				event: "app-became-active",
				windowId: null,
				reasonKind: "window_lifecycle",
				reason: "app_focus",
				data: {
					activeWorkspaceId: appWorkspacesRef.current.activeWorkspaceId,
					activeWorktreeId: activeWorkspaceStateRef.current.selectedWorktreeId,
				},
			});
		};
		const handleBlur = () => {
			setWindowFocused(false);
			void logRendererShellEvent({
				event: "renderer-window-blur",
				windowId: null,
				reasonKind: "window_lifecycle",
				reason: "app_blur",
				data: {
					activeWorkspaceId: appWorkspacesRef.current.activeWorkspaceId,
					activeWorktreeId: activeWorkspaceStateRef.current.selectedWorktreeId,
				},
			});
			void logRendererShellEvent({
				event: "app-became-inactive",
				windowId: null,
				reasonKind: "window_lifecycle",
				reason: "app_blur",
				data: {
					activeWorkspaceId: appWorkspacesRef.current.activeWorkspaceId,
					activeWorktreeId: activeWorkspaceStateRef.current.selectedWorktreeId,
				},
			});
		};
		window.addEventListener("focus", handleFocus);
		window.addEventListener("blur", handleBlur);
		return () => {
			window.removeEventListener("focus", handleFocus);
			window.removeEventListener("blur", handleBlur);
		};
	}, []);

	useEffect(() => {
		if (
			startupMode !== "ready" ||
			!repository ||
			!activeWorktree ||
			!windowFocused
		)
			return;

		const interval = window.setInterval(() => {
			void handleRefreshChanges();
		}, 15_000);

		return () => window.clearInterval(interval);
	}, [startupMode, repository?.rootPath, activeWorktree?.id, windowFocused]);

	useEffect(() => {
		const wasFocused = previousFocusedRef.current;
		previousFocusedRef.current = windowFocused;

		if (
			!wasFocused &&
			windowFocused &&
			startupMode === "ready" &&
			repository &&
			activeWorktree
		) {
			void handleRefreshChanges();
		}
	}, [windowFocused, startupMode, repository?.rootPath, activeWorktree?.id]);

	function handleReviewRailResizeStart(event: ReactMouseEvent<HTMLDivElement>) {
		event.preventDefault();
		const startX = event.clientX;
		const startWidth = reviewRailWidth;

		const handleMouseMove = (moveEvent: MouseEvent) => {
			const nextWidth = Math.min(
				520,
				Math.max(240, startWidth + (moveEvent.clientX - startX)),
			);
			setReviewRailWidth(nextWidth);
		};

		const handleMouseUp = () => {
			window.removeEventListener("mousemove", handleMouseMove);
			window.removeEventListener("mouseup", handleMouseUp);
		};

		window.addEventListener("mousemove", handleMouseMove);
		window.addEventListener("mouseup", handleMouseUp);
	}

	function handleSidebarResizeStart(event: ReactMouseEvent<HTMLDivElement>) {
		event.preventDefault();
		const startX = event.clientX;
		const startWidth = sidebarWidth;

		const handleMouseMove = (moveEvent: MouseEvent) => {
			const nextWidth = Math.min(
				480,
				Math.max(180, startWidth + (moveEvent.clientX - startX)),
			);
			setSidebarWidth(nextWidth);
		};

		const handleMouseUp = () => {
			window.removeEventListener("mousemove", handleMouseMove);
			window.removeEventListener("mouseup", handleMouseUp);
		};

		window.addEventListener("mousemove", handleMouseMove);
		window.addEventListener("mouseup", handleMouseUp);
	}

	function handleReviewPanelResizeStart(
		event: ReactMouseEvent<HTMLDivElement>,
	) {
		event.preventDefault();
		const startY = event.clientY;
		const startHeight = reviewPanelHeight;

		const handleMouseMove = (moveEvent: MouseEvent) => {
			const maxHeight = Math.max(160, window.innerHeight - 320);
			// Moving the handle upward increases review height; moving it
			// downward decreases review height and gives space back to the
			// terminal. Keep the subtraction form explicit so unit and e2e
			// expectations stay aligned.
			const nextHeight = Math.min(
				maxHeight,
				Math.max(160, startHeight - (moveEvent.clientY - startY)),
			);
			setReviewPanelHeight(nextHeight);
		};

		const handleMouseUp = () => {
			window.removeEventListener("mousemove", handleMouseMove);
			window.removeEventListener("mouseup", handleMouseUp);
		};

		window.addEventListener("mousemove", handleMouseMove);
		window.addEventListener("mouseup", handleMouseUp);
	}

	async function handleSelectWorktree(
		worktreeId: string,
		targetContext?: {
			workspaceId: string;
			worktrees: Worktree[];
			workspaceState: WorkspaceState;
		},
	) {
		const targetWorkspaceId = targetContext?.workspaceId ?? activeWorkspaceId;
		if (!targetWorkspaceId) return;
		const targetWorktrees = targetContext?.worktrees ?? worktrees;
		const targetWorkspaceState =
			targetContext?.workspaceState ?? workspaceState;

		void logRendererShellEvent({
			event: "worktree-select",
			windowId: null,
			reasonKind: "user_action",
			reason: "worktree_switch",
			data: {
				activeWorkspaceId: targetWorkspaceId,
				previousWorktreeId: activeWorkspaceStateRef.current.selectedWorktreeId,
				nextWorktreeId: worktreeId,
			},
		});
		void logBindingChange({
			reasonKind: "user_action",
			reason: "worktree_switch",
			isExpected: true,
			expectedBecause: "user_explicit_worktree_select",
			previousBinding: {
				workspaceId: targetWorkspaceId,
				worktreeId: activeWorkspaceStateRef.current.selectedWorktreeId,
			},
			nextBinding: { workspaceId: targetWorkspaceId, worktreeId },
		});

		const pending = pendingRestoreSessions[worktreeId];
		if (pending) {
			dispatch({
				type: "session/restoreSnapshot",
				workspaceId: targetWorkspaceId,
				snapshot: pending,
			});
			setPendingRestoreSessions((prev) => {
				const next = { ...prev };
				delete next[worktreeId];
				return next;
			});
		}

		dispatch({ type: "session/selectWorktree", worktreeId });
		if (pending?.activeProcessSessionId) {
			dispatch({
				type: "session/markProcessViewed",
				worktreeId,
				processId: pending.activeProcessSessionId,
			});
		} else {
			// workspaceState is the pre-dispatch snapshot from this render's
			// closure; reading activeProcessSessionId from it is correct here
			// because the preceding session/selectWorktree dispatch is batched
			// by React and has not yet been applied to workspaceState.  For
			// non-pending sessions the data we need already existed before the
			// dispatch, so the stale read is safe.
			const session = targetWorkspaceState.sessionsByWorktreeId[worktreeId];
			if (session?.activeProcessSessionId) {
				dispatch({
					type: "session/markProcessViewed",
					worktreeId,
					processId: session.activeProcessSessionId,
				});
			}
		}

		if (pending) {
			const worktree = targetWorktrees.find((entry) => entry.id === worktreeId);
			if (worktree) {
				await recreatePersistedProcesses(worktree, pending, targetWorkspaceId);
			}
		}
	}

	async function handleSelectSidebarWorktree(
		workspaceId: string,
		worktreeId: string,
	) {
		const isCrossWorkspace =
			workspaceId !== appWorkspacesRef.current.activeWorkspaceId;
		if (isCrossWorkspace) {
			void logRendererShellEvent({
				event: "workspace-select",
				windowId: null,
				reasonKind: "user_action",
				reason: "workspace_switch",
				data: {
					activeWorkspaceId: appWorkspacesRef.current.activeWorkspaceId,
					nextWorkspaceId: workspaceId,
				},
			});
			void logBindingChange({
				reasonKind: "user_action",
				reason: "workspace_switch",
				isExpected: true,
				expectedBecause: "user_explicit_workspace_select",
				previousBinding: {
					workspaceId: appWorkspacesRef.current.activeWorkspaceId,
					worktreeId: activeWorkspaceStateRef.current.selectedWorktreeId,
				},
				nextBinding: { workspaceId, worktreeId },
			});
		}
		const targetContext =
			workspaceId === appWorkspacesRef.current.activeWorkspaceId
				? {
						workspaceId,
						worktrees,
						workspaceState,
					}
				: await activateWorkspace(workspaceId);
		if (!targetContext) return;
		await handleSelectWorktree(worktreeId, targetContext);
	}

	async function handleConfirmCreateWorktree() {
		if (!createPreview || !activeWorkspaceId) return;
		setCreateBusy(true);
		try {
			const created = await repositoryClient.createWorktree(
				activeWorkspaceId,
				createName,
			);
			if (createSessionTitle.trim()) {
				dispatch({ type: "session/setTitle", worktreeId: created.id, title: createSessionTitle });
			}
			await refreshWorktreeInventory({
				preferredSelectedWorktreeId: created.id,
			});
			setCreateDialogOpen(false);
			setCreateName("");
			setCreateSessionTitle("");
			setCreatePreview(null);
		} catch (err) {
			setCreateError(err instanceof Error ? err.message : String(err));
			await refreshWorktreeInventory();
		} finally {
			setCreateBusy(false);
		}
	}

	async function closeProcessesForWorktree(worktreeId: string) {
		const session = workspaceStateRef.current.sessionsByWorktreeId[worktreeId];
		if (!session) return;
		for (const processId of session.processSessionIds) {
			const process = workspaceStateRef.current.processSessionsById[processId];
			if (process?.terminalSessionId) {
				try {
					await stopSession(process.terminalSessionId);
				} catch {
					// Removal is already confirmed; continue clearing renderer state.
				}
				removeSession(process.terminalSessionId);
			}
			dispatch({ type: "session/closeProcess", worktreeId, processId });
		}
		// Clear the guard so a future worktree reusing the same id (same path) gets
		// a fresh default shell instead of being skipped because the id is still in
		// the Set from the removed worktree's first visit.
		defaultShellEnsuredByWorktreeRef.current.delete(worktreeId);
	}

	async function handleConfirmRemoveWorktree() {
		if (!removePreview || !activeWorkspaceId) return;
		setRemoveBusy(true);
		try {
			await closeProcessesForWorktree(removePreview.worktreeId);
			await repositoryClient.removeWorktree(
				activeWorkspaceId,
				removePreview.worktreeId,
			);
			await refreshWorktreeInventory({
				skipRuntimeCleanupWorktreeIds: [removePreview.worktreeId],
			});
			setRemoveDialogOpen(false);
			setRemoveTargetId(null);
			setRemovePreview(null);
		} catch (err) {
			setRemoveError(err instanceof Error ? err.message : String(err));
			await refreshWorktreeInventory();
		} finally {
			setRemoveBusy(false);
		}
	}

	// Fetch diff when selected changed file changes
	useEffect(() => {
		if (!activeWorktree?.path || !activeSession?.selectedChangedFilePath) {
			setDiffState({ data: null, stale: false, message: null });
			return;
		}
		if (
			!changes.some(
				(change) => change.path === activeSession.selectedChangedFilePath,
			)
		) {
			setDiffState({ data: null, stale: false, message: null });
			return;
		}
		let cancelled = false;
		setDiffState((prev) => ({ ...prev, message: null }));
		git
			.readDiff(activeWorktree.path, activeSession.selectedChangedFilePath)
			.then((result) => {
				if (!cancelled)
					setDiffState({ data: result, stale: false, message: null });
			})
			.catch(() => {
				if (!cancelled) {
					const requestedPath = activeSession.selectedChangedFilePath;
					setDiffState((prev) => {
						const canPreserve =
							prev.data !== null && prev.data.path === requestedPath;
						return {
							data: canPreserve ? prev.data : null,
							stale: canPreserve,
							message: canPreserve
								? "Couldn't refresh diff. Showing last successful result."
								: "Couldn't load diff.",
						};
					});
				}
			});
		return () => {
			cancelled = true;
		};
	}, [activeWorktree?.path, activeSession?.selectedChangedFilePath, changes]);

	// Fetch commit history when active worktree changes or after refresh
	useEffect(() => {
		if (!activeWorktree?.path) {
			setCommitHistoryState({ data: null, stale: false, message: null });
			return;
		}
		let cancelled = false;
		setCommitHistoryState((prev) => ({ ...prev, message: null }));
		git
			.readCommitHistory(activeWorktree.path)
			.then((history) => {
				if (cancelled) return;
				// Clear the selected commit if it's no longer in the refreshed history
				if (
					activeSession?.selectedCommitSha &&
					!history.entries.some(
						(e) => e.sha === activeSession.selectedCommitSha,
					)
				) {
					dispatch({
						type: "session/clearSelectedCommit",
						worktreeId: activeWorktree.id,
					});
				}
				setCommitHistoryState({ data: history, stale: false, message: null });
			})
			.catch(() => {
				if (cancelled) return;
				setCommitHistoryState((prev) => ({
					...prev,
					stale: prev.data !== null,
					message:
						prev.data === null
							? "Couldn't load commit history."
							: "Couldn't refresh commit history. Showing last successful result.",
				}));
			});
		return () => {
			cancelled = true;
		};
	}, [activeWorktree?.id, activeWorktree?.path, refreshKey]);

	// Fetch remote status when active worktree changes or after refresh
	useEffect(() => {
		if (!activeWorktree?.path) {
			setRemoteStatus(null);
			return;
		}
		let cancelled = false;
		git
			.getRemoteStatus(activeWorktree.path)
			.then((status) => {
				if (cancelled) return;
				setRemoteStatus(status);
			})
			.catch(() => {
				if (cancelled) return;
				setRemoteStatus(null);
			});
		return () => {
			cancelled = true;
		};
	}, [activeWorktree?.id, activeWorktree?.path, refreshKey]);

	// Fetch commit detail when selected commit changes
	useEffect(() => {
		if (!activeWorktree?.path || !activeSession?.selectedCommitSha) {
			setCommitDetailState({ data: null, stale: false, message: null });
			return;
		}
		let cancelled = false;
		setCommitDetailState((prev) => ({ ...prev, message: null }));
		git
			.readCommitDetail(activeWorktree.path, activeSession.selectedCommitSha)
			.then((detail) => {
				if (!cancelled) {
					setCommitDetailState({ data: detail, stale: false, message: null });
				}
			})
			.catch(() => {
				if (!cancelled) {
					const requestedSha = activeSession.selectedCommitSha;
					setCommitDetailState((prev) => {
						const canPreserve =
							prev.data !== null && prev.data.sha === requestedSha;
						return {
							data: canPreserve ? prev.data : null,
							stale: canPreserve,
							message: canPreserve
								? "Couldn't refresh commit detail. Showing last successful result."
								: "Couldn't load commit detail.",
						};
					});
				}
			});
		return () => {
			cancelled = true;
		};
	}, [activeWorktree?.path, activeSession?.selectedCommitSha]);

	// Cmd+; keyboard shortcut to toggle note sheet
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.defaultPrevented) return;
			if ((e.target as HTMLElement).closest?.(".xterm") !== null) return;
			const isMac = navigator.platform.toUpperCase().includes("MAC");
			const modKey = isMac ? e.metaKey : e.ctrlKey;
			if (!modKey || e.key !== ";") return;
			e.preventDefault();
			setNoteSheetOpen((prev) => !prev);
		};
		document.addEventListener("keydown", handler);
		return () => document.removeEventListener("keydown", handler);
	}, []);

	function handleSelectChangedFile(relativePath: string) {
		if (!activeWorktree) return;
		dispatch({
			type: "session/selectChangedFile",
			worktreeId: activeWorktree.id,
			relativePath,
		});
	}

	async function handleAddAdHoc() {
		if (!activeWorktree || !activeWorkspaceId) return;
		const targetWorkspaceId = activeWorkspaceId;
		const targetWorktree = activeWorktree;
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
			const process: ProcessSession = {
				id: crypto.randomUUID(),
				workspaceId: targetWorkspaceId,
				worktreeId: targetWorktree.id,
				terminalSessionId: termSession.id,
				origin: "adHoc",
				presetId: null,
				label: `shell ${adHocNumber}`,
				command: null,
				status: "running",
				lastActivityAt: null,
				lastOutputPreview: null,
				exitCode: null,
				pinned: false,
				attentionState: "idle",
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
	}

	async function handleCloseProcess(processId: string) {
		if (!activeWorktree || !activeWorkspaceId) return;
		const targetWorkspaceId = activeWorkspaceId;
		const targetWorktreeId = activeWorktree.id;
		const process = workspaceState.processSessionsById[processId];
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
	}

	async function handleLaunchPreset(presetId: string) {
		if (!activeWorktree || !activeWorkspaceId) return;
		const targetWorkspaceId = activeWorkspaceId;
		const targetWorktree = activeWorktree;
		const preset = workspaceState.commandPresets.find((p) => p.id === presetId);
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
			},
		});
		await sendInput(terminal.id, `${preset.command}\n`);
	}

	async function handleStopProcess(processId: string) {
		const process = workspaceState.processSessionsById[processId];
		if (!process?.terminalSessionId) return;
		await stopSession(process.terminalSessionId);
	}

	async function handleRestartProcess(processId: string) {
		const process = workspaceState.processSessionsById[processId];
		if (!process || !activeWorktree || !activeWorkspaceId) return;
		const targetWorkspaceId = activeWorkspaceId;
		const targetWorktree = activeWorktree;

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
	}

	async function handleRestoreDecision({
		shouldRestore,
		rememberChoice,
	}: {
		shouldRestore: boolean;
		rememberChoice: boolean;
	}) {
		const nextPreference: RestorePreference = rememberChoice
			? shouldRestore
				? "alwaysRestore"
				: "alwaysStartClean"
			: "prompt";

		if (!shouldRestore) {
			// Preserve the snapshot so the user can restore it on a future launch
			// if they change their preference back to "prompt" or "alwaysRestore".
			setRestorePreference(nextPreference);
			// Write a v2 state that preserves the snapshot
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
	}

	async function handleRemoveWorkspace(wsId: string) {
		const ws = appWorkspaces.workspacesById[wsId];
		if (!ws?.workspaceState) {
			// Dormant — no live sessions, safe to remove immediately
			dispatchAppWorkspaces({ type: "workspace/remove", workspaceId: wsId });
			return;
		}
		const liveSessions = Object.values(
			ws.workspaceState.processSessionsById,
		).filter((p) => p.status === "running" && p.terminalSessionId !== null);
		if (liveSessions.length > 0) {
			const confirmed = window.confirm(
				`"${ws.repository.name}" has ${liveSessions.length} active terminal(s). Remove it and stop all running terminals?`,
			);
			if (!confirmed) return;
			await Promise.all(
				liveSessions.flatMap((p) =>
					p.terminalSessionId ? [stopSession(p.terminalSessionId)] : [],
				),
			);
		}
		dispatchAppWorkspaces({ type: "workspace/remove", workspaceId: wsId });
	}

	const sidebarWorkspaces: SessionSidebarWorkspace[] =
		appWorkspaces.workspaceOrder
			.map((id) => appWorkspaces.workspacesById[id])
			.filter((ws): ws is NonNullable<typeof ws> => ws != null)
			.map((ws) => ({
				workspaceId: ws.workspaceId,
				name: ws.repository.name,
				worktrees: ws.worktrees,
				selectedWorktreeId:
					ws.workspaceState?.selectedWorktreeId ??
					ws.persistedSnapshot?.snapshot.selectedWorktreeId ??
					null,
				attentionByWorktreeId: ws.workspaceState
					? Object.fromEntries(
							Object.entries(ws.workspaceState.sessionsByWorktreeId).map(
								([worktreeId, session]) => [worktreeId, session.attentionState],
							),
						)
					: {},
				processesByWorktreeId: ws.workspaceState
					? Object.fromEntries(
							Object.entries(ws.workspaceState.sessionsByWorktreeId).map(
								([worktreeId, session]) => {
									const processes = session.processSessionIds
										.map((id) => ws.workspaceState!.processSessionsById[id])
										.filter(Boolean);
									return [
										worktreeId,
										buildWorktreeProcessSummary(processes, sidebarNow, 3),
									];
								},
							),
						)
					: {},
				titleByWorktreeId: ws.workspaceState
					? Object.fromEntries(
							Object.entries(ws.workspaceState.sessionsByWorktreeId).map(
								([worktreeId, session]) => [worktreeId, session.title],
							),
						)
					: {},
				active: ws.workspaceId === activeWorkspaceId,
				hydrated: ws.workspaceState !== null,
			}));

	if (startupMode === "loading") {
		return (
			<main className="shell-app shell-app--setup">
				<section className="shell-panel shell-setup-panel">
					<h1 className="shell-setup-title">ai-14all</h1>
					<p className="shell-empty-state">Loading workspace…</p>
				</section>
			</main>
		);
	}

	if (startupMode === "prompt" && savedSnapshot) {
		return (
			<main className="shell-app shell-app--setup">
				<RestorePrompt
					repositoryPath={savedSnapshot.repositoryPath}
					onDecide={handleRestoreDecision}
				/>
			</main>
		);
	}

	if (!repository) {
		return (
			<main className="shell-app shell-app--setup">
				<section className="shell-panel shell-setup-panel">
					<h1 className="shell-setup-title">ai-14all</h1>
					<h2>Repository</h2>
					<RepositoryInput onLoadPath={(path) => handleLoadPath(path)} />
					{startupError && <p className="shell-error">{startupError}</p>}
					{error && <p className="shell-error">Error: {error}</p>}
				</section>
			</main>
		);
	}

	return (
		<main className="shell-app">
			{restoreWarning && (
				<div className="shell-restore-warning" role="status">
					<span>{restoreWarning}</span>
					<button
						type="button"
						className="shell-restore-warning__dismiss"
						aria-label="Dismiss warning"
						onClick={() => setRestoreWarning(null)}
					>
						×
					</button>
				</div>
			)}
			<div
				className="shell-layout"
				data-testid="shell-layout"
				style={{
					gridTemplateColumns: `${
						sidebarCollapsed ? 56 : sidebarWidth
					}px minmax(0, 1fr)`,
				}}
			>
				<div className="shell-sidebar-column">
					{!sidebarCollapsed && (
						<div
							className="shell-sidebar-column__resize-handle"
							data-testid="sidebar-resize-handle"
							onMouseDown={handleSidebarResizeStart}
						/>
					)}
					<SessionSidebar
						workspaces={sidebarWorkspaces}
						collapsed={sidebarCollapsed}
						onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
						onLoadWorkspace={() => setWorkspacePickerOpen(true)}
						onOpenWorkspace={(workspaceId) => {
							void activateWorkspace(workspaceId);
						}}
						onSelect={(workspaceId, worktreeId) => {
							void handleSelectSidebarWorktree(workspaceId, worktreeId);
						}}
						onCreateWorktree={(workspaceId) => {
							if (workspaceId !== activeWorkspaceId) return;
							setCreateDialogOpen(true);
						}}
						onRemoveWorktree={(workspaceId, worktreeId) => {
							if (workspaceId !== activeWorkspaceId) return;
							setRemoveTargetId(worktreeId);
							setConfirmedDirtyRemoval(false);
							setRemoveDialogOpen(true);
						}}
						onRemoveWorkspace={(workspaceId) => {
							void handleRemoveWorkspace(workspaceId);
						}}
						onRenameSession={(workspaceId, worktreeId, title) => {
							if (workspaceId !== activeWorkspaceId) return;
							dispatch({ type: "session/setTitle", worktreeId, title });
							setPendingRename(null);
						}}
						onRequestExpand={(workspaceId, worktreeId) => {
							if (sidebarCollapsed) setSidebarCollapsed(false);
							if (workspaceId !== activeWorkspaceId) {
								void activateWorkspace(workspaceId);
							}
							setPendingRename({ workspaceId, worktreeId });
						}}
						pendingRename={pendingRename}
					/>
				</div>

				<section className="shell-main-column">
					{activeWorktree && activeSession && (
						<SessionChipBar
							sessionTitle={displayTitle(activeSession.title, activeWorktree)}
							worktreeLabel={activeWorktree.label}
							branchName={activeWorktree.branchName}
							isDirty={activeSummary?.isDirty ?? false}
							changedFileCount={changes.length}
							noteNonEmpty={activeSession.note.trim() !== ""}
							onRenameClick={() => {
								if (activeWorkspaceId !== null && activeWorktree !== null) {
									setSidebarCollapsed(false);
									setPendingRename({
										workspaceId: activeWorkspaceId,
										worktreeId: activeWorktree.id,
									});
								}
							}}
							onDirtyClick={() => {
								if (!activeWorktree) return;
								autoExpand.noteUserExpand(activeWorktree.id);
								dispatch({
									type: "session/setReviewDrawerOpen",
									worktreeId: activeWorktree.id,
									open: true,
								});
							}}
							onFilesClick={() => setFilesOverlayOpen(true)}
							onNoteClick={() => setNoteSheetOpen((prev) => !prev)}
						/>
					)}
					<NoteSheet
						open={noteSheetOpen}
						note={activeSession?.note ?? ""}
						onNoteChange={(note) => {
							if (activeWorktree) {
								dispatch({ type: "session/setNote", worktreeId: activeWorktree.id, note });
							}
						}}
						onClose={() => setNoteSheetOpen(false)}
					/>
					<FilesOverlay
						isOpen={filesOverlayOpen}
						onClose={() => setFilesOverlayOpen(false)}
						trackedFilesLoader={trackedFilesLoader}
						gitStatusMap={gitStatusMap}
						onViewFile={(_path) => {
							// Fleshed out in Task 7
							setFilesOverlayOpen(false);
						}}
						onEditFile={(_path) => {
							// Fleshed out in Task 8
							setFilesOverlayOpen(false);
						}}
						isEditable={isEditable}
					/>

					{workspaceState.selectedWorktreeId && (
						<section className="shell-panel shell-terminal-section">
							<TerminalTabs
								processes={activeProcesses.map((p) => ({
									id: p.id,
									label: p.label,
									status: p.status,
									pinned: p.pinned,
									attentionState: p.attentionState,
									exitCode: p.exitCode,
									lastActivityAt: p.lastActivityAt,
								}))}
								activeProcessId={activeSession?.activeProcessSessionId ?? null}
								presets={workspaceState.commandPresets}
								layoutMode={activeSession?.terminalLayoutMode ?? "single"}
								splitLeftProcessId={activeSession?.splitLeftProcessId ?? null}
								splitRightProcessId={activeSession?.splitRightProcessId ?? null}
								onAddAdHoc={handleAddAdHoc}
								onSelect={selectActiveProcess}
								onLaunchPreset={handleLaunchPreset}
								onOpenPresetManager={() => setPresetManagerOpen(true)}
								onClose={handleCloseProcess}
								onStop={handleStopProcess}
								onRestart={handleRestartProcess}
								onTogglePinned={(processId) =>
									dispatch({
										type: "session/toggleProcessPinned",
										processId,
									})
								}
								onToggleSplitMode={() =>
									dispatch({
										type: "session/setTerminalLayoutMode",
										worktreeId: activeWorktree!.id,
										layoutMode:
											activeSession?.terminalLayoutMode === "split"
												? "single"
												: "split",
										autoAssignProcessIds:
											activeSession?.terminalLayoutMode === "single" &&
											!activeSession.splitLeftProcessId &&
											!activeSession.splitRightProcessId &&
											activeProcesses.length === 2
												? activeProcesses.map((process) => process.id)
												: undefined,
									})
								}
								onShowInSplit={(processId, slot) =>
									dispatch({
										type: "session/assignProcessToSplitSlot",
										worktreeId: activeWorktree!.id,
										processId,
										slot,
									})
								}
								onRemoveFromSplit={(processId) =>
									dispatch({
										type: "session/removeProcessFromSplit",
										worktreeId: activeWorktree!.id,
										processId,
									})
								}
							/>

							<div
								className={
									activeSession?.terminalLayoutMode === "split"
										? "shell-terminal-panel__body shell-terminal-panel__body--split"
										: "shell-terminal-panel__body"
								}
							>
								{orderedSessions.map((session) => {
									const process =
										findProcessByTerminalSessionId(session.id)?.process ?? null;
									return (
										<TerminalPane
											key={session.id}
											session={session}
											visible={
												session.worktreeId === activeWorktree?.id &&
												visibleProcessIds.some(
													(processId) =>
														workspaceState.processSessionsById[processId]
															?.terminalSessionId === session.id,
												)
											}
											onTitleChange={(title) => {
												if (!process || process.origin !== "adHoc") return;
												const nextLabel = normalizeTerminalTitle(title);
												if (!nextLabel) return;
												dispatch({
													type: "session/updateProcessLabel",
													processId: process.id,
													label: nextLabel,
												});
											}}
											onActivate={() => {
												if (
													!process ||
													process.worktreeId !== activeWorktree?.id
												)
													return;
												selectActiveProcess(process.id);
											}}
										/>
									);
								})}

								{activeSession?.terminalLayoutMode === "split" ? (
									<>
										{!activeSession.splitLeftProcessId && (
											<div
												className="shell-terminal-split__empty"
												data-slot="left"
												onMouseDown={() => undefined}
											>
												<p className="shell-empty-state">
													No shell assigned to this split pane. Use a tab menu
													to show one here.
												</p>
											</div>
										)}
										{!activeSession.splitRightProcessId && (
											<div
												className="shell-terminal-split__empty"
												data-slot="right"
												onMouseDown={() => undefined}
											>
												<p className="shell-empty-state">
													No shell assigned to this split pane. Use a tab menu
													to show one here.
												</p>
											</div>
										)}
									</>
								) : !sessions.some((session) => {
										const activeProcess = activeSession?.activeProcessSessionId
											? workspaceState.processSessionsById[
													activeSession.activeProcessSessionId
												]
											: null;
										return (
											session.worktreeId === activeWorktree?.id &&
											session.id === activeProcess?.terminalSessionId
										);
								  }) ? (
									<div className="shell-terminal-panel__empty">
										<p className="shell-empty-state">
											No active shell selected. Open or choose a shell to
											continue.
										</p>
									</div>
								) : null}
							</div>
						</section>
					)}

					{activeWorktree && (
						<ReviewDrawer
							open={activeSession?.reviewDrawerOpen ?? false}
							isDirty={activeSummary?.isDirty ?? false}
							changedFileCount={changes.length}
							panelHeight={reviewPanelHeight}
							onToggle={() => {
								if (!activeWorktree) return;
								const next = !(activeSession?.reviewDrawerOpen ?? false);
								if (!next && (activeSummary?.isDirty ?? false)) {
									autoExpand.noteUserCollapse(activeWorktree.id);
								} else if (next) {
									autoExpand.noteUserExpand(activeWorktree.id);
								}
								dispatch({
									type: "session/setReviewDrawerOpen",
									worktreeId: activeWorktree.id,
									open: next,
								});
							}}
							onRefresh={handleRefreshChanges}
							onResizeStart={(e) =>
								handleReviewPanelResizeStart(
									e as ReactMouseEvent<HTMLDivElement>,
								)
							}
						>
							<Tabs.Root
								value={activeSession?.reviewMode ?? "files"}
								onValueChange={(value) =>
									dispatch({
										type: "session/setReviewMode",
										worktreeId: activeWorktree.id,
										reviewMode: value as "files" | "changes" | "commits",
									})
								}
								className="shell-review-shell"
							>
								<div
									className="shell-review-grid"
									data-testid="review-grid"
									style={{
										gridTemplateColumns: `${reviewRailWidth}px 8px minmax(0, 1fr)`,
									}}
								>
									<section
										className="shell-panel shell-review-rail"
										data-testid="review-rail"
									>
										<div className="shell-review-rail__header">
											<Tabs.List
												aria-label="Review mode"
												className="shell-review-tabs__list shell-review-tabs__segments"
											>
												<Tabs.Trigger
													value="files"
													className="shell-review-tab"
												>
													Files
												</Tabs.Trigger>
												<Tabs.Trigger
													value="changes"
													className="shell-review-tab"
												>
													Changes
												</Tabs.Trigger>
												<Tabs.Trigger
													value="commits"
													className="shell-review-tab"
												>
													Commits
												</Tabs.Trigger>
											</Tabs.List>
										</div>

										<ScrollArea.Root className="shell-review-rail__scroll">
											<ScrollArea.Viewport className="shell-rail__viewport">
												{activeSession?.reviewMode === "commits" ? (
													<>
														{commitHistoryState.message && (
															<p
																className={
																	commitHistoryState.stale
																		? "shell-inline-warning"
																		: "shell-error"
																}
															>
																{commitHistoryState.message}
															</p>
														)}
														<CommitList
															worktreePath={activeWorktree.path}
															history={
																commitHistoryState.data ?? {
																	mergeTargetRef: null,
																	entries: [],
																}
															}
															selectedCommitSha={
																activeSession.selectedCommitSha
															}
															selectedCommitFilePath={
																activeSession.selectedCommitFilePath
															}
															activeDetail={commitDetailState.data}
															onSelectCommit={(sha) =>
																dispatch({
																	type: "session/selectCommit",
																	worktreeId: activeWorktree.id,
																	sha,
																})
															}
															onDeselectCommit={() =>
																dispatch({
																	type: "session/clearSelectedCommit",
																	worktreeId: activeWorktree.id,
																})
															}
															onSelectCommitFile={(relativePath) =>
																dispatch({
																	type: "session/selectCommitFile",
																	worktreeId: activeWorktree.id,
																	relativePath,
																})
															}
															remoteStatus={remoteStatus}
															onPush={handlePushBranch}
														/>
													</>
												) : activeSession?.reviewMode === "files" ? (
													<>
														{openEditorError !== null && (
															<p className="shell-error">
																{openEditorError}
															</p>
														)}
														<WorktreeTree
															workspaceId={activeWorkspaceId ?? ""}
															worktreeId={activeWorktree.id}
															worktreeLabel={activeWorktree.label}
															selectedFile={activeSession.selectedFilePath}
															onSelect={(relativePath) =>
																dispatch({
																	type: "session/selectFile",
																	worktreeId: activeWorktree.id,
																	relativePath,
																})
															}
															onPreviewMarkdown={setTreePreviewPath}
															onEditFile={openEditorForFile}
															changedFiles={changes}
															gitSummaryError={gitSummaryError}
															gitSummaryMessage={gitSummaryMessage}
															expandedPaths={
																activeSession.treeExpandedPaths
															}
															onExpandedPathsChange={(worktreeId, paths) =>
																dispatch({
																	type: "session/setTreeExpandedPaths",
																	worktreeId,
																	paths,
																})
															}
														/>
														{treePreviewPath !== null && (
															<MarkdownPreviewModal
																worktreePath={activeWorktree.path}
																relativePath={treePreviewPath}
																open={true}
																onClose={() => setTreePreviewPath(null)}
															/>
														)}
														{editorTarget !== null && (
															<EditorModal
																workspaceId={editorTarget.workspaceId}
																worktreeId={editorTarget.worktreeId}
																relativePath={editorTarget.relativePath}
																initialContent={editorTarget.content}
																initialMtimeMs={editorTarget.mtimeMs}
																theme={resolvedTheme}
																onClose={() => setEditorTarget(null)}
																onFileSaved={() => setRefreshKey((k) => k + 1)}
															/>
														)}
													</>
												) : (
													<ChangesList
														worktreePath={activeWorktree.path}
														changes={changes}
														selectedPath={
															activeSession?.selectedChangedFilePath ?? null
														}
														onSelect={handleSelectChangedFile}
														onDiscardChange={(relativePath) =>
															setDiscardPath(relativePath)
														}
														gitSummaryError={gitSummaryError}
														gitSummaryStale={gitSummaryStale}
														gitSummaryMessage={gitSummaryMessage}
													/>
												)}
											</ScrollArea.Viewport>
											<ScrollArea.Scrollbar
												orientation="vertical"
												className="shell-scrollbar"
											/>
										</ScrollArea.Root>
									</section>

									<div
										role="separator"
										aria-orientation="vertical"
										aria-label="Resize review rail"
										data-testid="review-rail-resize-handle"
										className="shell-review-grid__resize-handle"
										onMouseDown={handleReviewRailResizeStart}
									/>

									<section className="shell-panel shell-viewer-panel">
										{activeSession?.reviewMode === "commits" &&
										commitDetailState.message !== null &&
										commitDetailState.data === null ? (
											<p className="shell-error">
												{commitDetailState.message}
											</p>
										) : activeSession?.reviewMode === "commits" &&
										  commitDetailState.data ? (
											<CommitDiffStack
												key={commitDetailState.data.sha}
												detail={commitDetailState.data}
												focusedPath={activeSession.selectedCommitFilePath}
												resolvedTheme={resolvedTheme}
											/>
										) : activeSession?.reviewMode === "files" &&
										  activeSession.selectedFilePath ? (
											<FileViewer
												worktreePath={activeWorktree.path}
												relativePath={activeSession.selectedFilePath}
												resolvedTheme={resolvedTheme}
												onEditFile={openEditorForFile}
											/>
										) : activeSession?.reviewMode === "changes" &&
										  diffState.data ? (
											<DiffViewer
												path={diffState.data.path}
												content={diffState.data.content}
												originalContent={diffState.data.originalContent}
												modifiedContent={diffState.data.modifiedContent}
												resolvedTheme={resolvedTheme}
											/>
										) : (
											<p className="shell-empty-state">
												Select a file or changed file to inspect it.
											</p>
										)}
									</section>
								</div>
							</Tabs.Root>
						</ReviewDrawer>
					)}
				</section>
			</div>

			<PresetManager
				open={presetManagerOpen}
				presets={workspaceState.commandPresets}
				onOpenChange={setPresetManagerOpen}
				onSave={(preset) => dispatch({ type: "preset/upsert", preset })}
				onDelete={(presetId) => dispatch({ type: "preset/remove", presetId })}
				onLaunch={(presetId) => {
					setPresetManagerOpen(false);
					handleLaunchPreset(presetId);
				}}
			/>
			<LoadWorkspaceDialog
				open={workspacePickerOpen}
				onOpenChange={setWorkspacePickerOpen}
				onLoadPath={(path) => handleLoadPath(path)}
			/>
			<NewWorktreeDialog
				open={createDialogOpen}
				name={createName}
				sessionTitle={createSessionTitle}
				preview={createPreview}
				loading={createLoading}
				error={createError}
				busy={createBusy}
				onOpenChange={(open) => {
					setCreateDialogOpen(open);
					if (!open) {
						setCreateName("");
						setCreateSessionTitle("");
						setCreateError(null);
					}
				}}
				onNameChange={setCreateName}
				onSessionTitleChange={setCreateSessionTitle}
				onConfirm={() => {
					void handleConfirmCreateWorktree();
				}}
			/>
			<RemoveWorktreeDialog
				open={removeDialogOpen}
				preview={removePreview}
				runningProcessLabels={
					removeTargetId
						? (
								workspaceState.sessionsByWorktreeId[removeTargetId]
									?.processSessionIds ?? []
							)
								.map((id) => workspaceState.processSessionsById[id])
								.filter(
									(process): process is ProcessSession =>
										!!process && process.status === "running",
								)
								.map((process) => process.label)
						: []
				}
				error={removeError}
				busy={removeBusy}
				confirmedDirty={confirmedDirtyRemoval}
				onConfirmedDirtyChange={setConfirmedDirtyRemoval}
				onOpenChange={(open) => {
					setRemoveDialogOpen(open);
					if (!open) {
						setRemoveTargetId(null);
						setConfirmedDirtyRemoval(false);
					}
				}}
				onConfirm={() => {
					void handleConfirmRemoveWorktree();
				}}
			/>
			<DiscardChangeDialog
				open={discardPath !== null}
				relativePath={discardPath}
				onOpenChange={(open) => {
					if (!open) setDiscardPath(null);
				}}
				onConfirm={handleDiscardChange}
			/>
		</main>
	);
}
