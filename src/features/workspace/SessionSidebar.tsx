import type { Worktree } from "../../../shared/models/worktree";
import type { ProcessAttentionState } from "../../../shared/models/process-session";

type Props = {
	worktrees: Worktree[];
	selectedWorktreeId: string | null;
	attentionByWorktreeId?: Record<string, ProcessAttentionState>;
	collapsed: boolean;
	onToggleCollapsed: () => void;
	onSelect: (worktreeId: string) => void;
};

export function SessionSidebar({
	worktrees,
	selectedWorktreeId,
	attentionByWorktreeId,
	collapsed,
	onToggleCollapsed,
	onSelect,
}: Props) {
	return (
		<nav
			aria-label="Worktree sessions"
			className="shell-panel shell-sidebar"
			data-collapsed={String(collapsed)}
		>
			<div className="shell-sidebar__header">
				{!collapsed && <div className="shell-label">Sessions</div>}
				<button
					type="button"
					className="shell-button shell-button--icon shell-button--compact shell-button--round"
					aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
					onClick={onToggleCollapsed}
				>
					<span aria-hidden="true">{collapsed ? "▸" : "◂"}</span>
				</button>
			</div>

			<div className="shell-sidebar__list">
				{worktrees.map((worktree) => {
					const selected = worktree.id === selectedWorktreeId;
					const marker = worktree.label.slice(0, 1).toUpperCase();
					return (
						<button
							key={worktree.id}
							type="button"
							className="shell-sidebar__item"
							data-selected={String(selected)}
							data-attention={attentionByWorktreeId?.[worktree.id] ?? "idle"}
							aria-label={`${worktree.label} ${worktree.branchName}`}
							onClick={() => onSelect(worktree.id)}
						>
							{collapsed ? (
								<span className="shell-sidebar__marker">{marker}</span>
							) : (
								<>
									<strong>{worktree.label}</strong>
									{worktree.branchName !== worktree.label && (
										<div className="shell-sidebar__branch">{worktree.branchName}</div>
									)}
								</>
							)}
						</button>
					);
				})}
			</div>
		</nav>
	);
}
