import type { Worktree } from "../../../shared/models/worktree";
import type { ProcessAttentionState } from "../../../shared/models/process-session";

type Props = {
	worktrees: Worktree[];
	selectedWorktreeId: string | null;
	attentionByWorktreeId?: Record<string, ProcessAttentionState>;
	onSelect: (worktreeId: string) => void;
};

export function SessionSidebar({
	worktrees,
	selectedWorktreeId,
	attentionByWorktreeId,
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
							data-attention={attentionByWorktreeId?.[worktree.id] ?? "idle"}
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
