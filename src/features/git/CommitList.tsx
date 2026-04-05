import { buildLinearCommitGraph } from "./build-linear-commit-graph.js";
import type { GitCommitHistory, GitCommitDetail } from "../../../shared/models/git-commit-review.js";

type Props = {
	history: GitCommitHistory;
	selectedCommitSha: string | null;
	selectedCommitFilePath: string | null;
	activeDetail: GitCommitDetail | null;
	onSelectCommit: (sha: string) => void;
	onSelectCommitFile: (relativePath: string) => void;
};

export function CommitList({
	history,
	selectedCommitSha,
	selectedCommitFilePath,
	activeDetail,
	onSelectCommit,
	onSelectCommitFile,
}: Props) {
	if (!history.mergeTargetRef || history.entries.length === 0) {
		return <p className="shell-empty-state">No recent commits to review.</p>;
	}

	const rows = buildLinearCommitGraph(history.entries);

	return (
		<div className="shell-commit-list">
			<div className="shell-commit-list__target">{history.mergeTargetRef}</div>
			{rows.map((row) => (
				<button
					key={row.sha}
					type="button"
					className="shell-commit-list__item"
					data-selected={String(selectedCommitSha === row.sha)}
					data-row-kind={row.rowKind}
					onClick={() => onSelectCommit(row.sha)}
				>
					<span className="shell-commit-list__graph" aria-hidden="true" />
					<code>{row.shortSha}</code>
					<span className="shell-commit-list__subject">{row.subject}</span>
				</button>
			))}
			{activeDetail && (
				<div className="shell-commit-list__files">
					{activeDetail.files.map((file) => (
						<button
							key={file.path}
							type="button"
							className="shell-list__item shell-list__item--split"
							data-selected={String(selectedCommitFilePath === file.path)}
							onClick={() => onSelectCommitFile(file.path)}
						>
							<span>{file.path}</span>
							<strong>{file.status}</strong>
						</button>
					))}
				</div>
			)}
		</div>
	);
}
