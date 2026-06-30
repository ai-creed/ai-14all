import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
	PersistedWorktreeSession,
	PersistedSavedWorkspace,
	PersistedWorkspaceStateV2,
	RestorePreference,
	WorkspaceSnapshot,
} from "../../shared/models/persisted-workspace-state";
import { buildSavedWorkspace } from "../features/workspace/logic/workspace-persistence";
import { RepositoryInput } from "../features/repository/RepositoryInput";
import { RestorePrompt } from "../features/repository/RestorePrompt";
import { type SessionSidebarWorkspace } from "../features/workspace/components/SessionSidebar";
import { sortSidebarWorkspaces } from "../features/workspace/logic/sort-sidebar-workspaces";
import { useCollapsedWorkspaces } from "../features/workspace/logic/use-collapsed-workspaces";
import {
	workspaceReducer,
	MAX_FLOATING_SHELLS,
} from "../features/workspace/logic/workspace-state";
import { PresetManager } from "../features/terminals/components/PresetManager";
import {
	ReviewExpandedPortal,
	type ReviewExpandedPortalHandle,
} from "../features/review/components/ReviewExpandedPortal";
import { useReviewComments } from "../features/review/hooks/use-review-comments";
import { CodeNavHygiene } from "../features/code-nav/CodeNavHygiene";
import { type NewCommentDraft } from "./components/ReviewArea";
import { useAgentInstallStatus } from "../features/review/hooks/use-agent-install-status";
import {
	buildWorktreeAttentionDisplay,
	buildWorktreeProcessSummary,
	rollupWorkspaceAttention,
	type SidebarAttentionTier,
	type WorktreeProcessSummary,
} from "../features/workspace/logic/sidebar-shell-summary";
import {
	diffAndAdvanceResolutions,
	type DisplayedAttentionSnapshot,
} from "../features/workspace/logic/resolution-emitter";
import type { ProcessSession } from "../../shared/models/process-session";
import type { WorktreeSession } from "../../shared/models/worktree-session";
import { createSamanthaSliceBuilder } from "../features/workspace/logic/samantha-slice-builder";
import { findWorkspaceForWorktree } from "../features/workspace/logic/focus-target";
import { useNoteBridgeReceiver } from "../features/workspace/hooks/use-note-bridge-receiver";
import { attachAgentAttentionBridge } from "../features/terminals/logic/agent-attention-renderer-bridge";
import type { GitChangeStatus } from "../../shared/models/git-change";
import {
	repository as repositoryClient,
	files,
	system,
	noteBridge,
	agentAttentionBridge,
	diagnostics,
	app as appClient,
	plugins as pluginsClient,
	terminals as terminalsClient,
} from "../lib/desktop-client";
import {
	hasInlineEditorsRegistered,
	runInlineEditorDirtyGate,
} from "../features/viewer/inline-editor-registry";
import { countOpenCommentsInFiles } from "../features/git/logic/commit-list-badge";
import { commandSubmitKey } from "../lib/command-submit-key";
import { useTheme } from "../lib/use-theme";
import { terminalThemeFor } from "../features/terminals/logic/terminal-themes";
import { detectPlatform } from "./shortcut-registry";
import { useWindowFocus } from "./hooks/use-window-focus";
import { useWorkspacePersistence } from "./hooks/use-workspace-persistence";
import { useWorkspaceLifecycle } from "./hooks/use-workspace-lifecycle";
import { useWorkspaceRemoval } from "./hooks/use-workspace-removal";
import { useWorktreeSelection } from "./hooks/use-worktree-selection";
import { usePaneResizers } from "./hooks/use-pane-resizers";
import { useChangesRefreshLoop } from "./hooks/use-changes-refresh-loop";
import { useTickingNow } from "./hooks/use-ticking-now";
import { useRemoteStatusLoader } from "./hooks/use-remote-status-loader";
import { useDiffLoader } from "./hooks/use-diff-loader";
import { useCommitHistoryLoader } from "./hooks/use-commit-history-loader";
import { useCommitDetailLoader } from "./hooks/use-commit-detail-loader";
import { useUpdateInfoListener } from "./hooks/use-update-info-listener";
import { useUpdateDownloadedListener } from "./hooks/use-update-downloaded-listener";
import { useKeyboardShortcut } from "./hooks/use-keyboard-shortcut";
import { useNextPrevShortcut } from "./hooks/use-next-prev-shortcut";
import { useActiveWorkspace } from "./hooks/use-active-workspace";
import { useTerminalRuntime } from "./hooks/use-terminal-runtime";
import { useWorkspacePickerListener } from "./hooks/use-workspace-picker-listener";
import { useInstallModalListener } from "./hooks/use-install-modal-listener";
import { useRendererStartLog } from "./hooks/use-renderer-start-log";
import { useGitActions } from "./hooks/use-git-actions";
import { useProcessActions } from "./hooks/use-process-actions";
import { useWorktreeActions } from "./hooks/use-worktree-actions";
import { useStartupRestore } from "./hooks/use-startup-restore";
import { useGitSummaryLoader } from "./hooks/use-git-summary-loader";
import { useDefaultShellOnEmptyWorktree } from "./hooks/use-default-shell-on-empty-worktree";
import { useCreateWorktreePreview } from "./hooks/use-create-worktree-preview";
import { useBaseBranchOptions } from "./hooks/use-base-branch-options";
import { useRemoveWorktreePreview } from "./hooks/use-remove-worktree-preview";
import { DialogStack } from "./components/DialogStack";
import { ToastProvider, notifyToast } from "../features/ui/toast/ToastProvider";
import { TerminalPanel } from "./components/TerminalPanel";
import { TerminalActions } from "../features/terminals/components/TerminalActions";
import { FloatingShellPills } from "../features/terminals/components/FloatingShellPills";
import { FloatingShellPopover } from "../features/terminals/components/FloatingShellPopover";
import type { Size } from "../features/terminals/logic/floating-shell-resize";
import { useFloatingShellActions } from "./hooks/use-floating-shell-actions";
import { AgentLauncherBar } from "../features/terminals/components/AgentLauncherBar";
import {
	type AgentProvider,
	boundCount,
	decideLaunch,
	visibleProviders,
} from "../features/terminals/logic/agent-launch";
import { providerDef } from "../../shared/models/agent-provider";
import { useMountPendingGuard } from "../features/terminals/logic/use-mount-pending-guard";
import { useDeferredMount } from "../features/terminals/logic/use-deferred-mount";
import { resolvePresetLaunch } from "../features/terminals/logic/preset-launch";
import { TerminalChromeHeader } from "../features/terminals/components/TerminalChromeHeader";
import { TerminalLayoutDialog } from "../features/terminals/components/TerminalLayoutDialog";
import { PluginsPanelDialog } from "../features/plugins/components/PluginsPanelDialog";
import {
	useWhisperState,
	type WhisperAttentionDispatch,
} from "../features/workflows/hooks/use-whisper-state";
import type { AgentCliProbes } from "../../shared/models/ecosystem-plugin";
import { WorkflowDetail } from "../features/workflows/components/WorkflowDetail";
import { toWorkflowRow } from "../features/workflows/logic/workflow-lens";
import { usePluginsState } from "../features/plugins/hooks/use-plugins-state";
import type { LayoutId } from "../../shared/models/terminal-layout";
import type { TerminalSession } from "../../shared/models/terminal-session";
import { ReviewChipBar } from "./components/ReviewChipBar";
import { firstViewableChangedFile } from "./logic/review-chip-target";
import { ReviewArea } from "./components/ReviewArea";
import { SidebarPanel } from "./components/SidebarPanel";
import { MainColumnChrome } from "./components/MainColumnChrome";
import { RestoreBanner } from "./components/RestoreBanner";
import { AgentAttentionBanner } from "./components/AgentAttentionBanner";
import { normalizeTerminalTitle } from "./normalize-terminal-title";
import { CommandPalette } from "../features/command-palette/components/CommandPalette";
import { useRegisterCommands } from "../features/command-palette/hooks/use-command-registry";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Command } from "../features/command-palette/logic/command";

type StartupMode = "loading" | "prompt" | "ready";

/**
 * Stable no-op handed to inactive workspaces' (hidden) terminal panels for
 * interactive callbacks that can only be triggered by clicking visible chrome.
 */
const NOOP = () => {};

