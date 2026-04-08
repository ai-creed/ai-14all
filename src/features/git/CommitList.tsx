import { buildLinearCommitGraph } from "./build-linear-commit-graph.js";
import type { GitCommitHistory, GitCommitDetail } from "../../../shared/models/git-commit-review.js";

type Props = {
	history: GitCommitHistory;
	selectedCommitSha: string | null;
	selectedCommitFilePath: string | null;
	activeDetail: GitCommitDetail | null;
	onSelectCommit: (sha: string) => void;
	onDeselectCommit?: () => void;
	onSelectCommitFile: (relativePath: string) => void;
};

export function CommitList({
	history,
	selectedCommitSha,
	selectedCommitFilePath,
	activeDetail,
	onSelectCommit,
	onDeselectCommit,
	onSelectCommitFile,
}: Props) {
	if (!history.mergeTargetRef || history.entries.length === 0) {
		return <p className="shell-empty-state">No recent commits to review.</p>;
	}

	const rows = buildLinearCommitGraph(history.entries);

	return (
		<div className="shell-commit-list">
			<div className="shell-commit-list__target">{history.mergeTargetRef}</div>
			{rows.map((row, index) => {
				const isSelected = selectedCommitSha === row.sha;
				const showFiles =
					isSelected &&
					row.rowKind === "commit" &&
					activeDetail?.sha === row.sha;

				return (
					<div
						key={row.sha}
						className="shell-commit-list__row"
						data-selected={String(isSelected)}
						data-row-kind={row.rowKind}
						data-first={String(index === 0)}
						data-last={String(index === rows.length - 1)}
					>
						<button
							type="button"
							className="shell-commit-list__item"
							data-selected={String(isSelected)}
							data-row-kind={row.rowKind}
							onClick={() => isSelected ? onDeselectCommit?.() : onSelectCommit(row.sha)}
						>
							<span
								className="shell-commit-list__graph-column"
								aria-hidden="true"
							>
								<span className="shell-commit-list__graph" />
							</span>
							<code className="shell-commit-list__sha">{row.shortSha}</code>
							<span className="shell-commit-list__subject">{row.subject}</span>
						</button>
						{showFiles && (
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
			})}
		</div>
	);
}
