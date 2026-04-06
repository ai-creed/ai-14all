import type { GitChange } from "../../../shared/models/git-change";

type Props = {
	changes: GitChange[];
	selectedPath: string | null;
	onSelect: (relativePath: string) => void;
	gitSummaryError?: boolean;
	gitSummaryStale?: boolean;
	gitSummaryMessage?: string | null;
};

export function ChangesList({
	changes,
	selectedPath,
	onSelect,
	gitSummaryError,
	gitSummaryStale,
	gitSummaryMessage,
}: Props) {
	if (gitSummaryError) {
		return (
			<div className="shell-rail__message">
				<p className="shell-empty-state">Unable to load Git data.</p>
			</div>
		);
	}

	if (changes.length === 0 && !gitSummaryMessage) {
		return (
			<div className="shell-rail__message">
				<p className="shell-empty-state">No changed files.</p>
			</div>
		);
	}

	return (
		<>
			{gitSummaryMessage && (
				<p className={gitSummaryStale ? "shell-inline-warning" : "shell-error"}>
					{gitSummaryMessage}
				</p>
			)}
			{changes.length === 0 ? (
				<div className="shell-rail__message">
					<p className="shell-empty-state">No changed files.</p>
				</div>
			) : (
				<div className="shell-list">
					{changes.map((change) => (
						<button
							key={change.path}
							type="button"
							className="shell-list__item shell-list__item--split"
							data-selected={String(selectedPath === change.path)}
							onClick={() => onSelect(change.path)}
						>
							<span>{change.path}</span>
							<strong>{change.status}</strong>
						</button>
					))}
				</div>
			)}
		</>
	);
}
