import type { WorkspaceState } from "./workspace-state";
import type {
	PersistedProcessSession,
	PersistedWorktreeSession,
	WorkspaceSnapshot,
} from "../../../shared/models/persisted-workspace-state";

export function buildWorkspaceSnapshot(
	repositoryPath: string,
	state: WorkspaceState,
): WorkspaceSnapshot {
	return {
		repositoryPath,
		selectedWorktreeId: state.selectedWorktreeId,
		commandPresets: state.commandPresets,
		worktreeSessions: Object.values(state.sessionsByWorktreeId).map((session) => ({
			worktreeId: session.worktreeId,
			note: session.note,
			reviewMode: session.reviewMode,
			viewerMode: session.viewerMode,
			selectedFilePath: session.selectedFilePath,
			selectedChangedFilePath: session.selectedChangedFilePath,
			activeProcessSessionId: session.activeProcessSessionId,
			nextAdHocNumber: state.nextAdHocNumberByWorktreeId[session.worktreeId] ?? 1,
			processSessions: session.processSessionIds
				.map((id) => state.processSessionsById[id])
				.filter((process): process is NonNullable<typeof process> => !!process)
				.map<PersistedProcessSession>((process) => ({
					id: process.id,
					origin: process.origin,
					presetId: process.presetId,
					label: process.label,
					command: process.command,
					pinned: process.pinned,
				})),
		})),
	};
}

export function splitPendingRestores(snapshot: WorkspaceSnapshot): {
	selectedSession: PersistedWorktreeSession | null;
	pendingByWorktreeId: Record<string, PersistedWorktreeSession>;
} {
	const pendingByWorktreeId: Record<string, PersistedWorktreeSession> = {};
	let selectedSession: PersistedWorktreeSession | null = null;

	for (const session of snapshot.worktreeSessions) {
		if (session.worktreeId === snapshot.selectedWorktreeId) {
			selectedSession = session;
		} else {
			pendingByWorktreeId[session.worktreeId] = session;
		}
	}

	return { selectedSession, pendingByWorktreeId };
}
