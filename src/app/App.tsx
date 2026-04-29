import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { Worktree } from "../../shared/models/worktree";
import type { TerminalSession } from "../../shared/models/terminal-session";
import type {
	PersistedWorktreeSession,
	PersistedSavedWorkspace,
	RestorePreference,
	WorkspaceSnapshot,
	PersistedWorkspaceStateV2,
} from "../../shared/models/persisted-workspace-state";
import {
	buildSavedWorkspace,
	buildWorktreeIdRebaseMapping,
	rebaseSnapshotPaths,
	reconcileSnapshotToWorktrees,
	shouldReattachSnapshot,
	splitPendingRestores,
} from "../features/workspace/logic/workspace-persistence";
import { RepositoryInput } from "../features/repository/RepositoryInput";
import { RestorePrompt } from "../features/repository/RestorePrompt";
import { isEditable } from "../../shared/editor/editable-files";
import { type SessionSidebarWorkspace } from "../features/workspace/components/SessionSidebar";
import {
	createWorkspaceState,
	workspaceReducer,
	type WorkspaceAction,
	type WorkspaceState,
} from "../features/workspace/logic/workspace-state";
import { PresetManager } from "../features/terminals/components/PresetManager";
import {
	type ReviewExpandedPortalHandle,
} from "../features/review/components/ReviewExpandedPortal";
import { useReviewDrawerAutoExpand } from "../features/review/hooks/use-review-drawer-auto-expand";
import { useReviewComments } from "../features/review/hooks/use-review-comments";
import { type NewCommentDraft } from "../features/review/components/ReviewCommentSidebar";
import { type SelectionDraft } from "../features/review/logic/diff-editor-decorations";
import { useAgentInstallStatus } from "../features/review/hooks/use-agent-install-status";
import { buildWorktreeProcessSummary } from "../features/workspace/logic/sidebar-shell-summary";
import { useNoteBridgeReceiver } from "../features/workspace/hooks/use-note-bridge-receiver";
import type { GitChangeStatus } from "../../shared/models/git-change";
import {
	terminals,
	workspace,
	repository as repositoryClient,
	files,
	system,
	reviewComments,
	noteBridge,
} from "../lib/desktop-client";
import { countOpenCommentsInFiles } from "../features/git/logic/commit-list-badge";
import { logRendererShellEvent } from "../features/terminals/logic/shell-event-logger";
import { useTheme } from "../lib/use-theme";
import { describeRepositoryLoadError } from "../features/repository/describe-repository-load-error";
import { detectPlatform } from "./shortcut-registry";
import { useWindowFocus } from "./hooks/use-window-focus";
import { useWorkspacePersistence } from "./hooks/use-workspace-persistence";
import { usePaneResizers } from "./hooks/use-pane-resizers";
import { useChangesRefreshLoop } from "./hooks/use-changes-refresh-loop";
import { useTickingNow } from "./hooks/use-ticking-now";
import { useRemoteStatusLoader } from "./hooks/use-remote-status-loader";
import { useDiffLoader } from "./hooks/use-diff-loader";
import { useCommitHistoryLoader } from "./hooks/use-commit-history-loader";
import { useCommitDetailLoader } from "./hooks/use-commit-detail-loader";
import { useUpdateInfoListener } from "./hooks/use-update-info-listener";
import { useKeyboardShortcut } from "./hooks/use-keyboard-shortcut";
import { useNextPrevShortcut } from "./hooks/use-next-prev-shortcut";
import { useActiveWorkspace } from "./hooks/use-active-workspace";
import { useTerminalRuntime } from "./hooks/use-terminal-runtime";
import { useWorkspacePickerListener } from "./hooks/use-workspace-picker-listener";
import { useInstallModalListener } from "./hooks/use-install-modal-listener";
import { useRendererStartLog } from "./hooks/use-renderer-start-log";
import { useEditFileShortcut } from "./hooks/use-edit-file-shortcut";
import { useGitActions } from "./hooks/use-git-actions";
import { useProcessActions } from "./hooks/use-process-actions";
import { useWorktreeActions } from "./hooks/use-worktree-actions";
import { useStartupRestore } from "./hooks/use-startup-restore";
import { useGitSummaryLoader } from "./hooks/use-git-summary-loader";
import { useDefaultShellOnEmptyWorktree } from "./hooks/use-default-shell-on-empty-worktree";
import { useCreateWorktreePreview } from "./hooks/use-create-worktree-preview";
import { useRemoveWorktreePreview } from "./hooks/use-remove-worktree-preview";
import { DialogStack } from "./components/DialogStack";
import { TerminalPanel } from "./components/TerminalPanel";
import { ReviewDrawerSection } from "./components/ReviewDrawerSection";
import { ReviewArea } from "./components/ReviewArea";
import { SidebarPanel } from "./components/SidebarPanel";
import { MainColumnChrome } from "./components/MainColumnChrome";
import { RestoreBanner } from "./components/RestoreBanner";

