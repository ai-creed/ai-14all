import {
	useEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
	type MouseEvent as ReactMouseEvent,
} from "react";
import * as ScrollArea from "@radix-ui/react-scroll-area";
import * as Tabs from "@radix-ui/react-tabs";
import type { Repository } from "../../shared/models/repository";
import type { Worktree } from "../../shared/models/worktree";
import type { GitDiff } from "../../shared/models/git-diff";
import type { ProcessSession } from "../../shared/models/process-session";
import type {
	PersistedWorkspaceState,
	PersistedWorktreeSession,
	RestorePreference,
	WorkspaceSnapshot,
} from "../../shared/models/persisted-workspace-state";
import type {
	CreateWorktreePreview,
	RemoveWorktreePreview,
} from "../../shared/models/worktree-lifecycle";
import { DEFAULT_PERSISTED_WORKSPACE_STATE } from "../../shared/models/persisted-workspace-state";
import { buildWorkspaceSnapshot, rebaseSnapshotPaths, reconcileSnapshotToWorktrees, shouldReattachSnapshot, splitPendingRestores } from "../features/workspace/workspace-persistence";
import { RepositoryInput } from "../features/repository/RepositoryInput";
import { RestorePrompt } from "../features/repository/RestorePrompt";
import { SessionSidebar } from "../features/workspace/SessionSidebar";
import { SessionHeader } from "../features/workspace/SessionHeader";
import { ContextPanel } from "../features/workspace/ContextPanel";
import {
	createWorkspaceState,
	workspaceReducer,
} from "../features/workspace/workspace-state";
import { TerminalTabs } from "../features/terminals/TerminalTabs";
import { TerminalPane } from "../features/terminals/TerminalPane";
import { PresetManager } from "../features/terminals/PresetManager";
import { NewWorktreeDialog } from "../features/workspace/NewWorktreeDialog";
import { RemoveWorktreeDialog } from "../features/workspace/RemoveWorktreeDialog";
import { useTerminalSession } from "../features/terminals/useTerminalSession";
import { deriveAttentionState } from "../features/terminals/process-attention";
import { FileList } from "../features/viewer/FileList";
import { FileViewer } from "../features/viewer/FileViewer";
import { ChangesList } from "../features/git/ChangesList";
import { DiffViewer } from "../features/viewer/DiffViewer";
import { CommitList } from "../features/git/CommitList";
import { CommitDiffStack } from "../features/git/CommitDiffStack";
import type { GitCommitHistory, GitCommitDetail } from "../../shared/models/git-commit-review";
import { git, workspace, repository as repositoryClient } from "../lib/desktop-client";
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
	const [reviewRailWidth, setReviewRailWidth] = useState(320);
	const [reviewPanelHeight, setReviewPanelHeight] = useState(280);
	const [reviewPanelCollapsed, setReviewPanelCollapsed] = useState(false);
	const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
	const [repository, setRepository] = useState<Repository | null>(null);
	const [worktrees, setWorktrees] = useState<Worktree[]>([]);
	const [workspaceState, dispatch] = useReducer(
		workspaceReducer,
		createWorkspaceState([]),
	);
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

	const [commitHistoryState, setCommitHistoryState] = useState<ReviewLoadState<GitCommitHistory>>({
		data: null,
		stale: false,
		message: null,
	});
	const [commitDetailState, setCommitDetailState] = useState<ReviewLoadState<GitCommitDetail>>({
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
	const [createPreview, setCreatePreview] = useState<CreateWorktreePreview | null>(null);
	const [createLoading, setCreateLoading] = useState(false);
	const [createError, setCreateError] = useState<string | null>(null);
	const [createBusy, setCreateBusy] = useState(false);
	const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
	const [removeTargetId, setRemoveTargetId] = useState<string | null>(null);
	const [removePreview, setRemovePreview] = useState<RemoveWorktreePreview | null>(null);
	const [removeError, setRemoveError] = useState<string | null>(null);
	const [removeBusy, setRemoveBusy] = useState(false);
	const [startupMode, setStartupMode] = useState<StartupMode>("loading");
	const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);
	const [restoreState, setRestoreState] = useState<PersistedWorkspaceState>(
		DEFAULT_PERSISTED_WORKSPACE_STATE,
	);
	const [startupError, setStartupError] = useState<string | null>(null);
	const [restoreWarning, setRestoreWarning] = useState<string | null>(null);
	const [pendingRestoreSessions, setPendingRestoreSessions] = useState<Record<string, PersistedWorktreeSession>>({});

	useEffect(() => {
		let cancelled = false;

		workspace.readRestoreState().then((state) => {
			if (cancelled) return;
			setRestoreState(state);

			if (!state.snapshot) {
				setStartupMode("ready");
				return;
			}
			if (state.restorePreference === "alwaysStartClean") {
				setStartupMode("ready");
				return;
			}
			if (state.restorePreference === "alwaysRestore") {
				void restoreWorkspace(state.snapshot, state.restorePreference);
				return;
			}
			setStartupMode("prompt");
		}).catch((err) => {
			if (cancelled) return;
			setStartupError(`Failed to load workspace state: ${String(err)}`);
			setStartupMode("ready");
		});

		return () => {
			cancelled = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps -- startup-only effect; restoreWorkspace is intentionally excluded to prevent re-runs on re-render
	}, []);

	useEffect(() => workspace.onOpenPicker(() => {
		if (startupMode !== "ready" || repository === null) return;
		setError(null);
		setStartupError(null);
		setWorkspacePickerOpen(true);
	}), [startupMode, repository]);

	const activeWorktree =
		worktrees.find((w) => w.id === workspaceState.selectedWorktreeId) ?? null;
	const activeSession = workspaceState.selectedWorktreeId
		? (workspaceState.sessionsByWorktreeId[workspaceState.selectedWorktreeId] ??
			null)
		: null;

	function findProcessByTerminalSessionId(
		terminalSessionId: string,
	): ProcessSession | null {
		return (
			Object.values(workspaceState.processSessionsById).find(
				(process) => process.terminalSessionId === terminalSessionId,
			) ?? null
		);
	}

	const { sessions, createSession, sendInput, stopSession, removeSession } =
		useTerminalSession({
			onOutput: (event) => {
				const process = findProcessByTerminalSessionId(event.sessionId);
				if (!process) return;
				dispatch({
					type: "session/recordProcessOutput",
					worktreeId: process.worktreeId,
					processId: process.id,
					attentionState: deriveAttentionState(event.data),
					at: Date.now(),
					isViewed:
						process.id === activeSession?.activeProcessSessionId &&
						process.worktreeId === activeWorktree?.id,
				});
			},
			onExit: (event) => {
				const process = findProcessByTerminalSessionId(event.sessionId);
				if (!process) return;
				dispatch({
					type: "session/updateProcessStatus",
					processId: process.id,
					status: "exited",
					exitCode: event.exitCode ?? null,
				});
			},
		});

	async function handleLoad(repo: Repository, wts: Worktree[]) {
		if (repository?.rootPath === repo.rootPath) {
			setWorkspacePickerOpen(false);
			setError(null);
			setStartupError(null);
			return;
		}

		if (shouldReattachSnapshot(repo, restoreState.snapshot)) {
			setRepository(repo);
			setWorktrees(wts);
			defaultShellEnsuredByWorktreeRef.current.clear();
			const originalSnapshot = restoreState.snapshot!;
			const rebasedSnapshot = rebaseSnapshotPaths(
				originalSnapshot,
				originalSnapshot.repositoryPath,
				repo.rootPath,
			);
			const nextSnapshot: WorkspaceSnapshot = {
				...reconcileSnapshotToWorktrees(rebasedSnapshot, originalSnapshot, wts),
				repositoryPath: repo.rootPath,
				repoId: repo.repoId,
			};
			dispatch({
				type: "workspace/restoreSnapshot",
				worktrees: wts,
				snapshot: nextSnapshot,
			});
			const { selectedSession, pendingByWorktreeId } = splitPendingRestores(nextSnapshot);
			setPendingRestoreSessions(pendingByWorktreeId);
			setRestoreState({
				version: 1 as const,
				restorePreference: restoreState.restorePreference,
				snapshot: nextSnapshot,
			});
			const selectedWorktree = wts.find((w) => w.id === nextSnapshot.selectedWorktreeId);
			const degradedNote = !repo.repoId
				? " Repository identity could not be verified — future recovery will rely on folder name matching."
				: "";
			if (selectedWorktree && selectedSession) {
				await recreatePersistedProcesses(selectedWorktree, selectedSession);
				setRestoreWarning(
					`Recovered your previous workspace after the repository path changed.${degradedNote}`,
				);
			} else if (nextSnapshot.selectedWorktreeId && !selectedWorktree) {
				setRestoreWarning(
					`Recovered the previous workspace, but the selected worktree is no longer available.${degradedNote}`,
				);
				if (selectedSession) {
					// Keep the saved session in pending so the next persist write
					// re-serialises it. Without this the session is permanently lost
					// after the first write because buildWorkspaceSnapshot only reads
					// from workspaceState, which has no entry for a missing worktree.
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

		setRepository(repo);
		setWorktrees(wts);
		defaultShellEnsuredByWorktreeRef.current.clear();
		setPendingRestoreSessions({});
		dispatch({ type: "workspace/loadWorktrees", worktrees: wts });
		setError(null);
		setStartupError(null);
		setRestoreWarning(null);
		setWorkspacePickerOpen(false);
	}

	async function restoreWorkspace(
		snapshot: WorkspaceSnapshot,
		nextPreference: RestorePreference,
	) {
		try {
			const repo = await repositoryClient.setRoot(snapshot.repositoryPath);
			const wts = await repositoryClient.listWorktrees();
			setRepository(repo);
			setWorktrees(wts);

			dispatch({
				type: "workspace/restoreSnapshot",
				worktrees: wts,
				snapshot,
			});

			const { selectedSession, pendingByWorktreeId } = splitPendingRestores(snapshot);
			setPendingRestoreSessions(pendingByWorktreeId);
			setRestoreState({
				version: 1,
				restorePreference: nextPreference,
				snapshot,
			});
			setStartupMode("ready");
			setStartupError(null);

			const selectedWorktree = wts.find(
				(worktree) => worktree.id === (snapshot.selectedWorktreeId ?? ""),
			);
			if (selectedWorktree && selectedSession) {
				await recreatePersistedProcesses(selectedWorktree, selectedSession);
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
			const fallbackState: PersistedWorkspaceState = {
				version: 1,
				restorePreference: "prompt",
				snapshot,
			};
			setRestoreState(fallbackState);
			void workspace.writeRestoreState(fallbackState);
			setStartupMode("ready");
		}
	}

	async function recreatePersistedProcesses(
		worktree: Worktree,
		sessionSnapshot: PersistedWorktreeSession,
	) {
		for (const process of sessionSnapshot.processSessions) {
			try {
				const terminal = await createSession(worktree.id, worktree.path);
				dispatch({
					type: "session/replaceProcessTerminal",
					processId: process.id,
					terminalSessionId: terminal.id,
				});
				dispatch({
					type: "session/updateProcessStatus",
					processId: process.id,
					status: "running",
					exitCode: null,
				});

				if (process.command) {
					await sendInput(terminal.id, `${process.command}\n`);
				}
			} catch {
				dispatch({
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
	const scopeRoots = useMemo(
		() => [
			...new Set(
				changes
					.map((change) => {
						const lastSlash = change.path.lastIndexOf("/");
						return lastSlash === -1 ? "." : change.path.slice(0, lastSlash);
					})
					.filter(Boolean),
			),
		],
		[changes],
	);

	const persistableSnapshot = useMemo(
		() => {
			if (!repository) return null;
			const base = buildWorkspaceSnapshot(repository.rootPath, repository.repoId, workspaceState);
			// Also persist sessions that are in pendingRestoreSessions but have no
			// corresponding entry in workspaceState (i.e. the previously selected
			// worktree is missing from the current repo). Without this they would be
			// dropped from the snapshot on the first write after restore.
			const baseIds = new Set(base.worktreeSessions.map((s) => s.worktreeId));
			const orphaned = Object.values(pendingRestoreSessions).filter(
				(s) => !baseIds.has(s.worktreeId),
			);
			return orphaned.length === 0
				? base
				: { ...base, worktreeSessions: [...base.worktreeSessions, ...orphaned] };
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps -- repository.rootPath and repository.repoId drive the snapshot; the object reference changes are irrelevant
		[repository?.rootPath, repository?.repoId, workspaceState, pendingRestoreSessions],
	);
	const persistableState = useMemo(
		() => ({
			version: 1 as const,
			restorePreference: restoreState.restorePreference,
			// When no repository is open (e.g. user chose start-clean and has not
			// yet loaded a new repo) keep the previous snapshot intact so the user
			// can still restore it on a future launch.
			snapshot: persistableSnapshot ?? restoreState.snapshot,
		}),
		[persistableSnapshot, restoreState.restorePreference, restoreState.snapshot],
	);
	const persistableStateJson = useMemo(
		() => JSON.stringify(persistableState),
		[persistableState],
	);

	useEffect(() => {
		if (startupMode !== "ready") return;
		void workspace.writeRestoreState(persistableState);
		// eslint-disable-next-line react-hooks/exhaustive-deps -- persistableStateJson is used for change detection; persistableState (same data) is used for the write
	}, [startupMode, persistableStateJson]);

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
	}, [startupMode, activeWorktree?.id, activeSession?.processSessionIds.length]);

	// Fetch git summary when active worktree changes or user refreshes
	useEffect(() => {
		if (!activeWorktree?.path) return;
		let cancelled = false;

		dispatch({ type: "session/startGitSummaryRefresh", worktreeId: activeWorktree.id });

		git.readSummary(activeWorktree.path).then((summary) => {
			if (cancelled) return;
			dispatch({
				type: "session/cacheGitSummarySuccess",
				worktreeId: activeWorktree.id,
				gitSummary: summary,
			});
		}).catch((err) => {
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
		if (!createDialogOpen || !createName.trim()) {
			setCreatePreview(null);
			setCreateError(null);
			return;
		}
		let cancelled = false;
		const timeoutId = window.setTimeout(() => {
			setCreateLoading(true);
			repositoryClient.previewCreateWorktree(createName).then((preview) => {
				if (cancelled) return;
				setCreatePreview(preview);
				setCreateError(null);
			}).catch((err) => {
				if (cancelled) return;
				setCreatePreview(null);
				setCreateError(err instanceof Error ? err.message : String(err));
			}).finally(() => {
				if (!cancelled) setCreateLoading(false);
			});
		}, 350);
		return () => {
			cancelled = true;
			window.clearTimeout(timeoutId);
		};
	}, [createDialogOpen, createName]);

	useEffect(() => {
		if (!removeDialogOpen || !removeTargetId) {
			setRemovePreview(null);
			setRemoveError(null);
			return;
		}
		let cancelled = false;
		repositoryClient.previewRemoveWorktree(removeTargetId).then((preview) => {
			if (!cancelled) {
				setRemovePreview(preview);
				setRemoveError(null);
			}
		}).catch((err) => {
			if (!cancelled) {
				setRemovePreview(null);
				setRemoveError(err instanceof Error ? err.message : String(err));
			}
		});
		return () => { cancelled = true; };
	}, [removeDialogOpen, removeTargetId]);

	async function refreshWorktreeInventory(options?: {
		preferredSelectedWorktreeId?: string | null;
		skipRuntimeCleanupWorktreeIds?: string[];
	}) {
		if (!repository) return;
		const latest = await repositoryClient.listWorktrees();
		const latestIds = new Set(latest.map((worktree) => worktree.id));
		const skipCleanupIds = new Set(options?.skipRuntimeCleanupWorktreeIds ?? []);
		const removedWorktreeIds = worktreesRef.current
			.filter((worktree) => !latestIds.has(worktree.id))
			.filter((worktree) => !skipCleanupIds.has(worktree.id))
			.map((worktree) => worktree.id);

		for (const removedWorktreeId of removedWorktreeIds) {
			const removedSession = workspaceStateRef.current.sessionsByWorktreeId[removedWorktreeId];
			if (!removedSession) continue;
			for (const processId of removedSession.processSessionIds) {
				const process = workspaceStateRef.current.processSessionsById[processId];
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

		setWorktrees(latest);
		dispatch({ type: "workspace/reconcileWorktrees", worktrees: latest });
		if (options?.preferredSelectedWorktreeId && latestIds.has(options.preferredSelectedWorktreeId)) {
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

	useEffect(() => {
		const handleFocus = () => setWindowFocused(true);
		const handleBlur = () => setWindowFocused(false);
		window.addEventListener("focus", handleFocus);
		window.addEventListener("blur", handleBlur);
		return () => {
			window.removeEventListener("focus", handleFocus);
			window.removeEventListener("blur", handleBlur);
		};
	}, []);

	useEffect(() => {
		if (startupMode !== "ready" || !repository || !activeWorktree || !windowFocused) return;

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

	function handleReviewRailResizeStart(
		event: ReactMouseEvent<HTMLDivElement>,
	) {
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

	async function handleSelectWorktree(worktreeId: string) {
		const pending = pendingRestoreSessions[worktreeId];
		if (pending) {
			dispatch({ type: "session/restoreSnapshot", snapshot: pending });
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
			const session = workspaceState.sessionsByWorktreeId[worktreeId];
			if (session?.activeProcessSessionId) {
				dispatch({
					type: "session/markProcessViewed",
					worktreeId,
					processId: session.activeProcessSessionId,
				});
			}
		}

		if (pending) {
			const worktree = worktrees.find((entry) => entry.id === worktreeId);
			if (worktree) {
				await recreatePersistedProcesses(worktree, pending);
			}
		}
	}

	async function handleConfirmCreateWorktree() {
		if (!createPreview) return;
		setCreateBusy(true);
		try {
			const created = await repositoryClient.createWorktree(createName);
			await refreshWorktreeInventory({ preferredSelectedWorktreeId: created.id });
			setCreateDialogOpen(false);
			setCreateName("");
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
	}

	async function handleConfirmRemoveWorktree() {
		if (!removePreview) return;
		setRemoveBusy(true);
		try {
			await closeProcessesForWorktree(removePreview.worktreeId);
			await repositoryClient.removeWorktree(removePreview.worktreeId);
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
				if (!cancelled) setDiffState({ data: result, stale: false, message: null });
			})
			.catch(() => {
				if (!cancelled) {
					const requestedPath = activeSession.selectedChangedFilePath;
					setDiffState((prev) => {
						const canPreserve = prev.data !== null && prev.data.path === requestedPath;
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
	}, [
		activeWorktree?.path,
		activeSession?.selectedChangedFilePath,
		changes,
	]);

	// Fetch commit history when active worktree changes or after refresh
	useEffect(() => {
		if (!activeWorktree?.path) {
			setCommitHistoryState({ data: null, stale: false, message: null });
			return;
		}
		let cancelled = false;
		setCommitHistoryState((prev) => ({ ...prev, message: null }));
		git.readCommitHistory(activeWorktree.path).then((history) => {
			if (cancelled) return;
			// Clear the selected commit if it's no longer in the refreshed history
			if (
				activeSession?.selectedCommitSha &&
				!history.entries.some((e) => e.sha === activeSession.selectedCommitSha)
			) {
				dispatch({ type: "session/clearSelectedCommit", worktreeId: activeWorktree.id });
			}
			setCommitHistoryState({ data: history, stale: false, message: null });
		}).catch(() => {
			if (cancelled) return;
			setCommitHistoryState((prev) => ({
				...prev,
				stale: prev.data !== null,
				message: prev.data === null
					? "Couldn't load commit history."
					: "Couldn't refresh commit history. Showing last successful result.",
			}));
		});
		return () => { cancelled = true; };
	}, [activeWorktree?.id, activeWorktree?.path, refreshKey]);

	// Fetch commit detail when selected commit changes
	useEffect(() => {
		if (!activeWorktree?.path || !activeSession?.selectedCommitSha) {
			setCommitDetailState({ data: null, stale: false, message: null });
			return;
		}
		let cancelled = false;
		setCommitDetailState((prev) => ({ ...prev, message: null }));
		git.readCommitDetail(activeWorktree.path, activeSession.selectedCommitSha).then((detail) => {
			if (!cancelled) {
				setCommitDetailState({ data: detail, stale: false, message: null });
			}
		}).catch(() => {
			if (!cancelled) {
				const requestedSha = activeSession.selectedCommitSha;
				setCommitDetailState((prev) => {
					const canPreserve = prev.data !== null && prev.data.sha === requestedSha;
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
		return () => { cancelled = true; };
	}, [activeWorktree?.path, activeSession?.selectedCommitSha]);

	function handleSelectChangedFile(relativePath: string) {
		if (!activeWorktree) return;
		dispatch({
			type: "session/selectChangedFile",
			worktreeId: activeWorktree.id,
			relativePath,
		});
	}

	async function handleAddAdHoc() {
		if (!activeWorktree) return;
		try {
			const termSession = await createSession(
				activeWorktree.id,
				activeWorktree.path,
			);
			const adHocNumber =
				workspaceState.nextAdHocNumberByWorktreeId[activeWorktree.id] ?? 1;
			const process: ProcessSession = {
				id: crypto.randomUUID(),
				worktreeId: activeWorktree.id,
				terminalSessionId: termSession.id,
				origin: "adHoc",
				presetId: null,
				label: `shell ${adHocNumber}`,
				command: null,
				status: "running",
				lastActivityAt: null,
				exitCode: null,
				pinned: false,
				attentionState: "idle",
			};
			dispatch({
				type: "session/registerProcess",
				worktreeId: activeWorktree.id,
				process,
			});
		} catch (err) {
			console.error("Failed to create terminal session:", err);
			throw err;
		}
	}

	async function handleCloseProcess(processId: string) {
		if (!activeWorktree) return;
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
				removeSession(terminalId);
			}
		}
		dispatch({
			type: "session/closeProcess",
			worktreeId: activeWorktree.id,
			processId,
		});
	}

	async function handleLaunchPreset(presetId: string) {
		if (!activeWorktree) return;
		const preset = workspaceState.commandPresets.find((p) => p.id === presetId);
		if (!preset) return;
		const terminal = await createSession(
			activeWorktree.id,
			activeWorktree.path,
		);
		dispatch({
			type: "session/registerProcess",
			worktreeId: activeWorktree.id,
			process: {
				id: crypto.randomUUID(),
				worktreeId: activeWorktree.id,
				terminalSessionId: terminal.id,
				origin: "preset",
				presetId: preset.id,
				label: preset.label,
				command: preset.command,
				status: "running",
				lastActivityAt: null,
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
		if (!process || !activeWorktree) return;

		if (process.terminalSessionId) {
			try {
				await stopSession(process.terminalSessionId);
			} catch {
				// best effort
			}
			removeSession(process.terminalSessionId);
		}

		const terminal = await createSession(
			activeWorktree.id,
			activeWorktree.path,
		);
		dispatch({
			type: "session/replaceProcessTerminal",
			processId,
			terminalSessionId: terminal.id,
		});
		dispatch({
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
			const nextState: PersistedWorkspaceState = {
				version: 1,
				restorePreference: nextPreference,
				snapshot: restoreState.snapshot,
			};
			setRestoreState(nextState);
			await workspace.writeRestoreState(nextState);
			setStartupMode("ready");
			return;
		}

		if (restoreState.snapshot) {
			await restoreWorkspace(restoreState.snapshot, nextPreference);
		}
	}

	const attentionByWorktreeId = Object.fromEntries(
		Object.entries(workspaceState.sessionsByWorktreeId).map(
			([worktreeId, session]) => [worktreeId, session.attentionState],
		),
	);

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

	if (startupMode === "prompt" && restoreState.snapshot) {
		return (
			<main className="shell-app shell-app--setup">
				<RestorePrompt
					repositoryPath={restoreState.snapshot.repositoryPath}
					onDecide={handleRestoreDecision}
				/>
			</main>
		);
	}

	if (!repository || workspacePickerOpen) {
		return (
			<main className="shell-app shell-app--setup">
				<section className="shell-panel shell-setup-panel">
					<h1 className="shell-setup-title">ai-14all</h1>
					<h2>Repository</h2>
					<RepositoryInput onLoad={handleLoad} />
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
						sidebarCollapsed ? 56 : 240
					}px minmax(0, 1fr)`,
				}}
			>
				<SessionSidebar
					worktrees={worktrees}
					selectedWorktreeId={workspaceState.selectedWorktreeId}
					attentionByWorktreeId={attentionByWorktreeId}
					collapsed={sidebarCollapsed}
					onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
					onSelect={(worktreeId) => {
						void handleSelectWorktree(worktreeId);
					}}
					onCreateWorktree={() => setCreateDialogOpen(true)}
					onRemoveWorktree={(worktreeId) => {
						setRemoveTargetId(worktreeId);
						setRemoveDialogOpen(true);
					}}
				/>

				<section className="shell-main-column">
					{activeWorktree && activeSession && (
						<section
							className="shell-panel shell-top-band"
							data-collapsed={workspaceState.topBandCollapsed ? "true" : "false"}
						>
							<button
								type="button"
								className="shell-top-band__toggle"
								aria-expanded={!workspaceState.topBandCollapsed}
								aria-label={
									workspaceState.topBandCollapsed
										? "Expand top band"
										: "Collapse top band"
								}
								onClick={() =>
									dispatch({
										type: "workspace/setTopBandCollapsed",
										collapsed: !workspaceState.topBandCollapsed,
									})
								}
							>
								<span aria-hidden="true">
									{workspaceState.topBandCollapsed ? "▾" : "▴"}
								</span>
							</button>
							<SessionHeader
								title={activeWorktree.label}
								worktreePath={activeWorktree.path}
								branchName={activeWorktree.branchName}
								changedFileCount={changes.length}
								isDirty={activeSummary?.isDirty ?? false}
								gitSummaryError={gitSummaryError}
								gitSummaryStale={gitSummaryStale}
								collapsed={workspaceState.topBandCollapsed}
							/>
							{!workspaceState.topBandCollapsed && (
								<ContextPanel
									note={activeSession.note}
									onNoteChange={(note) =>
										dispatch({
											type: "session/setNote",
											worktreeId: activeWorktree.id,
											note,
										})
									}
								/>
							)}
						</section>
					)}

					{workspaceState.selectedWorktreeId && (
						<section className="shell-panel shell-terminal-section">
							<TerminalTabs
								processes={(activeSession?.processSessionIds ?? [])
									.map((id) => workspaceState.processSessionsById[id])
									.filter(Boolean)
									.sort((a, b) => Number(b.pinned) - Number(a.pinned))
									.map((p) => ({
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
								onAddAdHoc={handleAddAdHoc}
								onSelect={(processId) => {
									dispatch({
										type: "session/selectProcess",
										worktreeId: activeWorktree!.id,
										processId,
									});
									dispatch({
										type: "session/markProcessViewed",
										worktreeId: activeWorktree!.id,
										processId,
									});
								}}
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
							/>

							<div className="shell-terminal-panel__body">
								{sessions.map((session) => {
									const activeProcess = activeSession?.activeProcessSessionId
										? workspaceState.processSessionsById[
												activeSession.activeProcessSessionId
											]
										: null;
									const process = findProcessByTerminalSessionId(session.id);
									return (
										<TerminalPane
											key={session.id}
											session={session}
											visible={
												session.worktreeId === activeWorktree?.id &&
												session.id === activeProcess?.terminalSessionId
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
										/>
									);
								})}

								{!sessions.some((session) => {
									const activeProcess = activeSession?.activeProcessSessionId
										? workspaceState.processSessionsById[
												activeSession.activeProcessSessionId
											]
										: null;
									return (
										session.worktreeId === activeWorktree?.id &&
										session.id === activeProcess?.terminalSessionId
									);
								}) && (
									<div className="shell-terminal-panel__empty">
										<p className="shell-empty-state">
											No active shell selected. Open or choose a shell to continue.
										</p>
									</div>
								)}
							</div>
						</section>
					)}

					{activeWorktree && (
						<section
							className="shell-review-stack"
							data-testid="review-stack"
							style={{
								gridTemplateRows: reviewPanelCollapsed
									? "auto"
									: `auto auto ${reviewPanelHeight}px`,
							}}
						>
							{!reviewPanelCollapsed && (
								<div
									role="separator"
									aria-orientation="horizontal"
									aria-label="Resize review panel"
									data-testid="review-panel-resize-handle"
									className="shell-review-stack__resize-handle"
									onMouseDown={handleReviewPanelResizeStart}
								/>
							)}

							<div
								className="shell-review-stack__header shell-panel"
								data-testid="review-stack-header"
							>
								<span className="shell-label">{
									activeSession?.reviewMode === "changes"
										? "Review: Changes"
										: activeSession?.reviewMode === "commits"
											? "Review: Commits"
											: "Review: Files"
								}</span>
								<div className="shell-review-switches">
									<button
										type="button"
										className="shell-button shell-button--compact shell-button--icon shell-button--round"
										aria-label="Refresh review"
										title="Refresh review"
										onClick={handleRefreshChanges}
									>
										<span aria-hidden="true">↻</span>
									</button>
									<button
										type="button"
										className="shell-button shell-button--compact shell-button--icon shell-button--round"
										aria-label={reviewPanelCollapsed ? "Expand review panel" : "Collapse review panel"}
										title={reviewPanelCollapsed ? "Expand review panel" : "Collapse review panel"}
										onClick={() => setReviewPanelCollapsed((c) => !c)}
									>
										<span aria-hidden="true">{reviewPanelCollapsed ? "▴" : "▾"}</span>
									</button>
								</div>
							</div>

							{!reviewPanelCollapsed && (
								<>

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
												<Tabs.Trigger value="files" className="shell-review-tab">
													Files
												</Tabs.Trigger>
												<Tabs.Trigger value="changes" className="shell-review-tab">
													Changes
												</Tabs.Trigger>
												<Tabs.Trigger value="commits" className="shell-review-tab">
													Commits
												</Tabs.Trigger>
											</Tabs.List>
										</div>

									<ScrollArea.Root className="shell-review-rail__scroll">
										<ScrollArea.Viewport className="shell-rail__viewport">
											{activeSession?.reviewMode === "commits" ? (
												<>
													{commitHistoryState.message && (
														<p className={commitHistoryState.stale ? "shell-inline-warning" : "shell-error"}>
															{commitHistoryState.message}
														</p>
													)}
													<CommitList
														history={commitHistoryState.data ?? { mergeTargetRef: null, entries: [] }}
														selectedCommitSha={activeSession.selectedCommitSha}
														selectedCommitFilePath={activeSession.selectedCommitFilePath}
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
													/>
												</>
											) : activeSession?.reviewMode === "files" ? (
												<FileList
													worktreePath={activeWorktree.path}
													scopeRoots={scopeRoots}
													selectedFile={activeSession.selectedFilePath}
													onSelect={(relativePath) =>
														dispatch({
															type: "session/selectFile",
															worktreeId: activeWorktree.id,
															relativePath,
														})
													}
													gitSummaryError={gitSummaryError}
													gitSummaryMessage={gitSummaryMessage}
												/>
											) : (
												<ChangesList
													changes={changes}
													selectedPath={
														activeSession?.selectedChangedFilePath ?? null
													}
													onSelect={handleSelectChangedFile}
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
									{activeSession?.reviewMode === "commits" && commitDetailState.message !== null && commitDetailState.data === null ? (
										<p className="shell-error">
											{commitDetailState.message}
										</p>
									) : activeSession?.reviewMode === "commits" && commitDetailState.data ? (
										<CommitDiffStack
											key={commitDetailState.data.sha}
											detail={commitDetailState.data}
											focusedPath={activeSession.selectedCommitFilePath}
										/>
									) : activeSession?.reviewMode === "files" &&
									activeSession.selectedFilePath ? (
										<FileViewer
											worktreePath={activeWorktree.path}
											relativePath={activeSession.selectedFilePath}
										/>
									) : activeSession?.reviewMode === "changes" && diffState.data ? (
										<DiffViewer
											path={diffState.data.path}
											content={diffState.data.content}
											originalContent={diffState.data.originalContent}
											modifiedContent={diffState.data.modifiedContent}
										/>
									) : (
										<p className="shell-empty-state">
											Select a file or changed file to inspect it.
										</p>
									)}
								</section>
							</div>
						</Tabs.Root>
						</>
					)}
				</section>
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
			<NewWorktreeDialog
				open={createDialogOpen}
				name={createName}
				preview={createPreview}
				loading={createLoading}
				error={createError}
				busy={createBusy}
				onOpenChange={(open) => {
					setCreateDialogOpen(open);
					if (!open) {
						setCreateName("");
						setCreateError(null);
					}
				}}
				onNameChange={setCreateName}
				onConfirm={() => {
					void handleConfirmCreateWorktree();
				}}
			/>
			<RemoveWorktreeDialog
				open={removeDialogOpen}
				preview={removePreview}
				runningProcessLabels={
					removeTargetId
						? (workspaceState.sessionsByWorktreeId[removeTargetId]?.processSessionIds ?? [])
								.map((id) => workspaceState.processSessionsById[id])
								.filter((process): process is ProcessSession => !!process && process.status === "running")
								.map((process) => process.label)
						: []
				}
				error={removeError}
				busy={removeBusy}
				onOpenChange={setRemoveDialogOpen}
				onConfirm={() => {
					void handleConfirmRemoveWorktree();
				}}
			/>
		</main>
	);
}
