import type { Worktree } from "../../../../shared/models/worktree";

export function displayTitle(sessionTitle: string, worktree: Worktree): string {
	const trimmed = sessionTitle.trim();
	return trimmed.length > 0 ? trimmed : worktree.label;
}
