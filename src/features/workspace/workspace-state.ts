import {
	DEFAULT_COMMAND_PRESETS,
	type CommandPreset,
} from "../../../shared/models/command-preset";
import type { GitSummary } from "../../../shared/models/git-summary";
import type {
	PersistedWorktreeSession,
	WorkspaceSnapshot,
} from "../../../shared/models/persisted-workspace-state";
import type {
	ProcessAttentionState,
	ProcessSession,
} from "../../../shared/models/process-session";
import type { Worktree } from "../../../shared/models/worktree";
import type {
	ReviewMode,
	TerminalLayoutMode,
	WorktreeSession,
} from "../../../shared/models/worktree-session";

export type WorkspaceState = {
	selectedWorktreeId: string | null;
	commandPresets: CommandPreset[];
	processSessionsById: Record<string, ProcessSession>;
	sessionsByWorktreeId: Record<string, WorktreeSession>;
	nextAdHocNumberByWorktreeId: Record<string, number>;
};

export type WorkspaceAction =
	| { type: "workspace/loadWorktrees"; worktrees: Worktree[] }
	| { type: "session/selectWorktree"; worktreeId: string }
	| { type: "session/setNote"; worktreeId: string; note: string }
	| {
			type: "session/setReviewMode";
			worktreeId: string;
			reviewMode: ReviewMode;
	  }
	| { type: "session/setReviewDrawerOpen"; worktreeId: string; open: boolean }
	| { type: "session/selectFile"; worktreeId: string; relativePath: string }
	| {
			type: "session/selectChangedFile";
			worktreeId: string;
			relativePath: string;
	  }
	| { type: "preset/upsert"; preset: CommandPreset }
	| { type: "preset/remove"; presetId: string }
	| {
			type: "session/registerProcess";
			worktreeId: string;
			process: ProcessSession;
	  }
	| {
			type: "session/selectProcess";
			worktreeId: string;
			processId: string;
	  }
	| {
			type: "session/replaceProcessTerminal";
			processId: string;
			terminalSessionId: string;
	  }
	| {
			type: "session/updateProcessStatus";
			processId: string;
			status: ProcessSession["status"];
			exitCode?: number | null;
	  }
		| {
				type: "session/recordProcessOutput";
				worktreeId: string;
				processId: string;
				attentionState: ProcessAttentionState;
				at: number;
				isViewed: boolean;
				lastOutputPreview?: string;
		  }
	| {
			type: "session/markProcessViewed";
			worktreeId: string;
			processId: string;
	  }
	| {
			type: "session/toggleProcessPinned";
			processId: string;
	  }
	| {
			type: "session/updateProcessLabel";
			processId: string;
			label: string;
	  }
	| {
			type: "session/closeProcess";
			worktreeId: string;
			processId: string;
	  }
	| { type: "session/startGitSummaryRefresh"; worktreeId: string }
	| { type: "session/cacheGitSummarySuccess"; worktreeId: string; gitSummary: GitSummary }
	| { type: "session/cacheGitSummaryFailure"; worktreeId: string; message: string }
	| {
			type: "workspace/restoreSnapshot";
			worktrees: Worktree[];
			snapshot: WorkspaceSnapshot;
			workspaceId: string;
	  }
	| { type: "session/restoreSnapshot"; workspaceId: string; snapshot: PersistedWorktreeSession }
	| { type: "session/selectCommit"; worktreeId: string; sha: string }
	| { type: "session/selectCommitFile"; worktreeId: string; relativePath: string }
	| { type: "session/clearSelectedCommit"; worktreeId: string }
	| {
			type: "session/setTerminalLayoutMode";
			worktreeId: string;
			layoutMode: TerminalLayoutMode;
			autoAssignProcessIds?: string[];
	  }
	| {
			type: "session/assignProcessToSplitSlot";
			worktreeId: string;
			processId: string;
			slot: "left" | "right";
	  }
	| {
			type: "session/removeProcessFromSplit";
			worktreeId: string;
			processId: string;
	  }
	| { type: "session/setTreeExpandedPaths"; worktreeId: string; paths: string[] }
	| { type: "session/setTitle"; worktreeId: string; title: string }
	| { type: "workspace/reconcileWorktrees"; worktrees: Worktree[] };

