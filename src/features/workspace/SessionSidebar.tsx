import type { Worktree } from "../../../shared/models/worktree";

type Props = {
	worktrees: Worktree[];
	selectedWorktreeId: string | null;
	onSelect: (worktreeId: string) => void;
};

export function SessionSidebar({
	worktrees,
	selectedWorktreeId,
	onSelect,
}: Props) {
	return (
		<nav aria-label="Worktree sessions" className="shell-panel shell-sidebar">
			<div className="shell-sidebar__header">
				<div className="shell-label">Sessions</div>
			</div>

			<div className="shell-sidebar__list">
				{worktrees.map((worktree) => {
					const selected = worktree.id === selectedWorktreeId;
					return (
						<button
							key={worktree.id}
							type="button"
							className="shell-sidebar__item"
							data-selected={String(selected)}
							onClick={() => onSelect(worktree.id)}
						>
							<strong>{worktree.label}</strong>
							<div className="shell-sidebar__branch">{worktree.branchName}</div>
						</button>
					);
				})}
			</div>
		</nav>
	);
}
