type Props = {
	title: string;
	worktreePath: string;
	branchName: string;
	changedFileCount: number;
	isDirty: boolean;
	gitSummaryError?: boolean;
	collapsed: boolean;
	onToggleCollapsed: () => void;
};

export function SessionHeader({
	title,
	worktreePath,
	branchName,
	changedFileCount,
	isDirty,
	gitSummaryError = false,
	collapsed,
	onToggleCollapsed,
}: Props) {
	return (
		<section aria-label="Session info" className="shell-panel shell-session-info">
			<div className="shell-session-info__header">
				<div>
					{!collapsed && <div className="shell-label">Session info</div>}
					<h2 className="shell-session-info__title">{title}</h2>
				</div>
				<button
					type="button"
					className="shell-session-info__toggle"
					aria-expanded={!collapsed}
					aria-label={collapsed ? "Expand session info" : "Collapse session info"}
					onClick={onToggleCollapsed}
				>
					{collapsed ? "Expand" : "Collapse"}
				</button>
			</div>

			{!collapsed && (
				<div className="shell-session-info__path-group">
					<div className="shell-label">Worktree path</div>
					<code className="shell-session-info__path">{worktreePath}</code>
				</div>
			)}

			<div className="shell-session-info__meta">
				<span><span>Branch:</span> <strong>{branchName}</strong></span>
				<span>
					<span>Status:</span>{" "}
					<strong>{gitSummaryError ? "Unknown" : isDirty ? "Dirty" : "Clean"}</strong>
				</span>
				<span><span>Changes:</span> <strong>{changedFileCount}</strong></span>
			</div>
		</section>
	);
}
