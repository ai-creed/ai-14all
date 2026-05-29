export interface ActiveWorktreeRef {
	workspaceId: string;
	worktreeId: string;
	worktreeRoot: string | null;
}

let current: ActiveWorktreeRef | null = null;

export function setActiveWorktreeRef(ref: ActiveWorktreeRef | null): void {
	current = ref;
}

export function getActiveWorktreeRef(): ActiveWorktreeRef | null {
	return current;
}
