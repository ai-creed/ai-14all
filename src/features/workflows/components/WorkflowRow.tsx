import type { WorkflowRow as WorkflowRowModel } from "../logic/workflow-lens";

/**
 * Sidebar workflow lens — a mini version of the dashboard inspector, separated
 * from the shells above it. Line 1: workflow type + artifact. Line 2: a
 * semantically-colored status dot (escalation outranks the raw status), then the
 * current phase + iteration.
 *
 * The status is a dot rather than a text badge: its color carries the tier
 * (ready / neutral / actionRequired) and its title carries the exact word, so
 * the lens stays compact and doesn't duplicate the worktree header's status.
 */
export function WorkflowRow(props: {
	row: WorkflowRowModel & { stale?: boolean };
	onOpenDetail: (worktreeId: string) => void;
}) {
	const { row } = props;
	// Escalation is a distinct, more-urgent state than the raw workflow status.
	const statusKey = row.escalated ? "escalated" : row.status;
	const statusTier =
		row.escalated || row.status === "halted"
			? "actionRequired"
			: row.status === "done"
				? "ready"
				: "neutral";
	return (
		<button
			type="button"
			className="workflow-row"
			onClick={() => props.onOpenDetail(row.worktreeId)}
		>
			<div className="workflow-row__artifact-line">
				<span className="workflow-row__type">{row.typeLabel}</span>
				{row.artifact && (
					<span className="workflow-row__artifact" title={row.artifact}>
						{row.artifact}
					</span>
				)}
			</div>
			<div className="workflow-row__phase">
				<span
					className="workflow-row__status"
					data-status={statusKey}
					data-tier={statusTier}
					role="img"
					aria-label={`workflow ${statusKey}`}
					title={statusKey}
				>
					<span className="workflow-row__status-dot" aria-hidden="true" />
				</span>
				<span className="workflow-row__phase-name">{row.phaseName ?? "—"}</span>
				{row.roundLabel && (
					<span className="workflow-row__round">round {row.roundLabel}</span>
				)}
			</div>
			{!row.daemonAlive && (
				<span className="workflow-row__daemon-down">daemon not running</span>
			)}
			{row.stale && <span className="workflow-row__stale">stale</span>}
		</button>
	);
}
