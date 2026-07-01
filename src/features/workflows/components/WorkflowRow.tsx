import type { WorkflowRow as WorkflowRowModel } from "../logic/workflow-lens";

/**
 * Sidebar workflow lens — a mini version of the dashboard inspector, separated
 * from the shells above it. Line 1: workflow type + artifact, plus a
 * semantically-colored status (escalation outranks the raw status). Line 2: the
 * current phase + iteration.
 *
 * The quiet "done" state renders NO status badge: the worktree header already
 * carries "workflow done" inline, so a done badge here would just duplicate it.
 * Every other state (running / paused / halted / escalated / canceled) keeps its
 * badge — those are not surfaced as text on the worktree header.
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
	// "ready" (done) is carried by the worktree header — omit it here.
	const showStatus = statusTier !== "ready";
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
				{showStatus && (
					<span
						className="workflow-row__status"
						data-status={statusKey}
						data-tier={statusTier}
					>
						<span className="workflow-row__status-dot" aria-hidden="true" />
						{statusKey}
					</span>
				)}
			</div>
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
