import type { WorkspaceState } from "./workspace-state";
import type {
	PersistedProcessSession,
	PersistedWorktreeSession,
	WorkspaceSnapshot,
} from "../../../shared/models/persisted-workspace-state";

/**
 * Returns true when the loaded repo likely corresponds to the saved snapshot,
 * even if the filesystem path has changed (e.g. after a rename/move).
 */
export function shouldReattachSnapshot(
	repo: { repoId: string | null; name: string },
	snapshot: WorkspaceSnapshot | null,
): boolean {
	if (!snapshot) return false;
	// When either side has a repoId, use strict identity comparison.
	// Basename fallback only triggers when BOTH sides lack a repoId.
	if (snapshot.repoId || repo.repoId) return snapshot.repoId === repo.repoId;
	const savedName = snapshot.repositoryPath.split("/").filter(Boolean).at(-1);
	return savedName !== undefined && savedName === repo.name;
}

/**
 * Replaces the old repository path prefix with the new one in all path-based
 * worktree IDs (selectedWorktreeId and worktreeSessions[*].worktreeId).
 * Returns the snapshot unchanged (same reference) when prefixes are equal.
 */
export function rebaseSnapshotPaths(
	snapshot: WorkspaceSnapshot,
	oldPrefix: string,
	newPrefix: string,
): WorkspaceSnapshot {
	if (oldPrefix === newPrefix) return snapshot;

	const rebase = (id: string | null): string | null => {
		if (!id) return id;
		if (id === oldPrefix) return newPrefix;
		if (id.startsWith(oldPrefix + "/")) return newPrefix + id.slice(oldPrefix.length);
		return id;
	};

	return {
		...snapshot,
		selectedWorktreeId: rebase(snapshot.selectedWorktreeId),
		worktreeSessions: snapshot.worktreeSessions.map((session) => ({
			...session,
			worktreeId: rebase(session.worktreeId) ?? session.worktreeId,
		})),
	};
}

export function buildWorkspaceSnapshot(
	repositoryPath: string,
	repoId: string | null,
	state: WorkspaceState,
): WorkspaceSnapshot {
	return {
		repositoryPath,
		repoId,
		selectedWorktreeId: state.selectedWorktreeId,
		topBandCollapsed: state.topBandCollapsed,
		commandPresets: state.commandPresets,
		worktreeSessions: Object.values(state.sessionsByWorktreeId).map((session) => ({
			worktreeId: session.worktreeId,
			note: session.note,
			reviewMode: session.reviewMode,
			viewerMode: session.viewerMode,
			selectedFilePath: session.selectedFilePath,
			selectedChangedFilePath: session.selectedChangedFilePath,
			selectedCommitSha: session.selectedCommitSha,
			selectedCommitFilePath: session.selectedCommitFilePath,
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
