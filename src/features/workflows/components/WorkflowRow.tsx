import type { WorkflowRow as WorkflowRowModel } from "../logic/workflow-lens";

export function WorkflowRow(props: {
	row: WorkflowRowModel & { stale?: boolean };
	onOpenDetail: (worktreeId: string) => void;
}) {
	const { row } = props;
	return (
		<button
			type="button"
			className="workflow-row"
			onClick={() => props.onOpenDetail(row.worktreeId)}
		>
			<span className="workflow-type">{row.workflowType}</span>
			{row.phaseName && <span className="workflow-phase">{row.phaseName}</span>}
			{row.roundLabel && (
				<span className="workflow-round">{row.roundLabel}</span>
			)}
			<span className="workflow-status" data-status={row.status}>
				{row.status}
			</span>
			{!row.daemonAlive && (
				<span className="workflow-daemon-down">daemon not running</span>
			)}
			{row.stale && <span className="workflow-stale">stale</span>}
		</button>
	);
}
