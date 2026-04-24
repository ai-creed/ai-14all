type Props = {
	title: string;
	worktreePath: string;
	branchName: string;
	changedFileCount: number;
	isDirty: boolean;
	mergeTargetRef?: string | null;
	aheadCount?: number;
	behindCount?: number;
	gitSummaryError?: boolean;
	gitSummaryStale?: boolean;
	collapsed: boolean;
};

export function SessionHeader({
	title,
	worktreePath,
	branchName,
	changedFileCount,
	isDirty,
	mergeTargetRef = null,
	aheadCount = 0,
	behindCount = 0,
	gitSummaryError = false,
	gitSummaryStale = false,
	collapsed,
}: Props) {
	const statusLabel = gitSummaryError
		? "Unknown"
		: gitSummaryStale
			? `${isDirty ? "Dirty" : "Clean"} (stale)`
			: isDirty
				? "Dirty"
				: "Clean";
	const branchDescription =
		!collapsed &&
		isDirty &&
		!gitSummaryError &&
		!gitSummaryStale &&
		mergeTargetRef
			? aheadCount > 0 && behindCount > 0
				? `${aheadCount} ahead, ${behindCount} behind ${mergeTargetRef}`
				: aheadCount > 0
					? `${aheadCount} ahead of ${mergeTargetRef}`
					: behindCount > 0
						? `${behindCount} behind ${mergeTargetRef}`
						: `In sync with ${mergeTargetRef}`
			: null;

	return (
		<section aria-label="Session info" className="shell-session-info">
			<div className="shell-session-info__header">
				<div>
					{!collapsed && <div className="shell-label">Session info</div>}
					<h2 className="shell-session-info__title">{title}</h2>
					{branchDescription && (
						<div className="shell-session-info__description">
							{branchDescription}
						</div>
					)}
				</div>
				{collapsed && (
					<div className="shell-session-info__strip">
						<span>{branchName}</span>
						<span>{statusLabel}</span>
						<span>{changedFileCount}</span>
					</div>
				)}
			</div>

			{!collapsed && (
				<>
					<div className="shell-session-info__path-group">
						<div className="shell-label">Worktree path</div>
						<code className="shell-session-info__path">{worktreePath}</code>
					</div>

					<div className="shell-session-info__meta">
						<span>
							<span>Branch:</span> <strong>{branchName}</strong>
						</span>
						<span>
							<span>Status:</span> <strong>{statusLabel}</strong>
						</span>
						<span>
							<span>Changes:</span> <strong>{changedFileCount}</strong>
						</span>
					</div>
				</>
			)}
		</section>
	);
}
