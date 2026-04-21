import type { WorkspaceState } from "./workspace-state";
import type {
	PersistedProcessSession,
	PersistedSavedWorkspace,
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
		commandPresets: state.commandPresets,
		worktreeSessions: Object.values(state.sessionsByWorktreeId).map((session) => ({
			worktreeId: session.worktreeId,
			title: session.title,
			note: session.note,
			reviewMode: session.reviewMode,
			reviewDrawerOpen: session.reviewDrawerOpen,
			viewerMode: session.viewerMode,
			selectedFilePath: session.selectedFilePath,
			selectedChangedFilePath: session.selectedChangedFilePath,
			selectedCommitSha: session.selectedCommitSha,
			selectedCommitFilePath: session.selectedCommitFilePath,
			activeProcessSessionId: session.activeProcessSessionId,
			terminalLayoutMode: session.terminalLayoutMode,
			splitLeftProcessId: session.splitLeftProcessId,
			splitRightProcessId: session.splitRightProcessId,
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
					terminalSessionId: process.terminalSessionId,
				})),
		})),
	};
}

/**
 * After a repository rename, `git worktree list` may still report linked
 * worktrees at their old paths (stale gitdir back-references). This function
 * reconciles the rebased snapshot so that any session whose rebased worktreeId
 * is not present in `wts` but whose original worktreeId IS present is mapped
 * back to the original id — allowing the reducer to find and restore it.
 *
 * The same fallback is applied to `selectedWorktreeId`.
 *
 * Returns `rebasedSnapshot` unchanged when no reconciliation is needed.
 */
export function reconcileSnapshotToWorktrees(
	rebasedSnapshot: WorkspaceSnapshot,
	originalSnapshot: WorkspaceSnapshot,
	wts: { id: string }[],
): WorkspaceSnapshot {
	const wtsIds = new Set(wts.map((w) => w.id));

	const reconcileId = (
		rebasedId: string | null,
		originalId: string | null,
	): string | null => {
		if (!rebasedId || wtsIds.has(rebasedId)) return rebasedId;
		if (originalId && wtsIds.has(originalId)) return originalId;
		return rebasedId;
	};

	const reconciledSelectedId = reconcileId(
		rebasedSnapshot.selectedWorktreeId,
		originalSnapshot.selectedWorktreeId,
	);

	const reconciledSessions = rebasedSnapshot.worktreeSessions.map((session, i) => {
		const originalId = originalSnapshot.worktreeSessions[i]?.worktreeId ?? null;
		const reconciledId = reconcileId(session.worktreeId, originalId);
		if (reconciledId === session.worktreeId) return session;
		return { ...session, worktreeId: reconciledId ?? session.worktreeId };
	});

	if (
		reconciledSelectedId === rebasedSnapshot.selectedWorktreeId &&
		reconciledSessions.every((s, i) => s === rebasedSnapshot.worktreeSessions[i])
	) {
		return rebasedSnapshot;
	}

	return {
		...rebasedSnapshot,
		selectedWorktreeId: reconciledSelectedId,
		worktreeSessions: reconciledSessions,
	};
}

export function buildSavedWorkspace(
	workspaceId: string,
	repositoryPath: string,
	repoId: string | null,
	state: WorkspaceState,
): PersistedSavedWorkspace {
	return {
		workspaceId,
		repositoryPath,
		repoId,
		snapshot: buildWorkspaceSnapshot(repositoryPath, repoId, state),
	};
}

export function findSavedWorkspaceMatch(
	saved: PersistedSavedWorkspace,
	repo: { repoId: string | null; rootPath: string; name: string },
): boolean {
	if (saved.repoId || repo.repoId) return saved.repoId === repo.repoId;
	return saved.repositoryPath === repo.rootPath;
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
