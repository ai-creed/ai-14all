import type { Worktree } from "../../../shared/models/worktree";
import type { ProcessAttentionState } from "../../../shared/models/process-session";

type Props = {
	worktrees: Worktree[];
	selectedWorktreeId: string | null;
	attentionByWorktreeId?: Record<string, ProcessAttentionState>;
	collapsed: boolean;
	onToggleCollapsed: () => void;
	onSelect: (worktreeId: string) => void;
	onCreateWorktree: () => void;
	onRemoveWorktree: (worktreeId: string) => void;
};

export function SessionSidebar({
	worktrees,
	selectedWorktreeId,
	attentionByWorktreeId,
	collapsed,
	onToggleCollapsed,
	onSelect,
	onCreateWorktree,
	onRemoveWorktree,
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
					return (
						<div key={worktree.id} className="shell-sidebar__row">
							<button
								type="button"
								className="shell-sidebar__item"
								data-selected={String(selected)}
								data-attention={attentionByWorktreeId?.[worktree.id] ?? "idle"}
								aria-label={worktree.branchName !== worktree.label ? `${worktree.label} ${worktree.branchName}` : worktree.label}
								onClick={() => onSelect(worktree.id)}
							>
								{collapsed ? <span className="shell-sidebar__marker">{worktree.label.slice(0, 1).toUpperCase()}</span> : <>
									<strong>{worktree.label}</strong>
									{worktree.branchName !== worktree.label && (
										<div className="shell-sidebar__branch">{worktree.branchName}</div>
									)}
								</>}
							</button>
							{!collapsed && !worktree.isMain && (
								<button
									type="button"
									className="shell-button shell-button--icon shell-button--compact"
									aria-label={`Remove ${worktree.label}`}
									onClick={() => onRemoveWorktree(worktree.id)}
								>
									×
								</button>
							)}
						</div>
					);
				})}
			</div>

			<div className="shell-sidebar__footer">
				<button
					type="button"
					className="shell-button shell-button--compact"
					onClick={onCreateWorktree}
					aria-label="New worktree"
				>
					{collapsed ? "+" : "New worktree"}
				</button>
			</div>
		</nav>
	);
}