function createSession(worktree: Worktree): WorktreeSession {
	return {
		id: worktree.id,
		worktreeId: worktree.id,
		title: "",
		note: "",
		reviewMode: "files",
		reviewDrawerOpen: false,
		viewerMode: "file",
		gitSummary: null,
		gitSummaryStale: false,
		gitSummaryMessage: null,
		gitSummaryError: false,
		selectedFilePath: null,
		selectedChangedFilePath: null,
		selectedCommitSha: null,
		selectedCommitFilePath: null,
		activeProcessSessionId: null,
		processSessionIds: [],
		attentionState: "idle",
		terminalLayoutMode: "single",
		splitLeftProcessId: null,
		splitRightProcessId: null,
		treeExpandedPaths: [],
	};
}

export function createWorkspaceState(worktrees: Worktree[]): WorkspaceState {
	return {
		selectedWorktreeId: worktrees[0]?.id ?? null,
		commandPresets: DEFAULT_COMMAND_PRESETS.map((preset) => ({ ...preset })),
		processSessionsById: {},
		sessionsByWorktreeId: Object.fromEntries(
			worktrees.map((worktree) => [worktree.id, createSession(worktree)]),
		),
		nextAdHocNumberByWorktreeId: Object.fromEntries(
			worktrees.map((worktree) => [worktree.id, 1]),
		),
	};
}

const attentionRank: Record<ProcessAttentionState, number> = {
	idle: 0,
	activity: 1,
	actionRequired: 2,
};

function recalculateWorktreeAttention(
	worktreeSession: WorktreeSession,
	processSessionsById: Record<string, ProcessSession>,
): ProcessAttentionState {
	const states = worktreeSession.processSessionIds.map(
		(id) => processSessionsById[id]?.attentionState ?? "idle",
	);
	if (states.includes("actionRequired")) return "actionRequired";
	if (states.includes("activity")) return "activity";
	return "idle";
}

function sanitizeSplitAssignments(
	session: Pick<
		WorktreeSession,
		"splitLeftProcessId" | "splitRightProcessId" | "processSessionIds"
	>,
): Pick<WorktreeSession, "splitLeftProcessId" | "splitRightProcessId"> {
	const allowed = new Set(session.processSessionIds);
	const left =
		session.splitLeftProcessId && allowed.has(session.splitLeftProcessId)
			? session.splitLeftProcessId
			: null;
	const rightCandidate =
		session.splitRightProcessId && allowed.has(session.splitRightProcessId)
			? session.splitRightProcessId
			: null;
	const right = rightCandidate === left ? null : rightCandidate;
	return { splitLeftProcessId: left, splitRightProcessId: right };
}

function restorePersistedSession(
	state: WorkspaceState,
	snapshot: PersistedWorktreeSession,
	workspaceId: string,
): WorkspaceState {
	const session = state.sessionsByWorktreeId[snapshot.worktreeId];
	if (!session) return state;

	const nextProcessSessionsById = { ...state.processSessionsById };
	for (const process of snapshot.processSessions) {
			nextProcessSessionsById[process.id] = {
				id: process.id,
				workspaceId,
				worktreeId: snapshot.worktreeId,
				terminalSessionId: null,
			origin: process.origin,
			presetId: process.presetId,
			label: process.label,
				command: process.command,
				status: "restarting",
				lastActivityAt: null,
				lastOutputPreview: null,
				exitCode: null,
				pinned: process.pinned,
				attentionState: "idle",
			};
	}

	const nextSession: WorktreeSession = {
		...session,
		title: snapshot.title ?? "",
		note: snapshot.note,
		reviewMode: snapshot.reviewMode,
		reviewDrawerOpen: snapshot.reviewDrawerOpen,
		viewerMode: snapshot.viewerMode,
		selectedFilePath: snapshot.selectedFilePath,
		selectedChangedFilePath: snapshot.selectedChangedFilePath,
		selectedCommitSha: snapshot.selectedCommitSha,
		selectedCommitFilePath: snapshot.selectedCommitFilePath,
		processSessionIds: snapshot.processSessions.map((process) => process.id),
		activeProcessSessionId:
			snapshot.activeProcessSessionId !== null &&
			snapshot.processSessions.some((p) => p.id === snapshot.activeProcessSessionId)
				? snapshot.activeProcessSessionId
				: (snapshot.processSessions[0]?.id ?? null),
		attentionState: "idle",
		terminalLayoutMode: snapshot.terminalLayoutMode,
		splitLeftProcessId: snapshot.splitLeftProcessId,
		splitRightProcessId: snapshot.splitRightProcessId,
	};
	const sanitizedSplit = sanitizeSplitAssignments(nextSession);

	return {
		...state,
		processSessionsById: nextProcessSessionsById,
		sessionsByWorktreeId: {
			...state.sessionsByWorktreeId,
			[snapshot.worktreeId]: {
				...nextSession,
				...sanitizedSplit,
			},
		},
		nextAdHocNumberByWorktreeId: {
			...state.nextAdHocNumberByWorktreeId,
			[snapshot.worktreeId]: snapshot.nextAdHocNumber,
		},
	};
}

