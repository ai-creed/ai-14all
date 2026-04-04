import type { GitSummary } from "../../../shared/models/git-summary";

type Props = {
	branchName: string;
	worktreePath: string;
	note: string;
	gitSummary: GitSummary | null;
	gitSummaryError?: boolean;
	onNoteChange: (note: string) => void;
};

export function ContextPanel({
	branchName,
	worktreePath,
	note,
	gitSummary,
	gitSummaryError = false,
	onNoteChange,
}: Props) {
	return (
		<aside aria-label="Session context" className="shell-panel shell-context">
			<div className="shell-label">Active branch</div>
			<div className="shell-context__branch">{branchName}</div>

			<div className="shell-context__section">
				<div className="shell-label">Worktree path</div>
				<code className="shell-context__path">{worktreePath}</code>
			</div>

			{gitSummaryError ? (
				<p className="shell-empty-state shell-empty-state--error">
					Unable to load Git data.
				</p>
			) : (
				<>
					<div className="shell-context__section">
						<div className="shell-label">Git status</div>
						<div
							className="shell-context__status"
							data-dirty={String(gitSummary?.isDirty ?? false)}
						>
							{gitSummary?.isDirty ? "Dirty" : "Clean"}
						</div>
					</div>

					<div className="shell-context__section">
						<div className="shell-label">Changed files</div>
						{gitSummary?.changedFiles.length ? (
							<ul className="shell-context__list">
								{gitSummary.changedFiles.map((change) => (
									<li key={change.path}>
										<span>{change.path}</span>
										<strong>{change.status}</strong>
									</li>
								))}
							</ul>
						) : (
							<p className="shell-empty-state">No local changes.</p>
						)}
					</div>

					<div className="shell-context__section">
						<div className="shell-label">Recent commits</div>
						{gitSummary?.recentCommits.length ? (
							<ul className="shell-context__list">
								{gitSummary.recentCommits.map((commit) => (
									<li key={commit.sha}>
										<code>{commit.shortSha}</code>
										<span>{commit.subject}</span>
									</li>
								))}
							</ul>
						) : (
							<p className="shell-empty-state">No recent commits.</p>
						)}
					</div>
				</>
			)}

			<label htmlFor="session-note" className="shell-label">
				Session note
			</label>
			<textarea
				id="session-note"
				className="shell-note-input"
				value={note}
				onChange={(event) => onNoteChange(event.target.value)}
				rows={6}
			/>
		</aside>
	);
}
