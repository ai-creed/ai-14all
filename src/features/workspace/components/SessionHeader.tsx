import { Label } from "@/components/ui/label";

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
		<section aria-label="Session info" className="min-w-0 pr-4">
			<div className="flex items-center justify-start gap-3">
				<div>
					{!collapsed && <Label>Session info</Label>}
					<h2 className="text-base mt-1 leading-tight tracking-[0.01em]">{title}</h2>
					{branchDescription && (
						<div className="mt-2 text-secondary-foreground text-sm leading-snug">
							{branchDescription}
						</div>
					)}
				</div>
				{collapsed && (
					<div className="flex gap-3 items-center text-secondary-foreground text-sm flex-1 min-w-0">
						<span>{branchName}</span>
						<span>{statusLabel}</span>
						<span>{changedFileCount}</span>
					</div>
				)}
			</div>

			{!collapsed && (
				<>
					<div className="mt-3">
						<Label>Worktree path</Label>
						<code className="block mt-2 text-secondary-foreground whitespace-pre-wrap break-words p-2 bg-muted border border-border rounded-sm text-sm">{worktreePath}</code>
					</div>

					<div className="flex flex-wrap gap-3 mt-3 text-secondary-foreground text-sm">
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
