import type { WorkflowRow as WorkflowRowModel } from "../logic/workflow-lens";

/**
 * Sidebar workflow lens — a mini version of the dashboard inspector, separated
 * from the shells above it. Header: workflow type + a semantically-colored
 * status (escalation outranks the raw status). Below: the artifact, then the
 * current phase + iteration.
 */
export function WorkflowRow(props: {
	row: WorkflowRowModel & { stale?: boolean };
	onOpenDetail: (worktreeId: string) => void;
}) {
	const { row } = props;
	// Escalation is a distinct, more-urgent state than the raw workflow status.
	const statusKey = row.escalated ? "escalated" : row.status;
	return (
		<button
			type="button"
			className="workflow-row"
			onClick={() => props.onOpenDetail(row.worktreeId)}
		>
			<div className="workflow-row__header">
				<span className="workflow-row__caption">Last workflow:</span>
				<span className="workflow-row__type">{row.typeLabel}</span>
				<span className="workflow-row__status" data-status={statusKey}>
					<span className="workflow-row__status-dot" aria-hidden="true" />
					{statusKey}
				</span>
			</div>
			{row.artifact && (
				<span className="workflow-row__artifact" title={row.artifact}>
					{row.artifact}
				</span>
			)}
			<div className="workflow-row__phase">
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
