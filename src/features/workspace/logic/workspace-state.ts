import {
	DEFAULT_COMMAND_PRESETS,
	type CommandPreset,
} from "../../../../shared/models/command-preset";
import {
	isAgentProcess,
	rankAgentAttention,
	mapToProcessAttentionState,
	shouldReplaceAgentAttentionReason,
} from "../../terminals/logic/agent-attention";
import { detectAgentProvider } from "./agent-provider-detection";
import type {
	AgentAttentionReason,
	AgentAttentionReasonsBySource,
	AgentAttentionSource,
} from "../../../../shared/models/agent-attention";
import type { GitSummary } from "../../../../shared/models/git-summary";
import type {
	PersistedWorktreeSession,
	WorkspaceSnapshot,
} from "../../../../shared/models/persisted-workspace-state";
import type {
	ProcessAttentionState,
	ProcessSession,
} from "../../../../shared/models/process-session";
import type { Worktree } from "../../../../shared/models/worktree";
import type {
	FilesPaneMode,
	ReviewMode,
	WorktreeSession,
} from "../../../../shared/models/worktree-session";

import type { WorkspaceState } from "../../../../shared/models/workspace-state";
export type { WorkspaceState };
import type { LayoutId } from "../../../../shared/models/terminal-layout";
import { TERMINAL_LAYOUTS } from "../../terminals/logic/terminal-layouts";
import {
	compactIntoLayout,
	runningCount,
	planAddPlacement,
} from "../../terminals/logic/terminal-layout-planner";

/** Nearest non-null slot to `fromIndex`, preferring the next slot then previous. */
function nearestOccupiedSlot(
	slots: (string | null)[],
	fromIndex: number,
): string | null {
	for (let d = 1; d < slots.length; d++) {
		const next = slots[fromIndex + d];
		if (next) return next;
		const prev = slots[fromIndex - d];
		if (prev) return prev;
	}
	return slots.find((s): s is string => s !== null) ?? null;
}

export type WorkspaceAction =
	| { type: "workspace/loadWorktrees"; worktrees: Worktree[] }
	| { type: "session/selectWorktree"; worktreeId: string }
	| { type: "session/setNote"; worktreeId: string; note: string }
	| {
			type: "session/setReviewMode";
			worktreeId: string;
			reviewMode: ReviewMode;
	  }
	| {
			type: "session/setFilesPaneMode";
			worktreeId: string;
			filesPaneMode: FilesPaneMode;
	  }
	| {
			type: "session/setReviewSidebarWidth";
			worktreeId: string;
			width: number;
	  }
	| { type: "session/selectFile"; worktreeId: string; relativePath: string }
	| {
			type: "session/selectFileAtLocation";
			worktreeId: string;
			relativePath: string;
			revealLine: number;
			revealColumn?: number;
			transient: boolean;
	  }
	| { type: "session/consumePendingReveal"; worktreeId: string }
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
			agentReason?: AgentAttentionReason | null;
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
	| {
			type: "session/cacheGitSummarySuccess";
			worktreeId: string;
			gitSummary: GitSummary;
	  }
	| {
			type: "session/cacheGitSummaryFailure";
			worktreeId: string;
			message: string;
	  }
	| {
			type: "workspace/restoreSnapshot";
			worktrees: Worktree[];
			snapshot: WorkspaceSnapshot;
			workspaceId: string;
	  }
	| {
			type: "session/restoreSnapshot";
			workspaceId: string;
			snapshot: PersistedWorktreeSession;
	  }
	| { type: "session/selectCommit"; worktreeId: string; sha: string }
	| {
			type: "session/selectCommitFile";
			worktreeId: string;
			relativePath: string;
	  }
	| { type: "session/clearSelectedCommit"; worktreeId: string }
	| {
			type: "session/setTerminalLayout";
			worktreeId: string;
			layoutId: LayoutId;
	  }
	| {
			type: "session/setSlotProcess";
			worktreeId: string;
			slotIndex: number;
			processId: string | null;
	  }
	| {
			type: "session/placeProcessInNewSlot";
			worktreeId: string;
			process: ProcessSession;
			layoutId: LayoutId;
			slotIndex: number;
	  }
	| {
			type: "session/swapTerminalSlots";
			worktreeId: string;
			i: number;
			j: number;
	  }
	| {
			type: "session/setTreeExpandedPaths";
			worktreeId: string;
			paths: string[];
	  }
	| {
			type: "session/setTreeShowIgnored";
			worktreeId: string;
			showIgnored: boolean;
	  }
	| { type: "session/setTitle"; worktreeId: string; title: string }
	| { type: "workspace/reconcileWorktrees"; worktrees: Worktree[] }
	| {
			type: "session/reportProcessAgentAttention";
			worktreeId: string;
			processId: string;
			reason: AgentAttentionReason;
	  }
	| {
			type: "session/reportAgentAttention";
			worktreeId: string;
			reason: AgentAttentionReason;
			task?: string | null;
	  }
	| {
			type: "session/clearProcessAgentAttention";
			worktreeId: string;
			processId: string;
			sticky?: boolean;
			clearedAt: number;
	  }
	| {
			type: "session/clearSessionAgentAttention";
			worktreeId: string;
			source?: AgentAttentionSource;
	  };

