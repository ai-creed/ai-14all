import { useEffect, useMemo, useReducer, useRef, useState } from "react";
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
import { DEFAULT_PERSISTED_WORKSPACE_STATE } from "../../shared/models/persisted-workspace-state";
import { buildWorkspaceSnapshot, splitPendingRestores } from "../features/workspace/workspace-persistence";
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

type StartupMode = "loading" | "prompt" | "ready";

export function App() {
	const [repository, setRepository] = useState<Repository | null>(null);
	const [worktrees, setWorktrees] = useState<Worktree[]>([]);
	const [workspaceState, dispatch] = useReducer(
		workspaceReducer,
		createWorkspaceState([]),
	);
	const [activeDiff, setActiveDiff] = useState<GitDiff | null>(null);
	const [refreshKey, setRefreshKey] = useState(0);
	const [commitHistory, setCommitHistory] = useState<GitCommitHistory | null>(null);
	const [commitHistoryError, setCommitHistoryError] = useState(false);
	const [activeCommitDetail, setActiveCommitDetail] = useState<GitCommitDetail | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [presetManagerOpen, setPresetManagerOpen] = useState(false);
	const [startupMode, setStartupMode] = useState<StartupMode>("loading");
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

	function handleLoad(repo: Repository, wts: Worktree[]) {
		setRepository(repo);
		setWorktrees(wts);
		dispatch({ type: "workspace/loadWorktrees", worktrees: wts });
		setError(null);
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
			setStartupError(
				err instanceof Error
					? `Unable to restore previous workspace: ${err.message}`
					: "Unable to restore previous workspace.",
			);
			// Clear the snapshot so a subsequent alwaysRestore launch does not
			// loop on the same broken repository path. Reset to "prompt" so the
			// user can choose whether to restore once the path is available again.
			const fallbackState: PersistedWorkspaceState = {
				version: 1,
				restorePreference: "prompt",
				snapshot: null,
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
			const base = buildWorkspaceSnapshot(repository.rootPath, workspaceState);
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
		// eslint-disable-next-line react-hooks/exhaustive-deps -- repository.rootPath drives the snapshot; the object reference changes are irrelevant
		[repository?.rootPath, workspaceState, pendingRestoreSessions],
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
		setActiveDiff(null);
		if (!activeWorktree?.path) return;
		let cancelled = false;

		git
			.readSummary(activeWorktree.path)
			.then((summary) => {
				if (cancelled) return;
				dispatch({
					type: "session/cacheGitSummary",
					worktreeId: activeWorktree.id,
					gitSummary: summary,
					error: false,
				});
			})
			.catch(() => {
				if (cancelled) return;
				dispatch({
					type: "session/cacheGitSummary",
					worktreeId: activeWorktree.id,
					gitSummary: null,
					error: true,
				});
			});

		return () => {
			cancelled = true;
		};
	}, [activeWorktree?.id, activeWorktree?.path, refreshKey]);

	function handleRefreshChanges() {
		setRefreshKey((k) => k + 1);
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

	// Fetch diff when selected changed file changes
	useEffect(() => {
		if (!activeWorktree?.path || !activeSession?.selectedChangedFilePath) {
			setActiveDiff(null);
			return;
		}
		let cancelled = false;
		git
			.readDiff(activeWorktree.path, activeSession.selectedChangedFilePath)
			.then((result) => {
				if (!cancelled) setActiveDiff(result);
			})
			.catch(() => {
				if (!cancelled) setActiveDiff(null);
			});
		return () => {
			cancelled = true;
		};
	}, [
		activeWorktree?.path,
		activeSession?.selectedChangedFilePath,
		refreshKey,
	]);

	// Fetch commit history when active worktree changes or after refresh
	useEffect(() => {
		setCommitHistory(null);
		setCommitHistoryError(false);
		if (!activeWorktree?.path) return;
		let cancelled = false;
		git.readCommitHistory(activeWorktree.path).then((history) => {
			if (cancelled) return;
			setCommitHistory(history);
			setCommitHistoryError(false);
		}).catch(() => {
			if (cancelled) return;
			setCommitHistory(null);
			setCommitHistoryError(true);
		});
		return () => { cancelled = true; };
	}, [activeWorktree?.path, refreshKey]);

	// Fetch commit detail when selected commit changes
	useEffect(() => {
		setActiveCommitDetail(null);
		if (!activeWorktree?.path || !activeSession?.selectedCommitSha) return;
		let cancelled = false;
		git.readCommitDetail(activeWorktree.path, activeSession.selectedCommitSha).then((detail) => {
			if (!cancelled) setActiveCommitDetail(detail);
		}).catch(() => {
			// detail stays null, viewer shows empty state
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
					<h1 className="shell-setup-title">oneforall</h1>
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

	if (!repository) {
		return (
			<main className="shell-app shell-app--setup">
				<section className="shell-panel shell-setup-panel">
					<h1 className="shell-setup-title">oneforall</h1>
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
			<div className="shell-layout">
				<SessionSidebar
					worktrees={worktrees}
					selectedWorktreeId={workspaceState.selectedWorktreeId}
					attentionByWorktreeId={attentionByWorktreeId}
					onSelect={(worktreeId) => { void handleSelectWorktree(worktreeId); }}
				/>

				<section className="shell-main-column">
					{activeWorktree && activeSession && (
						<ContextPanel
							worktreePath={activeWorktree.path}
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

					{activeWorktree && (
						<SessionHeader
							title={activeWorktree.label}
							branchName={activeWorktree.branchName}
							changedFileCount={changes.length}
							isDirty={activeSummary?.isDirty ?? false}
							gitSummaryError={gitSummaryError}
						/>
					)}

					{workspaceState.selectedWorktreeId && (
						<div className="shell-terminal-section">
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

							{sessions.map((session) => {
								const activeProcess = activeSession?.activeProcessSessionId
									? workspaceState.processSessionsById[
											activeSession.activeProcessSessionId
										]
									: null;
								return (
									<TerminalPane
										key={session.id}
										session={session}
										visible={
											session.worktreeId === activeWorktree?.id &&
											session.id === activeProcess?.terminalSessionId
										}
									/>
								);
							})}
						</div>
					)}

					{activeWorktree && (
						<Tabs.Root
							value={activeSession?.reviewMode ?? "files"}
							onValueChange={(value) =>
								dispatch({
									type: "session/setReviewMode",
									worktreeId: activeWorktree.id,
									reviewMode: value as "files" | "changes" | "commits",
								})
							}
							className="shell-review-tabs"
						>
							<div className="shell-review-tabs__header">
								<Tabs.List
									aria-label="Review mode"
									className="shell-review-tabs__list"
								>
									<Tabs.Trigger
										value="files"
										className="shell-review-tab"
										onClick={() =>
											dispatch({
												type: "session/setReviewMode",
												worktreeId: activeWorktree.id,
												reviewMode: "files",
											})
										}
									>
										Files
									</Tabs.Trigger>
									<Tabs.Trigger
										value="changes"
										className="shell-review-tab"
										onClick={() =>
											dispatch({
												type: "session/setReviewMode",
												worktreeId: activeWorktree.id,
												reviewMode: "changes",
											})
										}
									>
										Changes
									</Tabs.Trigger>
									<Tabs.Trigger
										value="commits"
										className="shell-review-tab"
										onClick={() =>
											dispatch({
												type: "session/setReviewMode",
												worktreeId: activeWorktree.id,
												reviewMode: "commits",
											})
										}
									>
										Commits
									</Tabs.Trigger>
								</Tabs.List>

								<div className="shell-review-switches">
									{(activeSession?.reviewMode === "changes" || activeSession?.reviewMode === "commits") && (
										<button
											type="button"
											className="shell-button"
											onClick={handleRefreshChanges}
										>
											Refresh
										</button>
									)}
								</div>
							</div>

							<div className="shell-review-grid">
								<ScrollArea.Root className="shell-panel shell-rail">
									<ScrollArea.Viewport className="shell-rail__viewport">
										{activeSession?.reviewMode === "commits" ? (
											<>
												{commitHistoryError && (
													<p className="shell-error">Could not load commit history.</p>
												)}
												<CommitList
													history={commitHistory ?? { mergeTargetRef: null, entries: [] }}
													selectedCommitSha={activeSession.selectedCommitSha}
													selectedCommitFilePath={activeSession.selectedCommitFilePath}
													activeDetail={activeCommitDetail}
													onSelectCommit={(sha) =>
														dispatch({ type: "session/selectCommit", worktreeId: activeWorktree.id, sha })
													}
													onSelectCommitFile={(relativePath) =>
														dispatch({ type: "session/selectCommitFile", worktreeId: activeWorktree.id, relativePath })
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
											/>
										) : (
											<ChangesList
												changes={changes}
												selectedPath={
													activeSession?.selectedChangedFilePath ?? null
												}
												onSelect={handleSelectChangedFile}
												gitSummaryError={gitSummaryError}
											/>
										)}
									</ScrollArea.Viewport>
									<ScrollArea.Scrollbar
										orientation="vertical"
										className="shell-scrollbar"
									/>
								</ScrollArea.Root>

								<section className="shell-panel shell-viewer-panel">
									{activeSession?.reviewMode === "commits" && activeCommitDetail ? (
										<CommitDiffStack
											key={activeCommitDetail.sha}
											detail={activeCommitDetail}
											focusedPath={activeSession.selectedCommitFilePath}
										/>
									) : activeSession?.reviewMode === "files" &&
									activeSession.selectedFilePath ? (
										<FileViewer
											worktreePath={activeWorktree.path}
											relativePath={activeSession.selectedFilePath}
										/>
									) : activeSession?.reviewMode === "changes" && activeDiff ? (
										<DiffViewer
											path={activeDiff.path}
											content={activeDiff.content}
										/>
									) : (
										<p className="shell-empty-state">
											Select a file or changed file to inspect it.
										</p>
									)}
								</section>
							</div>
						</Tabs.Root>
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
		</main>
	);
}