function updateSession(
	state: WorkspaceState,
	worktreeId: string,
	updater: (session: WorktreeSession) => WorktreeSession,
): WorkspaceState {
	const session = state.sessionsByWorktreeId[worktreeId];
	if (!session) return state;
	return {
		...state,
		sessionsByWorktreeId: {
			...state.sessionsByWorktreeId,
			[worktreeId]: updater(session),
		},
	};
}

export function workspaceReducer(
	state: WorkspaceState,
	action: WorkspaceAction,
): WorkspaceState {
	if (action.type === "workspace/restoreSnapshot") {
		const base = createWorkspaceState(action.worktrees);
		const selectedWorktreeId =
			action.snapshot.selectedWorktreeId &&
			base.sessionsByWorktreeId[action.snapshot.selectedWorktreeId]
				? action.snapshot.selectedWorktreeId
				: base.selectedWorktreeId;

		let nextState: WorkspaceState = {
			...base,
			selectedWorktreeId,
			commandPresets: action.snapshot.commandPresets,
		};

		const selectedSession = action.snapshot.worktreeSessions.find(
			(session) => session.worktreeId === selectedWorktreeId,
		);
		if (selectedSession) {
			nextState = restorePersistedSession(nextState, selectedSession, action.workspaceId);
		}
		return nextState;
	}

	if (action.type === "session/restoreSnapshot") {
		return restorePersistedSession(state, action.snapshot, action.workspaceId);
	}

	// Full state reset — only dispatched on initial repository load, not on
	// worktree list refresh. Use workspace/reconcileWorktrees to merge new
	// worktrees into existing state and preserve open sessions.
	if (action.type === "workspace/loadWorktrees") {
		return createWorkspaceState(action.worktrees);
	}

	if (action.type === "workspace/reconcileWorktrees") {
		const nextWorktreeIds = new Set(action.worktrees.map((worktree) => worktree.id));
		const nextSessionsByWorktreeId = Object.fromEntries(
			action.worktrees.map((worktree) => {
				const existing = state.sessionsByWorktreeId[worktree.id] ?? createSession(worktree);
				return [
					worktree.id,
					{
						...existing,
						...sanitizeSplitAssignments(existing),
					},
				];
			}),
		);
		const nextProcessSessionsById = Object.fromEntries(
			Object.entries(state.processSessionsById).filter(([, process]) =>
				nextWorktreeIds.has(process.worktreeId),
			),
		);
		const nextNumbers = Object.fromEntries(
			action.worktrees.map((worktree) => [
				worktree.id,
				state.nextAdHocNumberByWorktreeId[worktree.id] ?? 1,
			]),
		);
		const preferredSelection =
			state.selectedWorktreeId && nextWorktreeIds.has(state.selectedWorktreeId)
				? state.selectedWorktreeId
				: (action.worktrees.find((worktree) => worktree.isMain)?.id ??
					action.worktrees[0]?.id ??
					null);

		return {
			...state,
			selectedWorktreeId: preferredSelection,
			processSessionsById: nextProcessSessionsById,
			sessionsByWorktreeId: nextSessionsByWorktreeId,
			nextAdHocNumberByWorktreeId: nextNumbers,
		};
	}

	if (action.type === "session/selectWorktree") {
		return { ...state, selectedWorktreeId: action.worktreeId };
	}

	if (action.type === "session/setTerminalLayoutMode") {
		return updateSession(state, action.worktreeId, (session) => {
			const shouldAutoAssign =
				action.layoutMode === "split" &&
				!session.splitLeftProcessId &&
				!session.splitRightProcessId &&
				action.autoAssignProcessIds?.length === 2;
			const nextSession: WorktreeSession = {
				...session,
				terminalLayoutMode: action.layoutMode,
				splitLeftProcessId: shouldAutoAssign
					? (action.autoAssignProcessIds?.[0] ?? null)
					: session.splitLeftProcessId,
				splitRightProcessId: shouldAutoAssign
					? (action.autoAssignProcessIds?.[1] ?? null)
					: session.splitRightProcessId,
			};
			return {
				...nextSession,
				...sanitizeSplitAssignments(nextSession),
			};
		});
	}

	if (action.type === "session/assignProcessToSplitSlot") {
		const session = state.sessionsByWorktreeId[action.worktreeId];
		if (!session || !session.processSessionIds.includes(action.processId)) return state;
		const nextSession: WorktreeSession = {
			...session,
			terminalLayoutMode: "split",
			splitLeftProcessId:
				action.slot === "left"
					? action.processId
					: session.splitLeftProcessId === action.processId
						? null
						: session.splitLeftProcessId,
			splitRightProcessId:
				action.slot === "right"
					? action.processId
					: session.splitRightProcessId === action.processId
						? null
						: session.splitRightProcessId,
		};
		return {
			...state,
			sessionsByWorktreeId: {
				...state.sessionsByWorktreeId,
				[action.worktreeId]: {
					...nextSession,
					...sanitizeSplitAssignments(nextSession),
				},
			},
		};
	}

	if (action.type === "session/removeProcessFromSplit") {
		return updateSession(state, action.worktreeId, (session) => ({
			...session,
			splitLeftProcessId:
				session.splitLeftProcessId === action.processId
					? null
					: session.splitLeftProcessId,
			splitRightProcessId:
				session.splitRightProcessId === action.processId
					? null
					: session.splitRightProcessId,
		}));
	}

	if (action.type === "session/setTreeExpandedPaths") {
		const session = state.sessionsByWorktreeId[action.worktreeId];
		if (!session) return state;
		return {
			...state,
			sessionsByWorktreeId: {
				...state.sessionsByWorktreeId,
				[action.worktreeId]: { ...session, treeExpandedPaths: action.paths },
			},
		};
	}

	if (action.type === "session/setTitle") {
		return updateSession(state, action.worktreeId, (session) => ({
			...session,
			title: action.title.trim(),
		}));
	}

	// --- Preset actions (repo-level, not worktree-scoped) ---

	if (action.type === "preset/upsert") {
		const existing = state.commandPresets.findIndex(
			(p) => p.id === action.preset.id,
		);
		const nextPresets =
			existing >= 0
				? state.commandPresets.map((p) =>
						p.id === action.preset.id ? action.preset : p,
					)
				: [...state.commandPresets, action.preset];
		return { ...state, commandPresets: nextPresets };
	}

	if (action.type === "preset/remove") {
		return {
			...state,
			commandPresets: state.commandPresets.filter(
				(p) => p.id !== action.presetId,
			),
		};
	}

	// --- Process-level actions without worktreeId ---

	if (action.type === "session/replaceProcessTerminal") {
		const process = state.processSessionsById[action.processId];
		if (!process) return state;
		return {
			...state,
			processSessionsById: {
				...state.processSessionsById,
				[action.processId]: {
					...process,
					terminalSessionId: action.terminalSessionId,
				},
			},
		};
	}

	if (action.type === "session/updateProcessStatus") {
		const process = state.processSessionsById[action.processId];
		if (!process) return state;
		return {
			...state,
			processSessionsById: {
				...state.processSessionsById,
				[action.processId]: {
					...process,
					status: action.status,
					exitCode: action.exitCode ?? process.exitCode,
				},
			},
		};
	}

	if (action.type === "session/toggleProcessPinned") {
		const process = state.processSessionsById[action.processId];
		if (!process) return state;
		return {
			...state,
			processSessionsById: {
				...state.processSessionsById,
				[action.processId]: {
					...process,
					pinned: !process.pinned,
				},
			},
		};
	}

	if (action.type === "session/updateProcessLabel") {
		const process = state.processSessionsById[action.processId];
		if (!process || process.label === action.label) return state;
		return {
			...state,
			processSessionsById: {
				...state.processSessionsById,
				[action.processId]: {
					...process,
					label: action.label,
				},
			},
		};
	}

	// --- Worktree-scoped actions ---

	if (action.type === "session/registerProcess") {
		const session = state.sessionsByWorktreeId[action.worktreeId];
		if (!session) return state;
		const nextSession: WorktreeSession = {
			...session,
			processSessionIds: [...session.processSessionIds, action.process.id],
			activeProcessSessionId: action.process.id,
		};
		const nextProcessSessionsById = {
			...state.processSessionsById,
			[action.process.id]: action.process,
		};
		const nextAdHocNumber =
			action.process.origin === "adHoc"
				? (state.nextAdHocNumberByWorktreeId[action.worktreeId] ?? 1) + 1
				: (state.nextAdHocNumberByWorktreeId[action.worktreeId] ?? 1);
		return {
			...state,
			nextAdHocNumberByWorktreeId: {
				...state.nextAdHocNumberByWorktreeId,
				[action.worktreeId]: nextAdHocNumber,
			},
			processSessionsById: nextProcessSessionsById,
			sessionsByWorktreeId: {
				...state.sessionsByWorktreeId,
				[action.worktreeId]: {
					...nextSession,
					attentionState: recalculateWorktreeAttention(
						nextSession,
						nextProcessSessionsById,
					),
				},
			},
		};
	}

	if (action.type === "session/selectProcess") {
		const session = state.sessionsByWorktreeId[action.worktreeId];
		if (!session) return state;
		return {
			...state,
			sessionsByWorktreeId: {
				...state.sessionsByWorktreeId,
				[action.worktreeId]: {
					...session,
					activeProcessSessionId: action.processId,
				},
			},
		};
	}

	if (action.type === "session/recordProcessOutput") {
		const process = state.processSessionsById[action.processId];
		const session = state.sessionsByWorktreeId[action.worktreeId];
		if (!process || !session) return state;
		const nextAttention = action.isViewed
			? process.attentionState
			: attentionRank[action.attentionState] >=
				  attentionRank[process.attentionState]
				? action.attentionState
				: process.attentionState;
		const nextProcessSessionsById = {
			...state.processSessionsById,
				[action.processId]: {
					...process,
					attentionState: nextAttention,
					lastActivityAt: action.at,
					...(action.lastOutputPreview !== undefined
						? { lastOutputPreview: action.lastOutputPreview }
						: {}),
				},
			};
		const nextSession: WorktreeSession = {
			...session,
			attentionState: recalculateWorktreeAttention(
				session,
				nextProcessSessionsById,
			),
		};
		return {
			...state,
			processSessionsById: nextProcessSessionsById,
			sessionsByWorktreeId: {
				...state.sessionsByWorktreeId,
				[action.worktreeId]: nextSession,
			},
		};
	}

	if (action.type === "session/markProcessViewed") {
		const process = state.processSessionsById[action.processId];
		const session = state.sessionsByWorktreeId[action.worktreeId];
		if (!process || !session) return state;
		const nextProcessSessionsById = {
			...state.processSessionsById,
			[action.processId]: {
				...process,
				attentionState: "idle" as const,
			},
		};
		const nextSession: WorktreeSession = {
			...session,
			attentionState: recalculateWorktreeAttention(
				session,
				nextProcessSessionsById,
			),
		};
		return {
			...state,
			processSessionsById: nextProcessSessionsById,
			sessionsByWorktreeId: {
				...state.sessionsByWorktreeId,
				[action.worktreeId]: nextSession,
			},
		};
	}

	if (action.type === "session/closeProcess") {
		const session = state.sessionsByWorktreeId[action.worktreeId];
		if (!session) return state;
		const nextProcessIds = session.processSessionIds.filter(
			(id) => id !== action.processId,
		);
		const nextActiveProcessId =
			session.activeProcessSessionId === action.processId
				? (nextProcessIds[0] ?? null)
				: session.activeProcessSessionId;
		const nextProcessSessionsById = Object.fromEntries(
			Object.entries(state.processSessionsById).filter(
				([id]) => id !== action.processId,
			),
		);
		const nextSession: WorktreeSession = {
			...session,
			processSessionIds: nextProcessIds,
			activeProcessSessionId: nextActiveProcessId,
		};
		const sanitizedSplit = sanitizeSplitAssignments(nextSession);
		return {
			...state,
			processSessionsById: nextProcessSessionsById,
			sessionsByWorktreeId: {
				...state.sessionsByWorktreeId,
				[action.worktreeId]: {
					...nextSession,
					...sanitizedSplit,
					attentionState: recalculateWorktreeAttention(
						{ ...nextSession, ...sanitizedSplit },
						nextProcessSessionsById,
					),
				},
			},
		};
	}

	if (action.type === "session/startGitSummaryRefresh") {
		return updateSession(state, action.worktreeId, (session) => ({
			...session,
			gitSummaryMessage: session.gitSummaryStale ? session.gitSummaryMessage : null,
		}));
	}

	if (action.type === "session/cacheGitSummarySuccess") {
		return updateSession(state, action.worktreeId, (session) => ({
			...session,
			gitSummary: action.gitSummary,
			gitSummaryError: false,
			gitSummaryStale: false,
			gitSummaryMessage: null,
			selectedChangedFilePath:
				session.selectedChangedFilePath &&
				!action.gitSummary.changedFiles.some(
					(change) => change.path === session.selectedChangedFilePath,
				)
					? null
					: session.selectedChangedFilePath,
		}));
	}

	if (action.type === "session/cacheGitSummaryFailure") {
		return updateSession(state, action.worktreeId, (session) => ({
			...session,
			gitSummaryError: session.gitSummary === null,
			gitSummaryStale: session.gitSummary !== null,
			gitSummaryMessage:
				session.gitSummary === null
					? "Couldn't load changes."
					: "Couldn't refresh changes. Showing last successful result.",
		}));
	}

	// --- Remaining session-level actions ---

	const session = state.sessionsByWorktreeId[action.worktreeId];
	if (!session) return state;

	let nextSession: WorktreeSession;

	if (action.type === "session/setNote") {
		nextSession = { ...session, note: action.note };
	} else if (action.type === "session/setReviewMode") {
		nextSession = { ...session, reviewMode: action.reviewMode };
	} else if (action.type === "session/setReviewDrawerOpen") {
		nextSession = { ...session, reviewDrawerOpen: action.open };
	} else if (action.type === "session/selectFile") {
		nextSession = {
			...session,
			reviewMode: "files",
			viewerMode: "file",
			selectedFilePath: action.relativePath,
		};
	} else if (action.type === "session/selectChangedFile") {
		nextSession = {
			...session,
			reviewMode: "changes",
			viewerMode: "diff",
			selectedChangedFilePath: action.relativePath,
		};
	} else if (action.type === "session/selectCommit") {
		nextSession = {
			...session,
			reviewMode: "commits",
			viewerMode: "commit",
			selectedCommitSha: action.sha,
			selectedCommitFilePath: null,
		};
	} else if (action.type === "session/selectCommitFile") {
		nextSession = {
			...session,
			reviewMode: "commits",
			viewerMode: "commit",
			selectedCommitFilePath: action.relativePath,
		};
	} else if (action.type === "session/clearSelectedCommit") {
		nextSession = {
			...session,
			selectedCommitSha: null,
			selectedCommitFilePath: null,
		};
	} else {
		return state;
	}

	return {
		...state,
		sessionsByWorktreeId: {
			...state.sessionsByWorktreeId,
			[action.worktreeId]: nextSession,
		},
	};
}