type StartupMode = "loading" | "prompt" | "ready";

export function App() {
	const { resolvedTheme } = useTheme();
	const appPlatform = useMemo(detectPlatform, []);
	const {
		reviewRailWidth,
		reviewPanelHeight,
		sidebarWidth,
		handleReviewRailResizeStart,
		handleSidebarResizeStart,
		handleReviewPanelResizeStart,
	} = usePaneResizers({});
	const [reviewExpanded, setReviewExpanded] = useState(false);
	const chipBarRef = useRef<HTMLDivElement>(null);
	const mainColRef = useRef<HTMLElement>(null);
	const expandedPortalRef = useRef<ReviewExpandedPortalHandle>(null);

	function collapseReviewExpanded() {
		if (expandedPortalRef.current) {
			expandedPortalRef.current.collapse();
		} else {
			setReviewExpanded(false);
		}
	}

	const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
	const [pendingRename, setPendingRename] = useState<{
		workspaceId: string;
		worktreeId: string;
	} | null>(null);
	const sidebarNow = useTickingNow(1_000);
	const [noteSheetOpen, setNoteSheetOpen] = useState(false);
	const [filesOverlayOpen, setFilesOverlayOpen] = useState(false);
	const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);
	const updateInfo = useUpdateInfoListener();
	const [updateDismissedFor, setUpdateDismissedFor] = useState<string | null>(
		null,
	);

	const bannerInfo =
		updateInfo && updateInfo.version !== updateDismissedFor ? updateInfo : null;

	// Multi-workspace registry + shadow state
	const {
		appWorkspaces,
		dispatchAppWorkspaces,
		activeWorkspaceId,
		repository,
		worktrees,
		workspaceState,
		dispatch,
		createScopedWorkspaceDispatch,
		getWorkspaceStateById,
		appWorkspacesRef,
		activeWorkspaceStateRef,
		inactiveWorkspaceStatesRef,
		prevActiveWorkspaceIdRef,
		worktreesRef,
		workspaceStateRef,
	} = useActiveWorkspace();
	const outputPreviewBuffersRef = useRef<Map<string, string>>(new Map());
	const [refreshKey, setRefreshKey] = useState(0);
	const [windowFocused, setWindowFocused] = useState(
		typeof document !== "undefined" ? document.hasFocus() : true,
	);

	const [error, setError] = useState<string | null>(null);
	const [presetManagerOpen, setPresetManagerOpen] = useState(false);
	const [createDialogOpen, setCreateDialogOpen] = useState(false);
	const [createName, setCreateName] = useState("");
	const [createSessionTitle, setCreateSessionTitle] = useState("");
	const [createBusy, setCreateBusy] = useState(false);
	const [discardPath, setDiscardPath] = useState<string | null>(null);
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
	const [removeBusy, setRemoveBusy] = useState(false);
	const [confirmedDirtyRemoval, setConfirmedDirtyRemoval] = useState(false);
	const [startupMode, setStartupMode] = useState<StartupMode>("loading");

	useNoteBridgeReceiver({
		startupMode,
		workspaces: {
			forEach(cb) {
				for (const id of appWorkspacesRef.current.workspaceOrder) {
					const state = getWorkspaceStateById(id);
					if (state) cb(id, state);
				}
			},
		},
		dispatchTo: (workspaceId, action) => {
			createScopedWorkspaceDispatch(workspaceId)(action);
		},
		api: noteBridge,
	});

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

	useRendererStartLog(appWorkspacesRef.current.activeWorkspaceId);

	useStartupRestore({
		setStartupMode,
		setStartupError,
		setRestorePreference,
		setSavedSnapshot,
		setSavedDormantWorkspaces,
		restoreWorkspace,
	});

	useWorkspacePickerListener({
		startupMode,
		onOpen: () => {
			setError(null);
			setStartupError(null);
			setWorkspacePickerOpen(true);
		},
	});

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

	// ---------------------------------------------------------------------------
	// Review comments / diff affordances
	// ---------------------------------------------------------------------------
	const reviewState = useReviewComments(activeWorktree?.id ?? null);
	const openCommentCounts = useMemo(() => {
		const counts: Record<string, number> = {};
		for (const c of reviewState.comments) {
			if (c.status === "open") {
				counts[c.filePath] = (counts[c.filePath] ?? 0) + 1;
			}
		}
		return counts;
	}, [reviewState.comments]);
	const commitDetailState = useCommitDetailLoader({
		workspaceId: activeWorkspaceId,
		worktreeId: activeWorktree?.id,
		selectedCommitSha: activeSession?.selectedCommitSha,
	});

	const selectedCommitOpenCommentCount = useMemo(() => {
		if (!activeSession?.selectedCommitSha || !commitDetailState.data) return 0;
		const filePaths = commitDetailState.data.files.map((f) => f.path);
		return countOpenCommentsInFiles(filePaths, openCommentCounts);
	}, [
		activeSession?.selectedCommitSha,
		commitDetailState.data,
		openCommentCounts,
	]);
	const [addingDraft, setAddingDraft] = useState<NewCommentDraft | null>(null);
	const [selectionDraft, setSelectionDraft] = useState<SelectionDraft>(null);
	const agentInstallStatus = useAgentInstallStatus();
	// providers starts as [] before the first refresh resolves. length > 0 guards
	// against that window, so the CTA is hidden during initial load rather than
	// flickering visible before providers are known.
	const installCtaVisible =
		agentInstallStatus.providers.length > 0 &&
		agentInstallStatus.providers.every((p) => !p.installed);
	const [installModalOpen, setInstallModalOpen] = useState(false);
	const [commentSidebarOpen, setCommentSidebarOpen] = useState(false);

	useInstallModalListener(useCallback(() => setInstallModalOpen(true), []));

	useEffect(() => {
		const currentFilePath =
			activeSession?.reviewMode === "commits"
				? (activeSession.selectedCommitFilePath ?? null)
				: (activeSession?.selectedChangedFilePath ?? null);
		const hasComments =
			currentFilePath !== null &&
			reviewState.comments.some((c) => c.filePath === currentFilePath);
		setCommentSidebarOpen(hasComments || addingDraft !== null);
	}, [
		activeSession?.reviewMode,
		activeSession?.selectedCommitFilePath,
		activeSession?.selectedChangedFilePath,
		reviewState.comments,
		addingDraft,
	]);

	const openEditorForFile = useCallback(
		async (relativePath: string) => {
			if (!activeWorktree || !activeWorkspaceId) return;
			const basename = relativePath.split("/").pop() ?? "";
			if (!isEditable(basename)) return;
			try {
				const res = await files.openForEdit(
					activeWorkspaceId,
					activeWorktree.id,
					relativePath,
				);
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

	useEditFileShortcut({
		editorOpen: editorTarget !== null,
		selectedFilePath: activeSession?.selectedFilePath ?? null,
		onOpen: openEditorForFile,
	});

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
		findProcessByTerminalSessionId,
	} = useTerminalRuntime({
		appWorkspacesRef,
		inactiveWorkspaceStatesRef,
		dispatch,
		dispatchAppWorkspaces,
		getVisibleProcessIds: () => visibleProcessIds,
		getActiveWorktreeId: () => activeWorktree?.id,
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

		// Prime the shadow ref for any async dispatch calls that follow.
		prevActiveWorkspaceIdRef.current = newWorkspaceId;
		activeWorkspaceStateRef.current = freshState;

		resetDefaultShellEnsured();
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

	useWorkspacePersistence({
		startupMode,
		persistableState: persistableStateV2,
		persistableStateJson,
	});

	const {
		handleAddAdHoc,
		handleCloseProcess,
		handleLaunchPreset,
		handleStopProcess,
		handleRestartProcess,
	} = useProcessActions({
		workspaceId: activeWorkspaceId,
		worktree: activeWorktree,
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
	});

	const {
		resetAll: resetDefaultShellEnsured,
		forgetWorktree: forgetDefaultShellEnsuredForWorktree,
	} = useDefaultShellOnEmptyWorktree({
		startupMode,
		activeWorktreeId: activeWorktree?.id,
		activeSessionProcessCount: activeSession?.processSessionIds.length ?? 0,
		hasActiveSession: !!activeSession,
		createDefaultShell: handleAddAdHoc,
	});

	useGitSummaryLoader({
		workspaceId: activeWorkspaceId,
		worktreeId: activeWorktree?.id,
		refreshKey,
		dispatch,
	});

	const {
		preview: createPreview,
		loading: createLoading,
		error: createError,
		setPreview: setCreatePreview,
		setError: setCreateError,
	} = useCreateWorktreePreview({
		open: createDialogOpen,
		name: createName,
		workspaceId: activeWorkspaceId,
	});

	const {
		preview: removePreview,
		error: removeError,
		setPreview: setRemovePreview,
		setError: setRemoveError,
	} = useRemoveWorktreePreview({
		open: removeDialogOpen,
		worktreeId: removeTargetId,
		workspaceId: activeWorkspaceId,
	});

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

	const { handleRefreshChanges, handleDiscardChange, handlePushBranch } =
		useGitActions({
			workspaceId: activeWorkspaceId,
			worktreeId: activeWorktree?.id,
			discardPath,
			refreshWorktreeInventory,
			bumpRefreshKey: useCallback(() => setRefreshKey((k) => k + 1), []),
		});

	useWindowFocus({
		setWindowFocused,
		appWorkspacesRef,
		activeWorkspaceStateRef,
	});

	useChangesRefreshLoop({
		startupMode,
		repository,
		activeWorktree,
		windowFocused,
		onRefresh: handleRefreshChanges,
	});

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

	const { handleConfirmCreateWorktree, handleConfirmRemoveWorktree } =
		useWorktreeActions({
		workspaceId: activeWorkspaceId,
		workspaceStateRef,
		createPreview,
		createName,
		createSessionTitle,
		setCreateBusy,
		setCreateDialogOpen,
		setCreateName,
		setCreateSessionTitle,
		setCreatePreview,
		setCreateError,
		removePreview,
		setRemoveBusy,
		setRemoveDialogOpen,
		setRemoveTargetId,
		setRemovePreview,
		setRemoveError,
		dispatch,
		stopSession,
		removeSession,
		forgetDefaultShellEnsuredForWorktree,
		refreshWorktreeInventory,
	});

	const diffState = useDiffLoader({
		workspaceId: activeWorkspaceId,
		worktreeId: activeWorktree?.id,
		selectedChangedFilePath: activeSession?.selectedChangedFilePath,
		changes,
	});

	const commitHistoryState = useCommitHistoryLoader({
		workspaceId: activeWorkspaceId,
		worktreeId: activeWorktree?.id,
		refreshKey,
		selectedCommitSha: activeSession?.selectedCommitSha,
		onClearStaleSelectedCommit: () => {
			if (activeWorktree?.id) {
				dispatch({
					type: "session/clearSelectedCommit",
					worktreeId: activeWorktree.id,
				});
			}
		},
	});

	const remoteStatus = useRemoteStatusLoader({
		workspaceId: activeWorkspaceId,
		worktreeId: activeWorktree?.id,
		refreshKey,
	});

	// Cmd+; / Ctrl+; — toggle note sheet
	useKeyboardShortcut(
		"note-sheet",
		appPlatform,
		(e) => {
			e.preventDefault();
			setNoteSheetOpen((prev) => !prev);
		},
		[],
	);

	// Cmd+P / Ctrl+Shift+P — open Files overlay
	useKeyboardShortcut(
		"files-overlay",
		appPlatform,
		(e) => {
			if (!activeWorktree) return;
			e.preventDefault();
			setFilesOverlayOpen(true);
		},
		[activeWorktree?.id],
	);

	// Cmd+J / Ctrl+J — toggle review drawer
	useKeyboardShortcut(
		"review-drawer",
		appPlatform,
		(e) => {
			if (!activeWorktree) return;
			e.preventDefault();
			const session =
				workspaceStateRef.current.sessionsByWorktreeId[activeWorktree.id];
			const currentlyOpen = session?.reviewDrawerOpen ?? false;
			const next = !currentlyOpen;
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
		},
		[activeWorktree?.id, activeSummary?.isDirty, autoExpand, dispatch],
	);

	// Cmd+Shift+J / Ctrl+Shift+J — toggle review expand mode
	useKeyboardShortcut(
		"review.expand",
		appPlatform,
		(e) => {
			if (!activeWorktree) return;
			e.preventDefault();
			if (reviewExpanded) {
				collapseReviewExpanded();
			} else {
				setReviewExpanded(true);
			}
		},
		[activeWorktree?.id, reviewExpanded],
	);

	// Cmd+Shift+R / Ctrl+Alt+R — rename active session
	useKeyboardShortcut(
		"rename-session",
		appPlatform,
		(e) => {
			if (!activeWorkspaceId || !activeWorktree) return;
			e.preventDefault();
			setSidebarCollapsed(false);
			setPendingRename({
				workspaceId: activeWorkspaceId,
				worktreeId: activeWorktree.id,
			});
		},
		[activeWorkspaceId, activeWorktree?.id],
	);

	// Cmd+/ or Cmd+? / Ctrl+/ or Ctrl+? — show shortcuts help
	useKeyboardShortcut(
		"shortcuts-help",
		appPlatform,
		(e) => {
			e.preventDefault();
			setShortcutsHelpOpen((prev) => !prev);
		},
		[],
	);

	// Cmd+] / Ctrl+] and Cmd+[ / Ctrl+[ — cycle through worktrees
	useNextPrevShortcut(
		"worktree.selectNext",
		"worktree.selectPrev",
		appPlatform,
		(e, direction) => {
			const wts = worktreesRef.current;
			const currentId = workspaceStateRef.current.selectedWorktreeId;
			if (!wts.length || !currentId) return;
			const idx = wts.findIndex((w) => w.id === currentId);
			if (idx === -1) return;
			const nextIdx =
				direction === "next"
					? (idx + 1) % wts.length
					: (idx - 1 + wts.length) % wts.length;
			const nextId = wts[nextIdx]?.id;
			if (!nextId) return;
			e.preventDefault();
			dispatch({ type: "session/selectWorktree", worktreeId: nextId });
		},
		[dispatch],
	);

	// Cmd+N / Ctrl+N — add worktree
	useKeyboardShortcut(
		"worktree.add",
		appPlatform,
		(e) => {
			if (!activeWorkspaceId) return;
			e.preventDefault();
			setCreateDialogOpen(true);
		},
		[activeWorkspaceId],
	);

	// Cmd+Shift+] / Ctrl+Shift+] and Cmd+Shift+[ / Ctrl+Shift+[ — cycle through workspaces
	useNextPrevShortcut(
		"workspace.selectNext",
		"workspace.selectPrev",
		appPlatform,
		(e, direction) => {
			const order = appWorkspacesRef.current.workspaceOrder;
			const currentId = appWorkspacesRef.current.activeWorkspaceId;
			if (order.length < 2 || !currentId) return;
			const idx = order.indexOf(currentId);
			if (idx === -1) return;
			const nextIdx =
				direction === "next"
					? (idx + 1) % order.length
					: (idx - 1 + order.length) % order.length;
			const nextId = order[nextIdx];
			if (!nextId) return;
			e.preventDefault();
			void activateWorkspace(nextId);
		},
		// activateWorkspace reads from refs internally — stale closure is safe
		[],
	);

	// Cmd+O / Ctrl+O — open workspace picker (menu accelerator already fires
	// this via IPC; this handler covers the renderer path for completeness)
	useKeyboardShortcut(
		"ui.openWorkspacePicker",
		appPlatform,
		(e) => {
			if (startupMode !== "ready") return;
			e.preventDefault();
			setWorkspacePickerOpen(true);
		},
		[startupMode],
	);

	// Cmd+T / Ctrl+T — new terminal
	useKeyboardShortcut(
		"terminal.new",
		appPlatform,
		(e) => {
			e.preventDefault();
			void handleAddAdHoc();
		},
		[activeWorktree?.id, activeWorkspaceId],
	);

	// Cmd+Shift+W / Ctrl+Shift+W — close active terminal
	useKeyboardShortcut(
		"terminal.close",
		appPlatform,
		(e) => {
			const currentState = workspaceStateRef.current;
			const currentWorktreeId = currentState.selectedWorktreeId;
			if (!currentWorktreeId) return;
			const activeProcessId =
				currentState.sessionsByWorktreeId[currentWorktreeId]
					?.activeProcessSessionId;
			if (!activeProcessId) return;
			e.preventDefault();
			void handleCloseProcess(activeProcessId);
		},
		[activeWorktree?.id, activeWorkspaceId],
	);

	// Cmd+Shift+D / Ctrl+Shift+D and Cmd+Shift+A / Ctrl+Shift+A — cycle through terminals
	useNextPrevShortcut(
		"terminal.selectNext",
		"terminal.selectPrev",
		appPlatform,
		(e, direction) => {
			const currentState = workspaceStateRef.current;
			const currentWorktreeId = currentState.selectedWorktreeId;
			if (!currentWorktreeId) return;
			const session = currentState.sessionsByWorktreeId[currentWorktreeId];
			if (!session) return;
			const processes = (session.processSessionIds ?? [])
				.map((id) => currentState.processSessionsById[id])
				.filter(Boolean)
				.sort((a, b) => Number(b.pinned) - Number(a.pinned));
			if (processes.length < 2) return;
			const currentProcessId = session.activeProcessSessionId;
			const idx = processes.findIndex((p) => p.id === currentProcessId);
			const nextIdx =
				direction === "next"
					? (idx + 1) % processes.length
					: (idx - 1 + processes.length) % processes.length;
			const nextProcessId = processes[nextIdx]?.id;
			if (!nextProcessId) return;
			e.preventDefault();
			dispatch({
				type: "session/selectProcess",
				worktreeId: currentWorktreeId,
				processId: nextProcessId,
			});
			dispatch({
				type: "session/markProcessViewed",
				worktreeId: currentWorktreeId,
				processId: nextProcessId,
			});
		},
		[dispatch],
	);

	// Cmd+D / Ctrl+D — toggle split terminal mode
	useKeyboardShortcut(
		"terminal.toggleSplit",
		appPlatform,
		(e) => {
			const currentState = workspaceStateRef.current;
			const currentWorktreeId = currentState.selectedWorktreeId;
			if (!currentWorktreeId) return;
			const session = currentState.sessionsByWorktreeId[currentWorktreeId];
			if (!session) return;
			e.preventDefault();
			const isSplit = session.terminalLayoutMode === "split";
			const processes = (session.processSessionIds ?? [])
				.map((id) => currentState.processSessionsById[id])
				.filter(Boolean)
				.sort((a, b) => Number(b.pinned) - Number(a.pinned));
			dispatch({
				type: "session/setTerminalLayoutMode",
				worktreeId: currentWorktreeId,
				layoutMode: isSplit ? "single" : "split",
				autoAssignProcessIds:
					!isSplit &&
					!session.splitLeftProcessId &&
					!session.splitRightProcessId &&
					processes.length === 2
						? processes.map((p) => p.id)
						: undefined,
			});
		},
		[dispatch],
	);

	// Cmd+B / Ctrl+B — toggle sidebar
	useKeyboardShortcut(
		"layout.toggleSidebar",
		appPlatform,
		(e) => {
			e.preventDefault();
			setSidebarCollapsed((current) => !current);
		},
		[],
	);

	// Cmd+1/2/3 / Ctrl+1/2/3 — switch review pane tab and open drawer
	const switchReviewMode = useCallback(
		(reviewMode: "files" | "changes" | "commits") =>
			(e: KeyboardEvent) => {
				const currentState = workspaceStateRef.current;
				const currentWorktreeId = currentState.selectedWorktreeId;
				if (!currentWorktreeId) return;
				e.preventDefault();
				const session = currentState.sessionsByWorktreeId[currentWorktreeId];
				dispatch({
					type: "session/setReviewMode",
					worktreeId: currentWorktreeId,
					reviewMode,
				});
				if (!(session?.reviewDrawerOpen ?? false)) {
					autoExpand.noteUserExpand(currentWorktreeId);
					dispatch({
						type: "session/setReviewDrawerOpen",
						worktreeId: currentWorktreeId,
						open: true,
					});
				}
			},
		[autoExpand, dispatch, workspaceStateRef],
	);
	useKeyboardShortcut("review.files", appPlatform, switchReviewMode("files"), [
		switchReviewMode,
	]);
	useKeyboardShortcut(
		"review.changes",
		appPlatform,
		switchReviewMode("changes"),
		[switchReviewMode],
	);
	useKeyboardShortcut(
		"review.commits",
		appPlatform,
		switchReviewMode("commits"),
		[switchReviewMode],
	);

	function handleSelectChangedFile(relativePath: string) {
		if (!activeWorktree) return;
		dispatch({
			type: "session/selectChangedFile",
			worktreeId: activeWorktree.id,
			relativePath,
		});
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
			<RestoreBanner
				message={restoreWarning}
				onDismiss={() => setRestoreWarning(null)}
			/>
			<div
				className="shell-layout"
				data-testid="shell-layout"
				style={{
					gridTemplateColumns: `${
						sidebarCollapsed ? 68 : sidebarWidth
					}px minmax(0, 1fr)`,
				}}
			>
				<SidebarPanel
					sidebarWorkspaces={sidebarWorkspaces}
					sidebarCollapsed={sidebarCollapsed}
					setSidebarCollapsed={setSidebarCollapsed}
					handleSidebarResizeStart={handleSidebarResizeStart}
					activeWorkspaceId={activeWorkspaceId}
					pendingRename={pendingRename}
					setPendingRename={setPendingRename}
					openWorkspacePicker={() => setWorkspacePickerOpen(true)}
					openCreateWorktreeDialog={() => setCreateDialogOpen(true)}
					openRemoveWorktreeDialog={(worktreeId) => {
						setRemoveTargetId(worktreeId);
						setConfirmedDirtyRemoval(false);
						setRemoveDialogOpen(true);
					}}
					activateWorkspace={activateWorkspace}
					handleSelectSidebarWorktree={handleSelectSidebarWorktree}
					handleRemoveWorkspace={handleRemoveWorkspace}
					dispatch={dispatch}
				/>

				<section className="shell-main-column" ref={mainColRef}>
					<MainColumnChrome
						bannerInfo={bannerInfo}
						updateInfoVersion={updateInfo?.version ?? null}
						setUpdateDismissedFor={setUpdateDismissedFor}
						onOpenExternal={(url) => void system.openExternal(url)}
						chipBarRef={chipBarRef}
						activeWorktree={activeWorktree}
						activeSession={activeSession ?? null}
						activeSummary={activeSummary}
						changedFileCount={changes.length}
						activeWorkspaceId={activeWorkspaceId}
						setSidebarCollapsed={setSidebarCollapsed}
						setPendingRename={setPendingRename}
						autoExpand={autoExpand}
						dispatch={dispatch}
						noteSheetOpen={noteSheetOpen}
						setNoteSheetOpen={setNoteSheetOpen}
						filesOverlayOpen={filesOverlayOpen}
						setFilesOverlayOpen={setFilesOverlayOpen}
						trackedFilesLoader={trackedFilesLoader}
						gitStatusMap={gitStatusMap}
						openEditorForFile={openEditorForFile}
						shortcutsHelpOpen={shortcutsHelpOpen}
						setShortcutsHelpOpen={setShortcutsHelpOpen}
						appPlatform={appPlatform}
					/>

					<TerminalPanel
						workspaceState={workspaceState}
						activeWorktree={activeWorktree}
						activeSession={activeSession ?? null}
						activeProcesses={activeProcesses}
						visibleProcessIds={visibleProcessIds}
						sessions={sessions}
						orderedSessions={orderedSessions}
						dispatch={dispatch}
						handleAddAdHoc={handleAddAdHoc}
						selectActiveProcess={selectActiveProcess}
						handleLaunchPreset={handleLaunchPreset}
						handleCloseProcess={handleCloseProcess}
						handleStopProcess={handleStopProcess}
						handleRestartProcess={handleRestartProcess}
						openPresetManager={() => setPresetManagerOpen(true)}
						findProcessByTerminalSessionId={findProcessByTerminalSessionId}
					/>


					<ReviewDrawerSection
						activeWorktree={activeWorktree}
						activeSession={activeSession ?? null}
						activeSummary={activeSummary}
						changedFileCount={changes.length}
						reviewState={reviewState}
						reviewPanelHeight={reviewPanelHeight}
						onResizeStart={handleReviewPanelResizeStart}
						reviewExpanded={reviewExpanded}
						setReviewExpanded={setReviewExpanded}
						collapseReviewExpanded={collapseReviewExpanded}
						expandedPortalRef={expandedPortalRef}
						mainColRef={mainColRef}
						chipBarRef={chipBarRef}
						commentSidebarOpen={commentSidebarOpen}
						setCommentSidebarOpen={setCommentSidebarOpen}
						autoExpand={autoExpand}
						dispatch={dispatch}
						handleRefreshChanges={handleRefreshChanges}
					>
						{activeWorktree && (
							<ReviewArea
								activeWorktree={activeWorktree}
								activeSession={activeSession ?? null}
								activeWorkspaceId={activeWorkspaceId}
								workspaceState={workspaceState}
								changes={changes}
								openCommentCounts={openCommentCounts}
								commitHistoryState={commitHistoryState}
								commitDetailState={commitDetailState}
								diffState={diffState}
								remoteStatus={remoteStatus}
								selectedCommitOpenCommentCount={
									selectedCommitOpenCommentCount
								}
								gitSummaryError={gitSummaryError}
								gitSummaryMessage={gitSummaryMessage}
								gitSummaryStale={gitSummaryStale}
								reviewState={reviewState}
								reviewRailWidth={reviewRailWidth}
								handleReviewRailResizeStart={handleReviewRailResizeStart}
								commentSidebarOpen={commentSidebarOpen}
								resolvedTheme={resolvedTheme}
								editorTarget={editorTarget}
								setEditorTarget={setEditorTarget}
								openEditorForFile={openEditorForFile}
								openEditorError={openEditorError}
								setOpenEditorError={setOpenEditorError}
								installCtaVisible={installCtaVisible}
								onOpenInstall={() => setInstallModalOpen(true)}
								dispatch={dispatch}
								handlePushBranch={handlePushBranch}
								handleSelectChangedFile={handleSelectChangedFile}
								setDiscardPath={setDiscardPath}
								bumpRefreshKey={() => setRefreshKey((k) => k + 1)}
								addingDraft={addingDraft}
								setAddingDraft={setAddingDraft}
								selectionDraft={selectionDraft}
								setSelectionDraft={setSelectionDraft}
							/>
						)}
					</ReviewDrawerSection>
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
			<DialogStack
				workspacePickerOpen={workspacePickerOpen}
				setWorkspacePickerOpen={setWorkspacePickerOpen}
				handleLoadPath={handleLoadPath}
				createDialogOpen={createDialogOpen}
				setCreateDialogOpen={setCreateDialogOpen}
				createName={createName}
				setCreateName={setCreateName}
				createSessionTitle={createSessionTitle}
				setCreateSessionTitle={setCreateSessionTitle}
				createPreview={createPreview}
				createLoading={createLoading}
				createError={createError}
				setCreateError={setCreateError}
				createBusy={createBusy}
				handleConfirmCreateWorktree={handleConfirmCreateWorktree}
				removeDialogOpen={removeDialogOpen}
				setRemoveDialogOpen={setRemoveDialogOpen}
				removePreview={removePreview}
				removeError={removeError}
				removeBusy={removeBusy}
				removeTargetId={removeTargetId}
				setRemoveTargetId={setRemoveTargetId}
				confirmedDirtyRemoval={confirmedDirtyRemoval}
				setConfirmedDirtyRemoval={setConfirmedDirtyRemoval}
				workspaceState={workspaceState}
				handleConfirmRemoveWorktree={handleConfirmRemoveWorktree}
				discardPath={discardPath}
				setDiscardPath={setDiscardPath}
				handleDiscardChange={handleDiscardChange}
				installModalOpen={installModalOpen}
				setInstallModalOpen={setInstallModalOpen}
				agentInstallStatus={agentInstallStatus}
			/>
		</main>
	);
}
