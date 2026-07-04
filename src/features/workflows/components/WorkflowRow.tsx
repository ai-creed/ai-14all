import {
	workflowStatusLabel,
	type WorkflowRow as WorkflowRowModel,
} from "../logic/workflow-lens";

/**
 * Sidebar workflow lens — a mini version of the dashboard inspector, separated
 * from the shells above it. Line 1: workflow type + artifact. Line 2:
 * `<dot> <status> - <phase> - <round>` — a semantically-colored status dot plus
 * an explicit status word ("completed" / "halted" / "escalated" / …) in the
 * SAME color, so whether a run finished or halted reads at a glance rather than
 * relying on the dot color alone. Escalation outranks the raw status.
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
	const statusLabel = workflowStatusLabel(statusKey);
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
					title={statusKey}
				>
					<span className="workflow-row__status-dot" aria-hidden="true" />
					<span className="workflow-row__status-label">{statusLabel}</span>
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
