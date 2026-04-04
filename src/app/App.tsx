import { useEffect, useMemo, useReducer, useState } from "react";
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
} from "../../shared/models/persisted-workspace-state";
import { DEFAULT_PERSISTED_WORKSPACE_STATE } from "../../shared/models/persisted-workspace-state";
import { buildWorkspaceSnapshot } from "../features/workspace/workspace-persistence";
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
import { git, workspace } from "../lib/desktop-client";

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
	const [error, setError] = useState<string | null>(null);
	const [presetManagerOpen, setPresetManagerOpen] = useState(false);
	const [startupMode, setStartupMode] = useState<StartupMode>("loading");
	const [restoreState, setRestoreState] = useState<PersistedWorkspaceState>(
		DEFAULT_PERSISTED_WORKSPACE_STATE,
	);
	const [startupError, setStartupError] = useState<string | null>(null);
	// populated in restoreWorkspace (Task 4) for lazy hydration of non-selected sessions
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
				// restoreWorkspace will be added in Task 4 — for now just go ready
				setStartupMode("ready");
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

	// Derive git data from cached session state
	const activeSummary = activeSession?.gitSummary ?? null;
	const gitSummaryError = activeSession?.gitSummaryError ?? false;
	const changes = activeSummary?.changedFiles ?? [];
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
		() =>
			repository
				? buildWorkspaceSnapshot(repository.rootPath, workspaceState)
				: null,
		// eslint-disable-next-line react-hooks/exhaustive-deps -- repository.rootPath drives the snapshot; the object reference changes are irrelevant
		[repository?.rootPath, workspaceState],
	);
	const persistableState = useMemo(
		() => ({
			version: 1 as const,
			restorePreference: restoreState.restorePreference,
			snapshot: persistableSnapshot,
		}),
		[persistableSnapshot, restoreState.restorePreference],
	);
	const persistableStateJson = useMemo(
		() => JSON.stringify(persistableState),
		[persistableState],
	);

	// eslint-disable-next-line react-hooks/exhaustive-deps -- persistableStateJson is used for change detection; persistableState (same data) is used for the write
	useEffect(() => {
		if (startupMode !== "ready") return;
		void workspace.writeRestoreState(persistableState);
	}, [startupMode, persistableStateJson]);

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
			const nextState: PersistedWorkspaceState = {
				version: 1,
				restorePreference: nextPreference,
				snapshot: null,
			};
			setRestoreState(nextState);
			await workspace.writeRestoreState(nextState);
			setStartupMode("ready");
			return;
		}

		// restore path will be wired in Task 4 — for now just go ready
		setRestoreState((prev) => ({ ...prev, restorePreference: nextPreference }));
		setStartupMode("ready");
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
			<div className="shell-layout">
				<SessionSidebar
					worktrees={worktrees}
					selectedWorktreeId={workspaceState.selectedWorktreeId}
					attentionByWorktreeId={attentionByWorktreeId}
					onSelect={(worktreeId) => {
						dispatch({ type: "session/selectWorktree", worktreeId });
						const session = workspaceState.sessionsByWorktreeId[worktreeId];
						if (session?.activeProcessSessionId) {
							dispatch({
								type: "session/markProcessViewed",
								worktreeId,
								processId: session.activeProcessSessionId,
							});
						}
					}}
				/>

				<section className="shell-main-column">
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
									reviewMode: value as "files" | "changes",
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
								</Tabs.List>

								<div className="shell-review-switches">
									{activeSession?.reviewMode === "changes" && (
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
										{activeSession?.reviewMode === "files" ? (
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
									{activeSession?.reviewMode === "files" &&
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

				{activeWorktree && activeSession && (
					<ContextPanel
						branchName={activeWorktree.branchName}
						worktreePath={activeWorktree.path}
						note={activeSession.note}
						gitSummary={activeSummary}
						gitSummaryError={gitSummaryError}
						onNoteChange={(note) =>
							dispatch({
								type: "session/setNote",
								worktreeId: activeWorktree.id,
								note,
							})
						}
					/>
				)}
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
