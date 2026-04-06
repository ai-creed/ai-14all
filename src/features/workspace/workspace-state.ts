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
	WorktreeSession,
} from "../../../shared/models/worktree-session";

export type WorkspaceState = {
	selectedWorktreeId: string | null;
	topBandCollapsed: boolean;
	commandPresets: CommandPreset[];
	processSessionsById: Record<string, ProcessSession>;
	sessionsByWorktreeId: Record<string, WorktreeSession>;
	nextAdHocNumberByWorktreeId: Record<string, number>;
};

export type WorkspaceAction =
	| { type: "workspace/loadWorktrees"; worktrees: Worktree[] }
	| { type: "workspace/setTopBandCollapsed"; collapsed: boolean }
	| { type: "session/selectWorktree"; worktreeId: string }
	| { type: "session/setNote"; worktreeId: string; note: string }
	| {
			type: "session/setReviewMode";
			worktreeId: string;
			reviewMode: ReviewMode;
	  }
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
	  }
	| { type: "session/restoreSnapshot"; snapshot: PersistedWorktreeSession }
	| { type: "session/selectCommit"; worktreeId: string; sha: string }
	| { type: "session/selectCommitFile"; worktreeId: string; relativePath: string }
	| { type: "session/clearSelectedCommit"; worktreeId: string };

function createSession(worktree: Worktree): WorktreeSession {
	return {
		id: worktree.id,
		worktreeId: worktree.id,
		title: worktree.label,
		note: "",
		reviewMode: "files",
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
	};
}

export function createWorkspaceState(worktrees: Worktree[]): WorkspaceState {
	return {
		selectedWorktreeId: worktrees[0]?.id ?? null,
		topBandCollapsed: false,
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

function restorePersistedSession(
	state: WorkspaceState,
	snapshot: PersistedWorktreeSession,
): WorkspaceState {
	const session = state.sessionsByWorktreeId[snapshot.worktreeId];
	if (!session) return state;

	const nextProcessSessionsById = { ...state.processSessionsById };
	for (const process of snapshot.processSessions) {
		nextProcessSessionsById[process.id] = {
			id: process.id,
			worktreeId: snapshot.worktreeId,
			terminalSessionId: null,
			origin: process.origin,
			presetId: process.presetId,
			label: process.label,
			command: process.command,
			status: "restarting",
			lastActivityAt: null,
			exitCode: null,
			pinned: process.pinned,
			attentionState: "idle",
		};
	}

	const nextSession: WorktreeSession = {
		...session,
		note: snapshot.note,
		reviewMode: snapshot.reviewMode,
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
	};

	return {
		...state,
		processSessionsById: nextProcessSessionsById,
		sessionsByWorktreeId: {
			...state.sessionsByWorktreeId,
			[snapshot.worktreeId]: nextSession,
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
			topBandCollapsed: action.snapshot.topBandCollapsed ?? false,
			commandPresets: action.snapshot.commandPresets,
		};

		const selectedSession = action.snapshot.worktreeSessions.find(
			(session) => session.worktreeId === selectedWorktreeId,
		);
		if (selectedSession) {
			nextState = restorePersistedSession(nextState, selectedSession);
		}
		return nextState;
	}

	if (action.type === "session/restoreSnapshot") {
		return restorePersistedSession(state, action.snapshot);
	}

	// Full state reset — only dispatched on initial repository load, not on
	// worktree list refresh. A future "refresh worktrees" action should merge
	// new worktrees into existing state to preserve open sessions.
	if (action.type === "workspace/loadWorktrees") {
		return createWorkspaceState(action.worktrees);
	}

	if (action.type === "workspace/setTopBandCollapsed") {
		return { ...state, topBandCollapsed: action.collapsed };
	}

	if (action.type === "session/selectWorktree") {
		return { ...state, selectedWorktreeId: action.worktreeId };
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
		return {
			...state,
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