function createSession(worktree: Worktree): WorktreeSession {
	return {
		id: worktree.id,
		worktreeId: worktree.id,
		title: "",
		note: "",
		reviewMode: "files",
		filesPaneMode: "files",
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
		agentAttentionReasons: {},
		terminalLayoutId: "1",
		slotProcessIds: [null],
		reviewSidebarWidth: 280,
		treeExpandedPaths: [],
		treeShowIgnored: false,
		task: null,
		pendingReveal: null,
		paneTransient: false,
		navLocation: null,
		floatingShellIds: [],
		expandedFloatingShellId: null,
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

// When the agent reports a non-failed state via MCP, its own self-report is
// authoritative and supersedes ANY lingering terminal-classifier reason on the
// session's processes — a stale `failed` (benign "error"/"failed" regex match),
// a stale `waiting` (an answered prompt that never decayed), or a perpetual
// `active` (TUI footer repaint). All are heuristic noise once the agent has
// explicitly stated its state. Drop the terminal reason and recompute the
// affected processes' attention. `lifecycle` failed (the process actually
// exited non-zero) is authoritative and left untouched.
function clearStaleTerminalReasonsForSessionProcesses(
	processSessionsById: Record<string, ProcessSession>,
	processSessionIds: string[],
): Record<string, ProcessSession> {
	let mutated = false;
	const next: Record<string, ProcessSession> = { ...processSessionsById };
	for (const id of processSessionIds) {
		const process = next[id];
		if (!process) continue;
		if (!process.agentAttentionReasons.terminal) continue;
		const { terminal: _removed, ...remainingReasons } =
			process.agentAttentionReasons;
		const nextAgent = rankAgentAttention(remainingReasons, false);
		const nextAttentionState = mapToProcessAttentionState(nextAgent);
		next[id] = {
			...process,
			agentAttentionReasons: remainingReasons,
			// Deliberate downgrade: clearing a stale `failed` must be allowed to
			// lower the state, unlike the monotonic-raise path in
			// session/reportProcessAgentAttention. Do not re-add a clamp here.
			attentionState: nextAttentionState,
		};
		mutated = true;
	}
	return mutated ? next : processSessionsById;
}

function restorePersistedSession(
	state: WorkspaceState,
	snapshot: PersistedWorktreeSession,
	workspaceId: string,
): WorkspaceState {
	const session = state.sessionsByWorktreeId[snapshot.worktreeId];
	if (!session) return state;

	// Determine layout + slots. A snapshot written before this feature has
	// terminalLayoutId/slotProcessIds === undefined → migrate (reset to single +
	// one kept shell). A newer snapshot restores its layout, sanitized.
	const restoredIds = snapshot.processSessions.map((p) => p.id);
	const isOldSnapshot =
		snapshot.slotProcessIds === undefined ||
		snapshot.terminalLayoutId === undefined;

	let restoredLayoutId: LayoutId;
	let restoredSlots: (string | null)[];
	if (isOldSnapshot) {
		restoredLayoutId = "1";
		if (restoredIds.length === 0) {
			restoredSlots = [null];
		} else {
			const keep =
				snapshot.activeProcessSessionId &&
				restoredIds.includes(snapshot.activeProcessSessionId)
					? snapshot.activeProcessSessionId
					: restoredIds[0];
			restoredSlots = [keep];
		}
	} else {
		restoredLayoutId = snapshot.terminalLayoutId as LayoutId;
		const sanitized = (snapshot.slotProcessIds ?? []).map((id) =>
			id && restoredIds.includes(id) ? id : null,
		);
		// Preserve slot positions (a persisted middle-null is a real post-close
		// state); only pad/truncate to the layout's slot count. Do NOT compact.
		const n = TERMINAL_LAYOUTS[restoredLayoutId].slotCount;
		restoredSlots = Array.from({ length: n }, (_, i) => sanitized[i] ?? null);
	}
	const keptIds = new Set(restoredSlots.filter((s): s is string => s !== null));

	const nextProcessSessionsById = { ...state.processSessionsById };
	for (const process of snapshot.processSessions) {
		if (!keptIds.has(process.id)) continue;
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
			agentAttentionReasons: {},
			agentAttentionClearedAt: null,
			// Restored as "restarting" — keep agentDetected false so it re-detects
			// from the fresh shell's output once the new terminal session starts.
			agentDetected: false,
			provider: null,
		};
	}

	const nextSession: WorktreeSession = {
		...session,
		title: snapshot.title ?? "",
		note: snapshot.note,
		reviewMode: snapshot.reviewMode,
		filesPaneMode: snapshot.filesPaneMode ?? "files",
		viewerMode: snapshot.viewerMode,
		selectedFilePath: snapshot.selectedFilePath,
		selectedChangedFilePath: snapshot.selectedChangedFilePath,
		selectedCommitSha: snapshot.selectedCommitSha,
		selectedCommitFilePath: snapshot.selectedCommitFilePath,
		processSessionIds: [...keptIds],
		activeProcessSessionId:
			snapshot.activeProcessSessionId &&
			keptIds.has(snapshot.activeProcessSessionId)
				? snapshot.activeProcessSessionId
				: (restoredSlots.find((s): s is string => s !== null) ?? null),
		attentionState: "idle",
		agentAttentionReasons: {},
		terminalLayoutId: restoredLayoutId,
		slotProcessIds: restoredSlots,
		reviewSidebarWidth: snapshot.reviewSidebarWidth ?? 280,
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
			commandPresets: action.snapshot.commandPresets,
		};

		const selectedSession = action.snapshot.worktreeSessions.find(
			(session) => session.worktreeId === selectedWorktreeId,
		);
		if (selectedSession) {
			nextState = restorePersistedSession(
				nextState,
				selectedSession,
				action.workspaceId,
			);
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
		const nextWorktreeIds = new Set(
			action.worktrees.map((worktree) => worktree.id),
		);
		const nextSessionsByWorktreeId = Object.fromEntries(
			action.worktrees.map((worktree) => {
				const existing =
					state.sessionsByWorktreeId[worktree.id] ?? createSession(worktree);
				return [worktree.id, existing];
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

	if (action.type === "session/setTerminalLayout") {
		return updateSession(state, action.worktreeId, (session) => {
			const target = TERMINAL_LAYOUTS[action.layoutId];
			if (target.slotCount < runningCount(session.slotProcessIds))
				return session; // reject too-small
			const slotProcessIds = compactIntoLayout(
				session.slotProcessIds,
				action.layoutId,
			);
			const active =
				session.activeProcessSessionId &&
				slotProcessIds.includes(session.activeProcessSessionId)
					? session.activeProcessSessionId
					: (slotProcessIds.find((s): s is string => s !== null) ?? null);
			return {
				...session,
				terminalLayoutId: action.layoutId,
				slotProcessIds,
				activeProcessSessionId: active,
			};
		});
	}

	if (action.type === "session/setSlotProcess") {
		return updateSession(state, action.worktreeId, (session) => {
			if (
				action.slotIndex < 0 ||
				action.slotIndex >= session.slotProcessIds.length
			)
				return session;
			const slotProcessIds = session.slotProcessIds.slice();
			slotProcessIds[action.slotIndex] = action.processId;
			return {
				...session,
				slotProcessIds,
				processSessionIds: slotProcessIds.filter(
					(s): s is string => s !== null,
				),
				activeProcessSessionId:
					action.processId ?? session.activeProcessSessionId,
			};
		});
	}

	if (action.type === "session/placeProcessInNewSlot") {
		const session = state.sessionsByWorktreeId[action.worktreeId];
		if (!session) return state;
		// Placing into an empty slot of the CURRENT layout (the "+ start a shell"
		// CTA filling a gap left by a closed shell): write in place. Do NOT compact
		// — compaction packs survivors forward and would shift a later shell into
		// action.slotIndex, overwriting and orphaning its running process. Only a
		// genuine layout change (growing into a larger layout) needs the reflow.
		const compacted =
			action.layoutId === session.terminalLayoutId
				? session.slotProcessIds.slice()
				: compactIntoLayout(session.slotProcessIds, action.layoutId);
		compacted[action.slotIndex] = action.process.id;
		const nextSession: WorktreeSession = {
			...session,
			terminalLayoutId: action.layoutId,
			slotProcessIds: compacted,
			processSessionIds: compacted.filter((s): s is string => s !== null),
			activeProcessSessionId: action.process.id,
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
			processSessionsById: {
				...state.processSessionsById,
				[action.process.id]: action.process,
			},
			sessionsByWorktreeId: {
				...state.sessionsByWorktreeId,
				[action.worktreeId]: nextSession,
			},
		};
	}

	if (action.type === "session/swapTerminalSlots") {
		return updateSession(state, action.worktreeId, (session) => {
			const slots = session.slotProcessIds.slice();
			const tmp = slots[action.i];
			slots[action.i] = slots[action.j];
			slots[action.j] = tmp;
			// Keep the invariant: processSessionIds === non-null slots, in slot order.
			return {
				...session,
				slotProcessIds: slots,
				processSessionIds: slots.filter((s): s is string => s !== null),
			};
		});
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

	if (action.type === "session/setTreeShowIgnored") {
		const session = state.sessionsByWorktreeId[action.worktreeId];
		if (!session) return state;
		return {
			...state,
			sessionsByWorktreeId: {
				...state.sessionsByWorktreeId,
				[action.worktreeId]: {
					...session,
					treeShowIgnored: action.showIgnored,
				},
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
		// Reset agent detection when leaving "running" — the next shell incarnation
		// will re-detect from its own command/OSC title. Re-set on transition back
		// to "running" if the (still-known) command still matches an agent CLI.
		const nextAgentDetected =
			action.status === "running"
				? isAgentProcess(process.label, process.command)
				: false;
		const nextProvider =
			action.status === "running"
				? detectAgentProvider(process.command, undefined, null)
				: null;
		return {
			...state,
			processSessionsById: {
				...state.processSessionsById,
				[action.processId]: {
					...process,
					status: action.status,
					exitCode: action.exitCode ?? process.exitCode,
					agentDetected: nextAgentDetected,
					provider: nextProvider,
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
		// Sticky upgrade: once a process is recognized as an agent (by either
		// command or label), subsequent label changes by the agent CLI itself
		// (e.g. setting OSC title to the user's prompt) must not flip detection
		// back off. Only updateProcessStatus resets this on exit/restart.
		const nextAgentDetected =
			process.agentDetected || isAgentProcess(action.label, process.command);
		const nextProvider = detectAgentProvider(
			process.command,
			action.label,
			process.provider,
		);
		return {
			...state,
			processSessionsById: {
				...state.processSessionsById,
				[action.processId]: {
					...process,
					label: action.label,
					agentDetected: nextAgentDetected,
					provider: nextProvider,
				},
			},
		};
	}

	// --- Worktree-scoped actions ---

	if (action.type === "session/registerProcess") {
		const session = state.sessionsByWorktreeId[action.worktreeId];
		if (!session) return state;
		// Auto-place into the slot model (fill first empty, else promote a bucket)
		// so registerProcess maintains the invariant processSessionIds === non-null
		// slots. At capacity (6 running) this is a no-op (the UI disables add).
		const plan = planAddPlacement({
			terminalLayoutId: session.terminalLayoutId,
			slotProcessIds: session.slotProcessIds,
		});
		if (plan.kind === "full") return state;
		// "fill" reuses an empty slot in the current layout: write the new process
		// into that slot in place. Do NOT compact first — compaction packs existing
		// shells toward the front, which shifts a later shell into plan.slotIndex
		// and would overwrite (orphan) its running process. "promote" grows into a
		// larger layout and has no empty slots to preserve, so compaction is safe.
		const compacted =
			plan.kind === "fill"
				? session.slotProcessIds.slice()
				: compactIntoLayout(session.slotProcessIds, plan.layoutId);
		compacted[plan.slotIndex] = action.process.id;
		const nextSession: WorktreeSession = {
			...session,
			terminalLayoutId: plan.layoutId,
			slotProcessIds: compacted,
			processSessionIds: compacted.filter((s): s is string => s !== null),
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
		// `action.attentionState` comes from the legacy pattern set in
		// deriveAttentionState, which doesn't recognize all agent prompts (e.g.
		// "Do you want to create X?" — no y/n keywords, just a trailing ?).
		// classifyOutput catches those and packages them as agentReason; map
		// that into ProcessAttentionState space and take the max so the sidebar
		// dot reflects the strongest signal in this chunk regardless of source.
		const fromAgent = action.agentReason
			? mapToProcessAttentionState(action.agentReason.state)
			: "idle";
		const incoming =
			attentionRank[fromAgent] > attentionRank[action.attentionState]
				? fromAgent
				: action.attentionState;
		const nextAttention = action.isViewed
			? process.attentionState
			: attentionRank[incoming] >= attentionRank[process.attentionState]
				? incoming
				: process.attentionState;
		let nextReasons = process.agentAttentionReasons;
		if (action.agentReason) {
			if (action.agentReason.source === "mcp") {
				// mcp at process-level is invalid; ignore silently
			} else {
				const current =
					process.agentAttentionReasons[action.agentReason.source];
				if (shouldReplaceAgentAttentionReason(current, action.agentReason)) {
					nextReasons = {
						...process.agentAttentionReasons,
						[action.agentReason.source]: action.agentReason,
					};
				}
			}
		}
		const nextProcessSessionsById = {
			...state.processSessionsById,
			[action.processId]: {
				...process,
				attentionState: nextAttention,
				lastActivityAt: action.at,
				agentAttentionReasons: nextReasons,
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
		const slotIndex = session.slotProcessIds.indexOf(action.processId);
		const slots = session.slotProcessIds.slice();
		if (slotIndex >= 0) slots[slotIndex] = null;
		const remaining = slots.filter((s): s is string => s !== null);

		const nextProcessSessionsById = Object.fromEntries(
			Object.entries(state.processSessionsById).filter(
				([id]) => id !== action.processId,
			),
		);

		let terminalLayoutId: LayoutId = session.terminalLayoutId;
		let slotProcessIds = slots;
		// Focus the NEAREST remaining slot when the closed slot was active;
		// otherwise leave focus untouched.
		let activeProcessSessionId =
			session.activeProcessSessionId === action.processId
				? slotIndex >= 0
					? nearestOccupiedSlot(slots, slotIndex)
					: (remaining[0] ?? null)
				: session.activeProcessSessionId;

		if (remaining.length === 0) {
			// last shell closed -> reset to single empty layout
			terminalLayoutId = "1";
			slotProcessIds = [null];
			activeProcessSessionId = null;
		}

		const nextSession: WorktreeSession = {
			...session,
			terminalLayoutId,
			slotProcessIds,
			processSessionIds: remaining,
			activeProcessSessionId,
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
			gitSummaryMessage: session.gitSummaryStale
				? session.gitSummaryMessage
				: null,
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

	if (action.type === "session/reportProcessAgentAttention") {
		const process = state.processSessionsById[action.processId];
		const session = state.sessionsByWorktreeId[action.worktreeId];
		if (!process || !session) return state;
		if (action.reason.source === "mcp") return state; // process-level rejects mcp
		const current = process.agentAttentionReasons[action.reason.source];
		if (!shouldReplaceAgentAttentionReason(current, action.reason))
			return state;
		const nextReasons: AgentAttentionReasonsBySource = {
			...process.agentAttentionReasons,
			[action.reason.source]: action.reason,
		};
		const nextAgent = rankAgentAttention(nextReasons, false);
		const mappedLegacy = mapToProcessAttentionState(nextAgent);
		const nextLegacy =
			attentionRank[mappedLegacy] >= attentionRank[process.attentionState]
				? mappedLegacy
				: process.attentionState;
		const nextProcessSessionsById = {
			...state.processSessionsById,
			[action.processId]: {
				...process,
				agentAttentionReasons: nextReasons,
				attentionState: nextLegacy,
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

	if (action.type === "session/reportAgentAttention") {
		const session = state.sessionsByWorktreeId[action.worktreeId];
		if (!session) return state;
		if (action.reason.source !== "mcp" && action.reason.source !== "workflow")
			return state; // session-level accepts authoritative sources only
		const current = session.agentAttentionReasons[action.reason.source];
		const updatedReasons: AgentAttentionReasonsBySource = {
			...session.agentAttentionReasons,
		};
		const replaced = shouldReplaceAgentAttentionReason(current, action.reason);
		if (replaced) {
			updatedReasons[action.reason.source] = action.reason;
		}
		// Task only updates when the push was accepted (`replaced`). A stale /
		// out-of-order MCP push (older `reportedAt`) is rejected, so it must NOT
		// overwrite the visible task — leave `session.task` untouched, making a
		// fully-rejected push a no-op for this field too. When accepted:
		// undefined leaves task alone; null clears it; a string sets it.
		const nextTask =
			replaced && action.task !== undefined ? action.task : session.task;
		let nextProcessSessionsById = state.processSessionsById;
		// Clearing stale terminal heuristics is an MCP-specific side effect: only
		// the agent's own self-report supersedes the terminal classifier. A
		// `workflow` report carries no such authority over per-process terminal
		// state, so it must NOT clear those reasons. Additionally, only an
		// *accepted* non-failed push clears them; a rejected (stale / out-of-order)
		// push must have no side effects.
		if (
			action.reason.source === "mcp" &&
			replaced &&
			action.reason.state !== "failed"
		) {
			nextProcessSessionsById = clearStaleTerminalReasonsForSessionProcesses(
				state.processSessionsById,
				session.processSessionIds,
			);
		}
		const base: WorktreeSession = {
			...session,
			agentAttentionReasons: updatedReasons,
			task: nextTask,
		};
		const nextSession: WorktreeSession = {
			...base,
			attentionState: recalculateWorktreeAttention(
				base,
				nextProcessSessionsById,
			),
		};
		return {
			...state,
			sessionsByWorktreeId: {
				...state.sessionsByWorktreeId,
				[action.worktreeId]: nextSession,
			},
			processSessionsById: nextProcessSessionsById,
		};
	}

	if (action.type === "session/clearProcessAgentAttention") {
		const process = state.processSessionsById[action.processId];
		const session = state.sessionsByWorktreeId[action.worktreeId];
		if (!process || !session) return state;
		const nextReasons: AgentAttentionReasonsBySource = {};
		if (!action.sticky) {
			// keep only failed reasons; sticky=true also clears failed
			for (const [src, r] of Object.entries(process.agentAttentionReasons)) {
				if (r && r.state === "failed")
					nextReasons[src as AgentAttentionSource] = r;
			}
		}
		const mappedAgent = rankAgentAttention(nextReasons, false);
		const mappedLegacy = mapToProcessAttentionState(mappedAgent);
		const nextProcessSessionsById = {
			...state.processSessionsById,
			[action.processId]: {
				...process,
				agentAttentionReasons: nextReasons,
				agentAttentionClearedAt: action.clearedAt,
				attentionState: mappedLegacy,
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

	if (action.type === "session/clearSessionAgentAttention") {
		const session = state.sessionsByWorktreeId[action.worktreeId];
		if (!session) return state;
		// With a source: drop only that key (no-op identity when it is absent, so
		// polling clears don't churn state). Without a source: clear all reasons.
		if (action.source !== undefined) {
			if (session.agentAttentionReasons[action.source] === undefined)
				return state;
			const { [action.source]: _removed, ...remainingReasons } =
				session.agentAttentionReasons;
			return {
				...state,
				sessionsByWorktreeId: {
					...state.sessionsByWorktreeId,
					[action.worktreeId]: {
						...session,
						agentAttentionReasons: remainingReasons,
					},
				},
			};
		}
		return {
			...state,
			sessionsByWorktreeId: {
				...state.sessionsByWorktreeId,
				[action.worktreeId]: { ...session, agentAttentionReasons: {} },
			},
		};
	}

	// --- Remaining session-level actions ---

	const session = state.sessionsByWorktreeId[action.worktreeId];
	if (!session) return state;

	let nextSession: WorktreeSession;

	if (action.type === "session/setNote") {
		nextSession = { ...session, note: action.note };
	} else if (action.type === "session/setReviewMode") {
		nextSession = { ...session, reviewMode: action.reviewMode };
	} else if (action.type === "session/setFilesPaneMode") {
		nextSession = { ...session, filesPaneMode: action.filesPaneMode };
	} else if (action.type === "session/setReviewSidebarWidth") {
		nextSession = { ...session, reviewSidebarWidth: action.width };
	} else if (action.type === "session/selectFile") {
		// A deliberate file open (tree click) ends any transient preview and
		// becomes the current nav location at file top.
		nextSession = {
			...session,
			reviewMode: "files",
			viewerMode: "file",
			selectedFilePath: action.relativePath,
			paneTransient: false,
			navLocation: { file: action.relativePath, line: 1 },
		};
	} else if (action.type === "session/selectFileAtLocation") {
		nextSession = {
			...session,
			reviewMode: "files",
			viewerMode: "file",
			selectedFilePath: action.relativePath,
			pendingReveal: {
				line: action.revealLine,
				column: action.revealColumn,
				capturedAt: Date.now(),
			},
			paneTransient: action.transient,
			navLocation: {
				file: action.relativePath,
				line: action.revealLine,
				column: action.revealColumn,
			},
		};
	} else if (action.type === "session/consumePendingReveal") {
		if (!session.pendingReveal) return state;
		nextSession = { ...session, pendingReveal: null };
	} else if (action.type === "session/selectChangedFile") {
		// Switching to a diff leaves code-nav mode: end any transient preview
		// and clear the code-pane nav location so the next jump doesn't push a
		// stale code file onto history.
		nextSession = {
			...session,
			reviewMode: "changes",
			viewerMode: "diff",
			selectedChangedFilePath: action.relativePath,
			paneTransient: false,
			navLocation: null,
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