export function App() {
	const { resolvedTheme, palette, setTheme } = useTheme();
	const terminalTheme = useMemo(() => terminalThemeFor(palette), [palette]);
	const appPlatform = useMemo(detectPlatform, []);
	const {
		reviewRailWidth,
		sidebarWidth,
		handleReviewRailResizeStart,
		handleSidebarResizeStart,
	} = usePaneResizers({});
	const [reviewOpen, setReviewOpen] = useState(false);
	const chipBarRef = useRef<HTMLDivElement>(null);
	const mainColRef = useRef<HTMLElement>(null);
	const expandedPortalRef = useRef<ReviewExpandedPortalHandle>(null);

	function collapseReview() {
		if (expandedPortalRef.current) {
			expandedPortalRef.current.collapse();
		} else {
			setReviewOpen(false);
		}
	}

	const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
	const {
		collapsedIds: collapsedWorkspaceIds,
		toggle: toggleWorkspaceCollapsed,
	} = useCollapsedWorkspaces();
	const [pendingRename, setPendingRename] = useState<{
		workspaceId: string;
		worktreeId: string;
	} | null>(null);
	const sidebarNow = useTickingNow(1_000);
	const [noteSheetOpen, setNoteSheetOpen] = useState(false);
	const [filesOverlayOpen, setFilesOverlayOpen] = useState(false);
	const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);
	const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
	const updateInfo = useUpdateInfoListener();
	const updateDownloaded = useUpdateDownloadedListener();
	const [updateDismissedFor, setUpdateDismissedFor] = useState<string | null>(
		null,
	);

	const downloadedBannerInfo =
		updateDownloaded && updateDownloaded.version !== updateDismissedFor
			? updateDownloaded
			: null;
	// While downloading, only show the indicator until the download completes.
	const downloadingBannerInfo =
		updateInfo && !downloadedBannerInfo ? updateInfo : null;

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
	const samanthaSliceBuilder = useRef(createSamanthaSliceBuilder());
	const outputPreviewBuffersRef = useRef<Map<string, string>>(new Map());
	// Memory-only per-shell dragged positions for floating popovers, keyed by
	// process id. Survives minimize/restore + worktree switch within the session;
	// not persisted across app restart (floating shells are memory-only).
	const floatingPositionsRef = useRef<
		Map<string, { left: number; top: number }>
	>(new Map());
	// One shared throwaway-popover size for the session (memory-only, like
	// floatingPositionsRef). Resizing any popover updates it; the next popover
	// opens at it.
	const floatingSharedSizeRef = useRef<Size | null>(null);
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

	// App-close gate: main fires `app:requestClose` when one or more InlineEditors
	// are dirty. We iterate the renderer registry, calling `requestSwitch` on
	// each. If every switch resolves to "proceed" we tell main to proceed;
	// otherwise the close is cancelled. requestSwitch itself drives the per-
	// editor ConfirmCloseDialog (Save / Discard / Cancel).
	useEffect(() => {
		return appClient.onRequestClose(() => {
			void (async () => {
				const result = await runInlineEditorDirtyGate();
				appClient.confirmClose({ proceed: result === "proceed" });
			})();
		});
	}, []);

	useEffect(() => {
		if (startupMode !== "ready") return;
		const dispose = attachAgentAttentionBridge({
			dispatchToWorktree: (worktreeId, action) => {
				for (const wsId of appWorkspacesRef.current.workspaceOrder) {
					const ws = appWorkspacesRef.current.workspacesById[wsId];
					if (ws?.workspaceState?.sessionsByWorktreeId[worktreeId]) {
						createScopedWorkspaceDispatch(wsId)(action);
						return true;
					}
				}
				return false;
			},
			bridge: agentAttentionBridge,
		});
		let called = false;
		const off = () => {
			if (called) return;
			called = true;
			dispose();
		};
		const handleBeforeUnload = () => off();
		window.addEventListener("beforeunload", handleBeforeUnload);
		return () => {
			window.removeEventListener("beforeunload", handleBeforeUnload);
			off();
		};
		// dispatch and agentAttentionBridge are stable refs; only startupMode should re-run
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [startupMode]);

	// Whisper workflow lens: the driver pushes per-worktree state keyed by
	// worktreeId across ALL workspaces, so its attention dispatch must route to
	// the workspace that owns the worktree — the same routing the agent-attention
	// bridge uses above. Worktrees we don't own (no matching session) are dropped.
	const dispatchWhisperAttention = useCallback<WhisperAttentionDispatch>(
		(action) => {
			for (const wsId of appWorkspacesRef.current.workspaceOrder) {
				const ws = appWorkspacesRef.current.workspacesById[wsId];
				if (ws?.workspaceState?.sessionsByWorktreeId[action.worktreeId]) {
					createScopedWorkspaceDispatch(wsId)(action);
					return;
				}
			}
		},
		[appWorkspacesRef, createScopedWorkspaceDispatch],
	);
	const whisperStates = useWhisperState({
		onWhisperStateChanged: pluginsClient.onWhisperStateChanged,
		dispatch: dispatchWhisperAttention,
	});

	// Plugin snapshots — used to gate the Start-collab button on whisper on-healthy.
	const pluginSnapshots = usePluginsState();
	const whisperOnHealthy = pluginSnapshots.some(
		(p) => p.id === "whisper" && p.status.state === "on-healthy",
	);

	// Agent-CLI probes drive the launcher chips. Re-fetch when plugin snapshots
	// change (a reprobe updates them); the probe service caches for 60s.
	const [agentClis, setAgentClis] = useState<AgentCliProbes | null>(null);
	useEffect(() => {
		let cancelled = false;
		void pluginsClient.agentClis().then((probes) => {
			if (!cancelled) setAgentClis(probes);
		});
		return () => {
			cancelled = true;
		};
	}, [pluginSnapshots]);

	const [workflowDetailTarget, setWorkflowDetailTarget] = useState<{
		workspaceId: string;
		worktreeId: string;
	} | null>(null);

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

	// `restoreWorkspace` is defined further down (it depends on terminal-runtime
	// hooks) but `useStartupRestore` runs at the top of the component body. The
	// ref is populated below after `useWorkspaceLifecycle` resolves; the startup
	// effect dereferences it on first run, so the ordering is safe.
	const restoreWorkspaceRef = useRef<
		| ((
				snapshot: WorkspaceSnapshot,
				preference: RestorePreference,
				dormantSaved: PersistedSavedWorkspace[],
		  ) => Promise<void>)
		| null
	>(null);

	useStartupRestore({
		setStartupMode,
		setStartupError,
		setRestorePreference,
		setSavedSnapshot,
		setSavedDormantWorkspaces,
		restoreWorkspace: (snapshot, preference, dormantSaved) =>
			restoreWorkspaceRef.current?.(snapshot, preference, dormantSaved) ??
			Promise.resolve(),
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

	// cmd+T (mac) / ctrl+T opens the code-nav symbol palette.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const isMac =
				typeof navigator !== "undefined" &&
				navigator.platform.toLowerCase().includes("mac");
			const mod = isMac ? e.metaKey : e.ctrlKey;
			if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "t") {
				const target = e.target as HTMLElement | null;
				const inText =
					target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
				if (inText) return;
				e.preventDefault();
				const wid = workspaceStateRef.current.selectedWorktreeId;
				if (!wid) return;
				// Open the review overlay's Files tab in Symbols sub-mode and focus
				// the search input (FilesPane focuses on entering symbols mode).
				dispatch({
					type: "session/setReviewMode",
					worktreeId: wid,
					reviewMode: "files",
				});
				dispatch({
					type: "session/setFilesPaneMode",
					worktreeId: wid,
					filesPaneMode: "symbols",
				});
				setReviewOpen(true);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [dispatch]);

	// Register Monaco code-nav providers once on mount, lazily importing the
	// monaco-dependent module so tests/unit/components/App-*.test.tsx (jsdom)
	// don't pull in monaco-editor's browser-only bootstrap at import time.
	useEffect(() => {
		let cancelled = false;
		let dispose: (() => void) | null = null;
		const wsId = activeWorkspaceId;
		const wtId = activeWorktree?.id;
		const sessId = activeSession?.id;
		void import("../features/code-nav/monaco/register")
			.then(({ registerCodeNavProviders }) => {
				if (cancelled) return;
				dispose = registerCodeNavProviders({
					dispatch: dispatch as unknown as (action: unknown) => void,
					toast: (msg) => console.warn(`[code-nav] ${msg}`),
					getActive: () => {
						if (!wsId || !wtId || !sessId) return null;
						// Read nav state off the live ref so a state change since
						// this effect ran doesn't make the gate stale.
						const session =
							workspaceStateRef.current.sessionsByWorktreeId[wtId];
						const nav = session?.navLocation ?? null;
						return {
							workspaceId: wsId,
							worktreeId: wtId,
							sessionId: sessId,
							currentLocation: nav
								? {
										workspaceId: wsId,
										worktreeId: wtId,
										file: nav.file,
										line: nav.line,
										column: nav.column,
									}
								: null,
							paneTransient: session?.paneTransient ?? false,
						};
					},
				});
			})
			.catch(() => {
				// monaco unavailable (e.g. test env) — code-nav UI degrades silently.
			});
		return () => {
			cancelled = true;
			if (dispose) dispose();
		};
	}, [activeWorkspaceId, activeWorktree?.id, activeSession?.id, dispatch]);
	// All shells occupying layout slots are visible (the slot grid renders each).
	const slotProcessIds = activeSession?.slotProcessIds ?? [null];
	const visibleProcessIds = slotProcessIds.filter(
		(id): id is string => id !== null,
	);
	const runningShells = visibleProcessIds.length;
	const addDisabled = runningShells >= 6;

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
	const updateAddingDraftBody = useCallback((body: string) => {
		setAddingDraft((prev) => (prev ? { ...prev, body } : prev));
	}, []);
	const agentInstallStatus = useAgentInstallStatus();
	// providers starts as [] before the first refresh resolves. length > 0 guards
	// against that window, so the CTA is hidden during initial load rather than
	// flickering visible before providers are known.
	const installCtaVisible =
		agentInstallStatus.providers.length > 0 &&
		agentInstallStatus.providers.every((p) => !p.installed);
	const [installModalOpen, setInstallModalOpen] = useState(false);
	const [pendingCommentJump, setPendingCommentJump] = useState(0);

	useInstallModalListener(useCallback(() => setInstallModalOpen(true), []));

	const trackedFilesLoader = useCallback(
		async (opts: { includeIgnored: boolean }) => {
			if (!activeWorkspaceId || !activeWorktree) return [];
			const entries = await files.listWorktree(
				activeWorkspaceId,
				activeWorktree.id,
				{ includeIgnored: opts.includeIgnored },
			);
			return entries.map((e) => e.path);
		},
		[activeWorkspaceId, activeWorktree],
	);

	const [terminalFocusSignal, setTerminalFocusSignal] = useState(0);

	function selectActiveProcess(processId: string) {
		if (!activeWorktree) return;

		// Selecting a slot only moves focus — layout is chosen explicitly via the
		// layout dialog, never as a side effect of selection.
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
		dispatch({
			type: "session/clearProcessAgentAttention",
			worktreeId: activeWorktree.id,
			processId,
			sticky: false,
			clearedAt: Date.now(),
		});
		dispatch({
			type: "session/clearSessionAgentAttention",
			worktreeId: activeWorktree.id,
		});
		setTerminalFocusSignal((n) => n + 1);

		// Focus the terminal synchronously so keyboard input lands immediately.
		// useEffect fires after paint (too late when Playwright or fast users
		// type right after clicking a tab). We look up the xterm textarea via
		// the data-terminal-session-id attribute set by TerminalPane and the
		// stable xterm-helper-textarea class used throughout the E2E suite.
		const terminalSessionId =
			workspaceStateRef.current.processSessionsById[processId]
				?.terminalSessionId;
		if (terminalSessionId) {
			const pane = document.querySelector(
				`[data-terminal-session-id="${terminalSessionId}"]`,
			);
			const textarea = pane?.querySelector(
				".xterm-helper-textarea",
			) as HTMLTextAreaElement | null;
			textarea?.focus({ preventScroll: true });
		}
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
	// Derive git data from cached session state
	const activeSummary = activeSession?.gitSummary ?? null;
	const gitSummaryError = activeSession?.gitSummaryError ?? false;
	const gitSummaryStale = activeSession?.gitSummaryStale ?? false;
	const gitSummaryMessage = activeSession?.gitSummaryMessage ?? null;
	const changes = useMemo(
		() => activeSummary?.changedFiles ?? [],
		[activeSummary],
	);

	const filesChipTarget = useMemo(
		() => firstViewableChangedFile(changes),
		[changes],
	);
	const canOpenFiles =
		(activeSummary?.isDirty ?? false) && filesChipTarget != null;

	const gitStatusMap = useMemo(() => {
		const map = new Map<string, GitChangeStatus>();
		for (const change of changes) map.set(change.path, change.status);
		return map;
	}, [changes]);

	// Worktree-wide counts (for chipbar)
	const openCommentCount = reviewState.comments.filter(
		(c) => c.status === "open",
	).length;
	const addressedCommentCount = reviewState.comments.filter(
		(c) => c.status === "addressed",
	).length;

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
		spawnAdHocProcess,
		handleCloseProcess,
		handleLaunchPreset,
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

	const subscribeSessionExit = useCallback(
		(sessionId: string, cb: (exitCode: number | null) => void) => {
			const off = terminalsClient.onExit((event) => {
				if (event.sessionId !== sessionId) return;
				cb(event.exitCode);
			});
			return off;
		},
		[],
	);

	const {
		handleAddFloatingShell,
		handleCloseFloatingShell,
		handlePinFloatingShell,
		handleExpandFloatingShell,
		handleMinimizeFloatingShell,
		runCommandInFloatingShell,
	} = useFloatingShellActions({
		workspaceId: activeWorkspaceId,
		worktree: activeWorktree,
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
	});

	// Route a preset Launch to the pinned grid path or a throwaway floating
	// shell based on the preset's stored target. Lives here (not in
	// useProcessActions) because the throwaway runner comes from a later hook.
	const launchPreset = useCallback(
		(presetId: string) => {
			const preset = workspaceState.commandPresets.find(
				(p) => p.id === presetId,
			);
			if (!preset) return;
			const plan = resolvePresetLaunch(preset);
			if (plan.kind === "throwaway") {
				void runCommandInFloatingShell(plan.command, { label: plan.label });
			} else {
				void handleLaunchPreset(presetId);
			}
		},
		[
			workspaceState.commandPresets,
			runCommandInFloatingShell,
			handleLaunchPreset,
		],
	);

	// Floating throwaway shells live outside the layout slot grid; surface the
	// current set and the expanded one (if any) so the pills + popover can render.
	const floatingShellIds = activeSession?.floatingShellIds ?? [];
	const expandedFloatingShellId =
		activeSession?.expandedFloatingShellId ?? null;
	const expandedFloatingProcess = expandedFloatingShellId
		? (workspaceState.processSessionsById[expandedFloatingShellId] ?? null)
		: null;
	const expandedFloatingSession = expandedFloatingProcess?.terminalSessionId
		? (sessions.find(
				(s) => s.id === expandedFloatingProcess.terminalSessionId,
			) ?? null)
		: null;

	const [layoutDialogOpen, setLayoutDialogOpen] = useState(false);
	const [pluginsDialogOpen, setPluginsDialogOpen] = useState(false);

	// Launches a single command in a new pinned terminal for the collab flow.
	// Spawns a session, registers it as a process, and sends the command; uses a
	// "collab: <agent>" label so the terminals are identifiable.
	const launchCollabTerminal = useCallback(
		async (command: string, slotIndex?: number) => {
			if (!activeWorktree || !activeWorkspaceId) return;
			const targetWorkspaceId = activeWorkspaceId;
			const targetWorktree = activeWorktree;
			const agentLabel = command.split(" ").pop() ?? "agent";
			let terminal: TerminalSession;
			try {
				terminal = await createSession(
					targetWorkspaceId,
					targetWorktree.id,
					targetWorktree.path,
				);
			} catch (err) {
				console.error("Failed to start collab terminal:", err);
				notifyToast("Failed to start collab terminal");
				return;
			}
			const process: ProcessSession = {
				id: crypto.randomUUID(),
				workspaceId: targetWorkspaceId,
				worktreeId: targetWorktree.id,
				terminalSessionId: terminal.id,
				origin: "adHoc",
				presetId: null,
				label: `collab: ${agentLabel}`,
				command,
				status: "running",
				lastActivityAt: null,
				lastOutputPreview: null,
				exitCode: null,
				pinned: true,
				attentionState: "idle",
				agentAttentionReasons: {},
				agentAttentionClearedAt: null,
				agentDetected: false,
				provider: null,
			};
			// An empty-slot launcher passes a slotIndex to land in THAT slot; the
			// chrome bar omits it and auto-places (fill first empty, else promote).
			createScopedWorkspaceDispatch(targetWorkspaceId)(
				slotIndex === undefined
					? {
							type: "session/registerProcess",
							worktreeId: targetWorktree.id,
							process,
						}
					: {
							type: "session/placeProcessInNewSlot",
							worktreeId: targetWorktree.id,
							process,
							layoutId: activeSession?.terminalLayoutId ?? "1",
							slotIndex,
						},
			);
			await sendInput(terminal.id, `${command}${commandSubmitKey()}`);
		},
		[
			activeWorktree,
			activeWorkspaceId,
			activeSession,
			createSession,
			sendInput,
			createScopedWorkspaceDispatch,
		],
	);

	const activeWhisperState = activeWorktree
		? whisperStates.get(activeWorktree.id)
		: undefined;

	// One shared mount-pending guard for every agent-launch surface (the chrome
	// bar and each empty-slot launcher) so a rapid second click anywhere cannot
	// fire a second concurrent `whisper collab mount`.
	const mountGuard = useMountPendingGuard(activeWhisperState);

	// Single-slot deferred-mount queue: a rapid second click on an empty collab is
	// parked here while the first mount settles, then auto-mounted once a real slot
	// frees up — or vendor-launched if the collab never becomes ready in time.
	const deferredMount = useDeferredMount({
		whisperState: activeWhisperState,
		mountInFlight: mountGuard.mountPending,
		onReady: (provider, slot) => {
			void launchCollabTerminal(`whisper collab mount ${provider}`, slot);
			mountGuard.beginMount();
		},
		onTimeout: (provider, slot) => {
			void launchCollabTerminal(providerDef(provider).binary, slot);
			notifyToast("Collab init timed out — launched without collab");
		},
	});

	// The single launch entry point shared by every surface (chrome bar and each
	// empty-slot launcher): decide mount / defer / vendor against the 2-agent cap.
	const launchAgent = useCallback(
		(provider: AgentProvider, slot: number | undefined) => {
			// Re-clicking the queued chip cancels the deferral.
			if (deferredMount.deferredProvider === provider) {
				deferredMount.cancel();
				return;
			}
			const decision = decideLaunch(provider, {
				whisperHealthy: whisperOnHealthy,
				boundCount: boundCount(activeWhisperState),
				daemonAlive: activeWhisperState?.daemonAlive ?? false,
				mountInFlight: mountGuard.mountPending,
				deferredOccupied: deferredMount.deferredOccupied,
			});
			if (decision.kind === "defer") {
				deferredMount.enqueue(provider, slot);
				return;
			}
			void launchCollabTerminal(decision.command, slot);
			if (decision.kind === "mount") mountGuard.beginMount();
		},
		[
			whisperOnHealthy,
			activeWhisperState,
			mountGuard,
			deferredMount,
			launchCollabTerminal,
		],
	);

	// Empty-slot agent launch: lands the agent in the clicked slot via the shared
	// launch rule above.
	const handleLaunchAgentInSlot = useCallback(
		(provider: AgentProvider, slotIndex: number) =>
			launchAgent(provider, slotIndex),
		[launchAgent],
	);

	const handlePromoteSlot = useCallback(
		(slotIndex: number) => {
			if (!activeWorktree) return;
			dispatch({
				type: "session/swapTerminalSlots",
				worktreeId: activeWorktree.id,
				i: slotIndex,
				j: 0,
			});
		},
		[activeWorktree, dispatch],
	);

	const handleStartShellInSlot = useCallback(
		async (slotIndex: number) => {
			if (!activeWorktree || !activeSession) return;
			const process = await spawnAdHocProcess();
			if (!process) return; // spawn failed -> toast shown, no orphan
			dispatch({
				type: "session/placeProcessInNewSlot",
				worktreeId: activeWorktree.id,
				process,
				layoutId: activeSession.terminalLayoutId,
				slotIndex,
			});
		},
		[activeWorktree, activeSession, spawnAdHocProcess, dispatch],
	);

	const handleSelectLayout = useCallback(
		(layoutId: LayoutId) => {
			if (!activeWorktree) return;
			dispatch({
				type: "session/setTerminalLayout",
				worktreeId: activeWorktree.id,
				layoutId,
			});
			setLayoutDialogOpen(false);
		},
		[activeWorktree, dispatch],
	);

	const {
		resetAll: resetDefaultShellEnsured,
		forgetWorktree: forgetDefaultShellEnsuredForWorktree,
	} = useDefaultShellOnEmptyWorktree({
		startupMode,
		activeWorktreeId: activeWorktree?.id,
		activeSessionProcessCount: activeSession?.processSessionIds.length ?? 0,
		hasActiveSession: !!activeSession,
		// null while the agent-CLI probe is still loading, so the hook defers
		// rather than racing a default shell in before detection resolves.
		agentsAvailable:
			agentClis === null ? null : visibleProviders(agentClis).length > 0,
		createDefaultShell: handleAddAdHoc,
	});

	const {
		activateWorkspace,
		handleLoadPath,
		restoreWorkspace,
		handleRestoreDecision,
		recreatePersistedProcesses,
	} = useWorkspaceLifecycle({
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
		setStartupMode,
		setStartupError,
		setError,
		setRestoreWarning,
		setWorkspacePickerOpen,
		createSession,
		sendInput,
		adoptSession,
		resetDefaultShellEnsured,
	});

	// Late-bind `restoreWorkspace` so the startup-restore effect (declared
	// earlier in the body) can call into the lifecycle hook even though that
	// hook is set up after terminal-runtime and default-shell deps resolve.
	restoreWorkspaceRef.current = restoreWorkspace;

	useGitSummaryLoader({
		workspaceId: activeWorkspaceId,
		worktreeId: activeWorktree?.id,
		refreshKey,
		dispatch,
	});

	const {
		branches: baseBranches,
		selected: selectedBaseBranch,
		setSelected: setSelectedBaseBranch,
		loading: baseBranchLoading,
		warning: baseBranchWarning,
	} = useBaseBranchOptions({
		open: createDialogOpen,
		workspaceId: activeWorkspaceId,
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
		baseBranch: selectedBaseBranch,
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

	const { handleSelectSidebarWorktree, handleSelectWorktree } =
		useWorktreeSelection({
			activeWorkspaceId,
			worktrees,
			workspaceState,
			appWorkspacesRef,
			activeWorkspaceStateRef,
			pendingRestoreSessions,
			setPendingRestoreSessions,
			dispatch,
			activateWorkspace,
			recreatePersistedProcesses,
		});

	const { handleConfirmCreateWorktree, handleConfirmRemoveWorktree } =
		useWorktreeActions({
			workspaceId: activeWorkspaceId,
			workspaceStateRef,
			createPreview,
			createName,
			createBaseBranch: selectedBaseBranch,
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

	// ── Command actions: shared by keyboard shortcuts and the command palette ──
	const toggleNoteSheet = useCallback(() => setNoteSheetOpen((p) => !p), []);
	const openFilesOverlay = useCallback(() => {
		if (activeWorktree) setFilesOverlayOpen(true);
	}, [activeWorktree?.id]);
	const toggleReview = useCallback(() => {
		if (!activeWorktree) return;
		if (reviewOpen) collapseReview();
		else setReviewOpen(true);
	}, [activeWorktree?.id, reviewOpen]);
	const startRenameSession = useCallback(() => {
		if (!activeWorkspaceId || !activeWorktree) return;
		setSidebarCollapsed(false);
		setPendingRename({
			workspaceId: activeWorkspaceId,
			worktreeId: activeWorktree.id,
		});
	}, [activeWorkspaceId, activeWorktree?.id]);
	const toggleShortcutsHelp = useCallback(
		() => setShortcutsHelpOpen((p) => !p),
		[],
	);
	const openAddWorktree = useCallback(() => {
		if (activeWorkspaceId) setCreateDialogOpen(true);
	}, [activeWorkspaceId]);
	const openWorkspacePicker = useCallback(() => {
		if (startupMode === "ready") setWorkspacePickerOpen(true);
	}, [startupMode]);
	const newTerminal = useCallback(() => {
		if (!addDisabled) void handleAddAdHoc();
	}, [activeWorktree?.id, activeWorkspaceId, addDisabled]);
	const newFloatingShell = useCallback(() => {
		void handleAddFloatingShell();
	}, [activeWorktree?.id, activeWorkspaceId]);
	const openTerminalLayout = useCallback(() => {
		if (activeWorktree) setLayoutDialogOpen(true);
	}, [activeWorktree?.id]);
	const closeActiveTerminal = useCallback(() => {
		const currentState = workspaceStateRef.current;
		const currentWorktreeId = currentState.selectedWorktreeId;
		if (!currentWorktreeId) return;
		const activeProcessId =
			currentState.sessionsByWorktreeId[currentWorktreeId]
				?.activeProcessSessionId;
		if (!activeProcessId) return;
		void handleCloseProcess(activeProcessId);
	}, [activeWorktree?.id, activeWorkspaceId]);
	const toggleSidebar = useCallback(() => setSidebarCollapsed((c) => !c), []);
	const applyReviewMode = useCallback(
		(reviewMode: "files" | "changes" | "commits") => {
			const currentState = workspaceStateRef.current;
			const currentWorktreeId = currentState.selectedWorktreeId;
			if (!currentWorktreeId) return;
			dispatch({
				type: "session/setReviewMode",
				worktreeId: currentWorktreeId,
				reviewMode,
			});
			setReviewOpen(true);
		},
		[dispatch],
	);
	const openPlugins = useCallback(() => setPluginsDialogOpen(true), []);
	const refreshChanges = useCallback(() => {
		if (activeWorktree) setRefreshKey((k) => k + 1);
	}, [activeWorktree?.id]);
	// handleSelectWorktree's identity churns each render while no workspace is
	// active (worktrees defaults to a fresh []), so read it from a ref to keep
	// selectAdjacentWorktree — and thus the cycle command memo — referentially
	// stable. Otherwise useRegisterCommands' setVersion would re-fire every
	// render and spin into an infinite update loop.
	const handleSelectWorktreeRef = useRef(handleSelectWorktree);
	handleSelectWorktreeRef.current = handleSelectWorktree;
	const selectAdjacentWorktree = useCallback(
		(direction: "next" | "prev"): boolean => {
			const wts = worktreesRef.current;
			const currentId = workspaceStateRef.current.selectedWorktreeId;
			if (!wts.length || !currentId) return false;
			const idx = wts.findIndex((w) => w.id === currentId);
			if (idx === -1) return false;
			const nextIdx =
				direction === "next"
					? (idx + 1) % wts.length
					: (idx - 1 + wts.length) % wts.length;
			const nextId = wts[nextIdx]?.id;
			if (!nextId) return false;
			void handleSelectWorktreeRef.current(nextId);
			return true;
		},
		[],
	);
	const selectAdjacentWorkspace = useCallback(
		(direction: "next" | "prev"): boolean => {
			const order = appWorkspacesRef.current.workspaceOrder;
			const currentId = appWorkspacesRef.current.activeWorkspaceId;
			if (order.length < 2 || !currentId) return false;
			const idx = order.indexOf(currentId);
			if (idx === -1) return false;
			const nextIdx =
				direction === "next"
					? (idx + 1) % order.length
					: (idx - 1 + order.length) % order.length;
			const nextId = order[nextIdx];
			if (!nextId) return false;
			if (!hasInlineEditorsRegistered()) {
				void activateWorkspace(nextId);
				return true;
			}
			void (async () => {
				const gate = await runInlineEditorDirtyGate();
				if (gate === "cancel") return;
				void activateWorkspace(nextId);
			})();
			return true;
		},
		[],
	);
	const selectAdjacentTerminal = useCallback(
		(direction: "next" | "prev"): boolean => {
			const currentState = workspaceStateRef.current;
			const currentWorktreeId = currentState.selectedWorktreeId;
			if (!currentWorktreeId) return false;
			const session = currentState.sessionsByWorktreeId[currentWorktreeId];
			if (!session) return false;
			const processes = (session.processSessionIds ?? [])
				.map((id) => currentState.processSessionsById[id])
				.filter(Boolean)
				.sort((a, b) => Number(b.pinned) - Number(a.pinned));
			if (processes.length < 2) return false;
			const currentProcessId = session.activeProcessSessionId;
			const idx = processes.findIndex((p) => p.id === currentProcessId);
			const nextIdx =
				direction === "next"
					? (idx + 1) % processes.length
					: (idx - 1 + processes.length) % processes.length;
			const nextProcessId = processes[nextIdx]?.id;
			if (!nextProcessId) return false;
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
			dispatch({
				type: "session/clearProcessAgentAttention",
				worktreeId: currentWorktreeId,
				processId: nextProcessId,
				sticky: false,
				clearedAt: Date.now(),
			});
			dispatch({
				type: "session/clearSessionAgentAttention",
				worktreeId: currentWorktreeId,
			});
			setTerminalFocusSignal((n) => n + 1);
			return true;
		},
		[dispatch],
	);
	const countTerminals = useCallback((): number => {
		const currentState = workspaceStateRef.current;
		const currentWorktreeId = currentState.selectedWorktreeId;
		if (!currentWorktreeId) return 0;
		const session = currentState.sessionsByWorktreeId[currentWorktreeId];
		return session?.processSessionIds?.length ?? 0;
	}, []);

	const simpleCommands = useMemo<Command[]>(
		() => [
			{
				id: "files-overlay",
				title: "Open Files",
				group: "Review",
				keybindingId: "files-overlay",
				run: openFilesOverlay,
				isAvailable: () => !!activeWorktree,
			},
			{
				id: "review.open",
				title: "Open Review",
				group: "Review",
				keybindingId: "review.open",
				run: toggleReview,
				isAvailable: () => !!activeWorktree,
			},
			{
				id: "review.files",
				title: "Review: Files",
				group: "Review",
				keybindingId: "review.files",
				run: () => applyReviewMode("files"),
				isAvailable: () => !!activeWorktree,
			},
			{
				id: "review.changes",
				title: "Review: Changes",
				group: "Review",
				keybindingId: "review.changes",
				run: () => applyReviewMode("changes"),
				isAvailable: () => !!activeWorktree,
			},
			{
				id: "review.commits",
				title: "Review: Commits",
				group: "Review",
				keybindingId: "review.commits",
				run: () => applyReviewMode("commits"),
				isAvailable: () => !!activeWorktree,
			},
			{
				id: "changes.refresh",
				title: "Refresh changes",
				group: "Review",
				run: refreshChanges,
				isAvailable: () => !!activeWorktree,
			},
			{
				id: "terminal.new",
				title: "New terminal",
				group: "Terminal",
				keybindingId: "terminal.new",
				run: newTerminal,
				isAvailable: () => !!activeWorktree && !addDisabled,
			},
			{
				id: "terminal.newFloating",
				title: "New throwaway shell",
				group: "Terminal",
				keybindingId: "terminal.newFloating",
				run: newFloatingShell,
				isAvailable: () =>
					!!activeWorktree && floatingShellIds.length < MAX_FLOATING_SHELLS,
			},
			{
				id: "terminal.close",
				title: "Close terminal",
				group: "Terminal",
				keybindingId: "terminal.close",
				run: closeActiveTerminal,
				isAvailable: () => {
					const s = workspaceStateRef.current;
					const wt = s.selectedWorktreeId;
					return !!wt && !!s.sessionsByWorktreeId[wt]?.activeProcessSessionId;
				},
			},
			{
				id: "terminal.layout",
				title: "Choose layout",
				group: "Terminal",
				keybindingId: "terminal.layout",
				run: openTerminalLayout,
				isAvailable: () => !!activeWorktree,
			},
			{
				id: "worktree.add",
				title: "Add worktree",
				group: "Worktree",
				keybindingId: "worktree.add",
				run: openAddWorktree,
				isAvailable: () => !!activeWorkspaceId,
			},
			{
				id: "ui.openWorkspacePicker",
				title: "Open workspace",
				group: "Workspace",
				keybindingId: "ui.openWorkspacePicker",
				run: openWorkspacePicker,
				isAvailable: () => startupMode === "ready",
			},
			{
				id: "layout.toggleSidebar",
				title: "Toggle sidebar",
				group: "Layout",
				keybindingId: "layout.toggleSidebar",
				run: toggleSidebar,
			},
			{
				id: "note-sheet",
				title: "Open Note",
				group: "Session",
				keybindingId: "note-sheet",
				run: toggleNoteSheet,
			},
			{
				id: "rename-session",
				title: "Rename session",
				group: "Session",
				keybindingId: "rename-session",
				run: startRenameSession,
				isAvailable: () => !!activeWorkspaceId && !!activeWorktree,
			},
			{
				id: "shortcuts-help",
				title: "Show shortcuts",
				group: "App",
				keybindingId: "shortcuts-help",
				run: toggleShortcutsHelp,
			},
			{
				id: "plugins.open",
				title: "Open Plugins",
				group: "App",
				run: openPlugins,
			},
		],
		[
			openFilesOverlay,
			toggleReview,
			applyReviewMode,
			refreshChanges,
			newTerminal,
			newFloatingShell,
			closeActiveTerminal,
			openTerminalLayout,
			openAddWorktree,
			openWorkspacePicker,
			toggleSidebar,
			toggleNoteSheet,
			startRenameSession,
			toggleShortcutsHelp,
			openPlugins,
			activeWorktree,
			activeWorkspaceId,
			addDisabled,
			startupMode,
			floatingShellIds.length,
		],
	);
	useRegisterCommands(simpleCommands, [simpleCommands]);

	const cycleCommands = useMemo<Command[]>(
		() => [
			{
				id: "worktree.selectNext",
				title: "Next worktree",
				group: "Worktree",
				keybindingId: "worktree.selectNext",
				run: () => selectAdjacentWorktree("next"),
				isAvailable: () => worktreesRef.current.length > 1,
			},
			{
				id: "worktree.selectPrev",
				title: "Previous worktree",
				group: "Worktree",
				keybindingId: "worktree.selectPrev",
				run: () => selectAdjacentWorktree("prev"),
				isAvailable: () => worktreesRef.current.length > 1,
			},
			{
				id: "workspace.selectNext",
				title: "Next workspace",
				group: "Workspace",
				keybindingId: "workspace.selectNext",
				run: () => selectAdjacentWorkspace("next"),
				isAvailable: () => appWorkspacesRef.current.workspaceOrder.length > 1,
			},
			{
				id: "workspace.selectPrev",
				title: "Previous workspace",
				group: "Workspace",
				keybindingId: "workspace.selectPrev",
				run: () => selectAdjacentWorkspace("prev"),
				isAvailable: () => appWorkspacesRef.current.workspaceOrder.length > 1,
			},
			{
				id: "terminal.selectNext",
				title: "Next terminal",
				group: "Terminal",
				keybindingId: "terminal.selectNext",
				run: () => selectAdjacentTerminal("next"),
				isAvailable: () => countTerminals() > 1,
			},
			{
				id: "terminal.selectPrev",
				title: "Previous terminal",
				group: "Terminal",
				keybindingId: "terminal.selectPrev",
				run: () => selectAdjacentTerminal("prev"),
				isAvailable: () => countTerminals() > 1,
			},
		],
		[
			selectAdjacentWorktree,
			selectAdjacentWorkspace,
			selectAdjacentTerminal,
			countTerminals,
		],
	);
	useRegisterCommands(cycleCommands, [cycleCommands]);

	// Cmd+; / Ctrl+; — toggle note sheet
	useKeyboardShortcut(
		"note-sheet",
		appPlatform,
		(e) => {
			e.preventDefault();
			toggleNoteSheet();
		},
		[toggleNoteSheet],
	);

	// Cmd+P / Ctrl+Shift+P — open Files overlay
	useKeyboardShortcut(
		"files-overlay",
		appPlatform,
		(e) => {
			e.preventDefault();
			openFilesOverlay();
		},
		[openFilesOverlay],
	);

	// Cmd+J / Ctrl+J — toggle review overlay
	useKeyboardShortcut(
		"review.open",
		appPlatform,
		(e) => {
			e.preventDefault();
			toggleReview();
		},
		[toggleReview],
	);

	// Reset the review overlay when the active workspace or worktree changes
	// so it doesn't silently retarget the new worktree.
	useEffect(() => {
		setReviewOpen(false);
	}, [activeWorkspaceId, activeWorktree?.id]);

	// Cmd+Shift+R / Ctrl+Alt+R — rename active session
	useKeyboardShortcut(
		"rename-session",
		appPlatform,
		(e) => {
			e.preventDefault();
			startRenameSession();
		},
		[startRenameSession],
	);

	// Cmd+/ or Cmd+? / Ctrl+/ or Ctrl+? — show shortcuts help
	useKeyboardShortcut(
		"shortcuts-help",
		appPlatform,
		(e) => {
			e.preventDefault();
			toggleShortcutsHelp();
		},
		[toggleShortcutsHelp],
	);

	// Cmd+Shift+K / Ctrl+Shift+K — open the command palette
	useKeyboardShortcut(
		"command-palette",
		appPlatform,
		(e) => {
			e.preventDefault();
			setCommandPaletteOpen(true);
		},
		[],
	);

	// Cmd+] / Ctrl+] and Cmd+[ / Ctrl+[ — cycle through worktrees
	useNextPrevShortcut(
		"worktree.selectNext",
		"worktree.selectPrev",
		appPlatform,
		(e, direction) => {
			if (selectAdjacentWorktree(direction)) e.preventDefault();
		},
		[selectAdjacentWorktree],
	);

	// Cmd+N / Ctrl+N — add worktree
	useKeyboardShortcut(
		"worktree.add",
		appPlatform,
		(e) => {
			e.preventDefault();
			openAddWorktree();
		},
		[openAddWorktree],
	);

	// Cmd+Shift+] / Ctrl+Shift+] and Cmd+Shift+[ / Ctrl+Shift+[ — cycle through workspaces
	useNextPrevShortcut(
		"workspace.selectNext",
		"workspace.selectPrev",
		appPlatform,
		(e, direction) => {
			if (selectAdjacentWorkspace(direction)) e.preventDefault();
		},
		[selectAdjacentWorkspace],
	);

	// Cmd+O / Ctrl+O — open workspace picker (menu accelerator already fires
	// this via IPC; this handler covers the renderer path for completeness)
	useKeyboardShortcut(
		"ui.openWorkspacePicker",
		appPlatform,
		(e) => {
			e.preventDefault();
			openWorkspacePicker();
		},
		[openWorkspacePicker],
	);

	// Cmd+T / Ctrl+T — new terminal (disabled when 6 shells are running)
	useKeyboardShortcut(
		"terminal.new",
		appPlatform,
		(e) => {
			e.preventDefault();
			newTerminal();
		},
		[newTerminal],
	);

	// Cmd+Shift+T / Ctrl+Shift+T — new floating throwaway shell (own cap check)
	useKeyboardShortcut(
		"terminal.newFloating",
		appPlatform,
		(e) => {
			e.preventDefault();
			newFloatingShell();
		},
		[newFloatingShell],
	);

	// Cmd+Shift+L / Ctrl+Shift+L — open the terminal layout dialog
	useKeyboardShortcut(
		"terminal.layout",
		appPlatform,
		(e) => {
			e.preventDefault();
			openTerminalLayout();
		},
		[openTerminalLayout],
	);

	// Cmd+Shift+W / Ctrl+Shift+W — close active terminal
	useKeyboardShortcut(
		"terminal.close",
		appPlatform,
		(e) => {
			e.preventDefault();
			closeActiveTerminal();
		},
		[closeActiveTerminal],
	);

	// Cmd+Shift+D / Ctrl+Shift+D and Cmd+Shift+A / Ctrl+Shift+A — cycle through terminals
	useNextPrevShortcut(
		"terminal.selectNext",
		"terminal.selectPrev",
		appPlatform,
		(e, direction) => {
			if (selectAdjacentTerminal(direction)) e.preventDefault();
		},
		[selectAdjacentTerminal],
	);

	// Cmd+B / Ctrl+B — toggle sidebar
	useKeyboardShortcut(
		"layout.toggleSidebar",
		appPlatform,
		(e) => {
			e.preventDefault();
			toggleSidebar();
		},
		[toggleSidebar],
	);

	// Cmd+1/2/3 / Ctrl+1/2/3 — switch review pane tab and open overlay
	const switchReviewMode = useCallback(
		(reviewMode: "files" | "changes" | "commits") => (e: KeyboardEvent) => {
			e.preventDefault();
			applyReviewMode(reviewMode);
		},
		[applyReviewMode],
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

	const handleOpenFilesChip = useCallback(() => {
		if (filesChipTarget && activeWorktree) {
			dispatch({
				type: "session/selectFile",
				worktreeId: activeWorktree.id,
				relativePath: filesChipTarget.path,
			});
		}
		setReviewOpen(true);
	}, [filesChipTarget, activeWorktree, dispatch]);

	const { handleRemoveWorkspace } = useWorkspaceRemoval({
		appWorkspaces,
		dispatchAppWorkspaces,
		stopSession,
	});

	// Accumulates the displayed sidebar attention for every worktree during the
	// sidebarWorkspaces build below, so a single post-render effect can diff it
	// against the previous render and emit `resolution` diagnostics for genuine
	// changes (Task 10). Keyed by worktreeId across all workspaces.
	const displayedAttentionSnapshot: DisplayedAttentionSnapshot = {};

	const sidebarWorkspaces: SessionSidebarWorkspace[] = sortSidebarWorkspaces(
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
				...(() => {
					if (!ws.workspaceState)
						return {
							attentionByWorktreeId: {},
							processesByWorktreeId: {},
							attentionContextByWorktreeId: {},
							taskByWorktreeId: {},
							collapsedSummary: { sessionCount: 0, attentionTier: null },
						};
					const attentionByWorktreeId: Record<string, SidebarAttentionTier> =
						{};
					const processesByWorktreeId: Record<string, WorktreeProcessSummary> =
						{};
					const attentionContextByWorktreeId: Record<string, string> = {};
					const taskByWorktreeId: Record<string, string | null> = {};
					for (const [worktreeId, session] of Object.entries(
						ws.workspaceState.sessionsByWorktreeId,
					)) {
						const processes = session.processSessionIds
							.map((id) => ws.workspaceState!.processSessionsById[id])
							.filter(Boolean);
						const processSummary = buildWorktreeProcessSummary(
							processes,
							sidebarNow,
							3,
						);
						processesByWorktreeId[worktreeId] = processSummary;
						taskByWorktreeId[worktreeId] = session.task ?? null;
						const display = buildWorktreeAttentionDisplay({
							sessionAgentAttentionReasons: session.agentAttentionReasons,
							processSummary,
							now: sidebarNow,
							agentAttentionClearedAt: session.agentAttentionClearedAt,
						});
						attentionByWorktreeId[worktreeId] =
							display.state === "actionRequired"
								? "actionRequired"
								: display.state === "ready"
									? "ready"
									: display.state === "active"
										? "activity"
										: "idle";
						if (display.source === "session" && display.context) {
							attentionContextByWorktreeId[worktreeId] = display.context;
						}
						const topRow =
							display.source === "process"
								? (processSummary.topRow ?? null)
								: null;
						displayedAttentionSnapshot[worktreeId] = {
							worktreeId,
							processId: topRow?.id ?? null,
							provider: topRow?.provider ?? null,
							state: display.state,
							source: display.source,
							...(display.context ? { summary: display.context } : {}),
						};
					}
					return {
						attentionByWorktreeId,
						processesByWorktreeId,
						attentionContextByWorktreeId,
						taskByWorktreeId,
						collapsedSummary: {
							sessionCount: Object.keys(ws.workspaceState.sessionsByWorktreeId).length,
							attentionTier: rollupWorkspaceAttention(
								Object.values(attentionByWorktreeId),
							),
						},
					};
				})(),
				titleByWorktreeId: ws.workspaceState
					? Object.fromEntries(
							Object.entries(ws.workspaceState.sessionsByWorktreeId).map(
								([worktreeId, session]) => [worktreeId, session.title],
							),
						)
					: {},
				// Derive the workflow lens row only for this workspace's worktrees
				// that have whisper state. Absent (no key) ⇒ no row rendered.
				workflowRowByWorktreeId: (() => {
					const rows: Record<
						string,
						NonNullable<ReturnType<typeof toWorkflowRow>> & { stale?: boolean }
					> = {};
					for (const worktree of ws.worktrees) {
						const state = whisperStates.get(worktree.id);
						if (!state) continue;
						const row = toWorkflowRow(state);
						if (row) rows[worktree.id] = { ...row, stale: state.stale };
					}
					return rows;
				})(),
				active: ws.workspaceId === activeWorkspaceId,
				hydrated: ws.workspaceState !== null,
			})),
	);

	// Stable identity for the freshly-rebuilt displayed-attention snapshot so
	// the resolution effect only runs when the displayed values actually move,
	// not on every unrelated re-render.
	const displayedAttentionKey = JSON.stringify(displayedAttentionSnapshot);

	useEffect(() => {
		// Module-scoped prev-snapshot store (see resolution-emitter.ts): survives
		// StrictMode's dev/E2E double-mount so first-appearance resolutions emit
		// exactly once instead of twice.
		const changes = diffAndAdvanceResolutions(displayedAttentionSnapshot);
		for (const change of changes) {
			// Best-effort diagnostics: never let an emit failure break rendering.
			try {
				diagnostics.logAttentionEvent({ ...change, ts: Date.now() });
			} catch {
				// swallow — diagnostics are non-critical
			}
		}
		// displayedAttentionSnapshot is rebuilt every render; displayedAttentionKey
		// is its stable content hash and the real trigger for this effect.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [displayedAttentionKey]);

	// Component scope (reactive): the selected worktree drives the focus marker /
	// summary, so it must be a dependency of the publisher effect below — a
	// focus change alone must republish even when no attention value moved.
	const focusedWorktreeId = workspaceState?.selectedWorktreeId ?? null;

	useEffect(() => {
		if (startupMode !== "ready") return;
		try {
			const inputs: {
				worktreeId: string;
				session: WorktreeSession;
				processSessionsById: Record<string, ProcessSession>;
			}[] = [];
			for (const wsId of appWorkspacesRef.current.workspaceOrder) {
				const state =
					appWorkspacesRef.current.workspacesById[wsId]?.workspaceState;
				if (!state) continue;
				for (const [worktreeId, session] of Object.entries(
					state.sessionsByWorktreeId,
				)) {
					inputs.push({
						worktreeId,
						session,
						processSessionsById: state.processSessionsById,
					});
				}
			}
			const slice = samanthaSliceBuilder.current.build(
				inputs,
				focusedWorktreeId,
				startupMode,
			);
			pluginsClient.publishSamanthaSessionState(slice);
		} catch {
			// swallow — Samantha publish is best-effort, never break rendering
		}
		// Republish on: real attention movement (the existing `displayedAttentionKey`
		// content hash), app readiness (`startupMode`), AND focus change
		// (`focusedWorktreeId`) — the focus marker / summary must follow the selected
		// worktree even when no attention value moved.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [displayedAttentionKey, startupMode, focusedWorktreeId]);

	useEffect(() => {
		return pluginsClient.onSamanthaFocusWorktree(({ worktreeId }) => {
			const wsId = findWorkspaceForWorktree(
				appWorkspacesRef.current,
				worktreeId,
			);
			if (!wsId) return; // not a worktree we own — best-effort no-op
			if (wsId !== appWorkspacesRef.current.activeWorkspaceId) {
				dispatchAppWorkspaces({ type: "workspace/select", workspaceId: wsId });
			}
			createScopedWorkspaceDispatch(wsId)({
				type: "session/selectWorktree",
				worktreeId,
			});
		});
		// Stable refs; subscribe once.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

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
					<RepositoryInput onLoadPath={(path) => handleLoadPath(path)} />
					{startupError && <p className="shell-error">{startupError}</p>}
					{error && <p className="shell-error">Error: {error}</p>}
				</section>
			</main>
		);
	}

	return (
		<ToastProvider>
			<TooltipProvider delayDuration={300}>
				<AgentAttentionBanner />
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
								sidebarCollapsed ? 88 : sidebarWidth
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
							onOpenWorkflowDetail={(workspaceId, worktreeId) =>
								setWorkflowDetailTarget({ workspaceId, worktreeId })
							}
							dispatch={dispatch}
							collapsedWorkspaceIds={collapsedWorkspaceIds}
							onToggleWorkspaceCollapsed={toggleWorkspaceCollapsed}
							palette={palette}
							onSetTheme={setTheme}
							onOpenShortcutsHelp={() => setShortcutsHelpOpen(true)}
						/>

						<section className="shell-main-column" ref={mainColRef}>
							<MainColumnChrome
								downloadingBannerInfo={downloadingBannerInfo}
								downloadedBannerInfo={downloadedBannerInfo}
								onRestartUpdate={() => void system.installUpdate()}
								onLaterUpdate={() =>
									setUpdateDismissedFor(downloadedBannerInfo?.version ?? null)
								}
								chipBarRef={chipBarRef}
								activeWorktree={activeWorktree}
								activeSession={activeSession ?? null}
								activeSummary={activeSummary}
								changedFileCount={changes.length}
								activeWorkspaceId={activeWorkspaceId}
								setSidebarCollapsed={setSidebarCollapsed}
								setPendingRename={setPendingRename}
								openReview={() => setReviewOpen(true)}
								openCommandPalette={() => setCommandPaletteOpen(true)}
								dispatch={dispatch}
								noteSheetOpen={noteSheetOpen}
								setNoteSheetOpen={setNoteSheetOpen}
								filesOverlayOpen={filesOverlayOpen}
								setFilesOverlayOpen={setFilesOverlayOpen}
								trackedFilesLoader={trackedFilesLoader}
								gitStatusMap={gitStatusMap}
								shortcutsHelpOpen={shortcutsHelpOpen}
								setShortcutsHelpOpen={setShortcutsHelpOpen}
								appPlatform={appPlatform}
								openWorktreePaths={worktrees
									.filter((w) => workspaceState.sessionsByWorktreeId[w.id])
									.map((w) => w.path)}
								onOpenPlugins={() => setPluginsDialogOpen(true)}
							/>

							<div className="shell-terminal-frame">
								{activeWorktree && (
									<div className="terminal-chrome-header-anchor">
										<TerminalChromeHeader
											agentLauncher={
												<AgentLauncherBar
													probes={agentClis}
													whisperHealthy={whisperOnHealthy}
													whisperState={activeWhisperState}
													deferredProvider={deferredMount.deferredProvider}
													onLaunch={(provider) =>
														launchAgent(provider, undefined)
													}
												/>
											}
											terminalActions={
												<>
													<FloatingShellPills
														floatingShellIds={floatingShellIds}
														processSessionsById={
															workspaceState.processSessionsById
														}
														expandedId={expandedFloatingShellId}
														onExpand={handleExpandFloatingShell}
														onClose={handleCloseFloatingShell}
													/>
													<TerminalActions
														presets={workspaceState.commandPresets}
														addDisabled={addDisabled}
														onAddAdHoc={handleAddAdHoc}
														onLaunchPreset={launchPreset}
														onOpenPresetManager={() =>
															setPresetManagerOpen(true)
														}
														onOpenLayoutDialog={() => setLayoutDialogOpen(true)}
														platform={appPlatform}
													/>
												</>
											}
										/>
										{expandedFloatingProcess && (
											<FloatingShellPopover
												key={expandedFloatingProcess.id}
												process={expandedFloatingProcess}
												session={expandedFloatingSession}
												theme={terminalTheme}
												initialPosition={
													floatingPositionsRef.current.get(
														expandedFloatingProcess.id,
													) ?? null
												}
												onPositionChange={(p) => {
													const id = expandedFloatingProcess.id;
													if (p) floatingPositionsRef.current.set(id, p);
													else floatingPositionsRef.current.delete(id);
												}}
												initialSize={floatingSharedSizeRef.current}
												onSizeChange={(s) => {
													floatingSharedSizeRef.current = s;
												}}
												pinDisabled={addDisabled}
												onMinimize={handleMinimizeFloatingShell}
												onPin={handlePinFloatingShell}
												onClose={handleCloseFloatingShell}
												onTitleChange={(title) => {
													const nextLabel = normalizeTerminalTitle(title);
													if (!nextLabel) return;
													createScopedWorkspaceDispatch(
														activeWorkspaceId ?? "",
													)({
														type: "session/updateProcessLabel",
														processId: expandedFloatingProcess.id,
														label: nextLabel,
													});
												}}
											/>
										)}
									</div>
								)}

								{/*
								 * Render a terminal panel for every hydrated workspace, not just the
								 * active one. Only the active workspace's panel is visible; the rest
								 * stay mounted but hidden via CSS. Keeping inactive panels mounted
								 * means their xterm instances keep their PTY output subscription alive
								 * and never lose scrollback when the user switches workspaces and back
								 * (previously the panel was unmounted on switch, disposing the xterm and
								 * rendering blank on return). Panes are keyed by processId within each
								 * panel and panels by workspaceId, so switching only flips visibility —
								 * no unmount/remount of the xterm instances.
								 */}
								<div className="shell-terminal-layer">
									{appWorkspaces.workspaceOrder.map((id) => {
										const ws = appWorkspaces.workspacesById[id];
										if (!ws || ws.workspaceState === null) return null;
										const isActive = ws.workspaceId === activeWorkspaceId;
										const wsState = isActive
											? workspaceState
											: ws.workspaceState;
										const wsSelectedWorktreeId = wsState.selectedWorktreeId;
										const wsActiveWorktree = isActive
											? activeWorktree
											: (ws.worktrees.find(
													(w) => w.id === wsSelectedWorktreeId,
												) ?? null);
										const wsActiveSession = isActive
											? (activeSession ?? null)
											: wsSelectedWorktreeId
												? (wsState.sessionsByWorktreeId[wsSelectedWorktreeId] ??
													null)
												: null;
										const wsSlotProcessIds =
											wsActiveSession?.slotProcessIds ?? [null];
										return (
											<div
												key={ws.workspaceId}
												className="shell-terminal-host"
												data-active={isActive ? "true" : "false"}
												data-workspace-id={ws.workspaceId}
											>
												<TerminalPanel
													panelVisible={isActive}
													suppressAutoFocus={isActive && reviewOpen}
													terminalTheme={terminalTheme}
													workspaceState={wsState}
													activeWorktree={wsActiveWorktree}
													activeSession={wsActiveSession}
													sessions={sessions}
													layoutId={wsActiveSession?.terminalLayoutId ?? "1"}
													slotProcessIds={wsSlotProcessIds}
													terminalFocusSignal={terminalFocusSignal}
													// Workspace-pinned dispatch so terminal title (OSC) updates
													// emitted by a hidden workspace's PTY always route to THAT
													// workspace, not whichever one is currently active. A fresh
													// scoped dispatch is created per event to avoid stale base
													// state.
													dispatch={(action) =>
														createScopedWorkspaceDispatch(ws.workspaceId)(
															action,
														)
													}
													selectActiveProcess={
														isActive ? selectActiveProcess : NOOP
													}
													onCloseSlot={isActive ? handleCloseProcess : NOOP}
													onRestartSlot={isActive ? handleRestartProcess : NOOP}
													onPromoteSlot={isActive ? handlePromoteSlot : NOOP}
													onStartShellInSlot={
														isActive ? handleStartShellInSlot : NOOP
													}
													agentProviders={visibleProviders(agentClis)}
													onLaunchAgentInSlot={
														isActive ? handleLaunchAgentInSlot : NOOP
													}
													findProcessByTerminalSessionId={
														findProcessByTerminalSessionId
													}
												/>
											</div>
										);
									})}
								</div>
							</div>
							{activeWorktree && (
								<TerminalLayoutDialog
									open={layoutDialogOpen}
									runningShells={runningShells}
									currentLayoutId={activeSession?.terminalLayoutId ?? "1"}
									onSelect={handleSelectLayout}
									onClose={() => setLayoutDialogOpen(false)}
								/>
							)}

							<PluginsPanelDialog
								open={pluginsDialogOpen}
								onOpenChange={setPluginsDialogOpen}
								onInstall={(command) => {
									(
										window as unknown as {
											__lastPluginCommand?: string;
										}
									).__lastPluginCommand = command;
									void runCommandInFloatingShell(command, {
										label: "plugin install",
										autoCloseOnZero: true,
										onExit: () => void pluginsClient.reprobe(),
									});
								}}
								onConfigure={(command) => {
									(
										window as unknown as {
											__lastPluginCommand?: string;
										}
									).__lastPluginCommand = command;
									void runCommandInFloatingShell(command, {
										label: "plugin configure",
										autoCloseOnZero: true,
										onExit: () => void pluginsClient.reprobe(),
									});
								}}
							/>

							{workflowDetailTarget && (
								<WorkflowDetail
									open
									onOpenChange={(next) => {
										if (!next) setWorkflowDetailTarget(null);
									}}
									state={
										whisperStates.get(workflowDetailTarget.worktreeId) ?? null
									}
									workspaceId={workflowDetailTarget.workspaceId}
									worktreeId={workflowDetailTarget.worktreeId}
									onCommandError={(message) => notifyToast(message)}
									onCommandReply={(message) => notifyToast(message)}
								/>
							)}

							{activeWorktree && (
								<ReviewChipBar
									isDirty={activeSummary?.isDirty ?? false}
									changedFileCount={changes.length}
									reviewMode={activeSession?.reviewMode ?? "files"}
									openCommentCount={openCommentCount}
									addressedCommentCount={addressedCommentCount}
									canOpenFiles={canOpenFiles}
									onRefresh={handleRefreshChanges}
									onOpen={() => setReviewOpen(true)}
									onOpenFiles={handleOpenFilesChip}
								/>
							)}
							{reviewOpen && activeWorktree && (
								<ReviewExpandedPortal
									ref={expandedPortalRef}
									mainColRef={mainColRef}
									chipBarRef={chipBarRef}
									onCollapse={() => setReviewOpen(false)}
									onRefresh={handleRefreshChanges}
									reviewMode={activeSession?.reviewMode ?? "files"}
									isDirty={activeSummary?.isDirty ?? false}
									changedFileCount={changes.length}
								>
									<CodeNavHygiene
										workspaceId={activeWorkspaceId ?? ""}
										worktreeId={activeWorktree.id}
										worktreeRoot={activeWorktree.path}
									/>
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
										resolvedTheme={resolvedTheme}
										installCtaVisible={installCtaVisible}
										onOpenInstall={() => setInstallModalOpen(true)}
										dispatch={dispatch}
										handlePushBranch={handlePushBranch}
										handleSelectChangedFile={handleSelectChangedFile}
										setDiscardPath={setDiscardPath}
										bumpRefreshKey={() => setRefreshKey((k) => k + 1)}
										addingDraft={addingDraft}
										setAddingDraft={setAddingDraft}
										updateAddingDraftBody={updateAddingDraftBody}
										pendingCommentJump={pendingCommentJump}
										onConsumePendingCommentJump={() => setPendingCommentJump(0)}
										onCloseReview={() => setReviewOpen(false)}
									/>
								</ReviewExpandedPortal>
							)}
						</section>
					</div>

					<PresetManager
						open={presetManagerOpen}
						presets={workspaceState.commandPresets}
						onOpenChange={setPresetManagerOpen}
						onSave={(preset) => dispatch({ type: "preset/upsert", preset })}
						onDelete={(presetId) =>
							dispatch({ type: "preset/remove", presetId })
						}
						onLaunch={(presetId) => {
							setPresetManagerOpen(false);
							launchPreset(presetId);
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
						baseBranches={baseBranches}
						selectedBaseBranch={selectedBaseBranch}
						setSelectedBaseBranch={setSelectedBaseBranch}
						baseBranchLoading={baseBranchLoading}
						baseBranchWarning={baseBranchWarning}
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
				<CommandPalette
					open={commandPaletteOpen}
					onOpenChange={setCommandPaletteOpen}
					platform={appPlatform}
				/>
			</TooltipProvider>
		</ToastProvider>
	);
}
