type Props = {
	sessionTitle: string;
	worktreeLabel: string;
	branchName: string | null;
	isDirty: boolean;
	changedFileCount: number;
	noteNonEmpty: boolean;
	onRenameClick: () => void;
	onDirtyClick: () => void;
	onFilesClick: () => void;
	onNoteClick: () => void;
	/**
	 * Optional render slot for a separate right-side action group (e.g. terminal
	 * controls). Rendered after the Files/Note chips, separated by a divider.
	 * Kept presentational: SessionChipBar renders the node, it owns no
	 * terminal-specific logic.
	 */
	terminalActions?: React.ReactNode;
};

export function SessionChipBar({
	sessionTitle,
	worktreeLabel,
	branchName,
	isDirty,
	changedFileCount,
	noteNonEmpty,
	onRenameClick,
	onDirtyClick,
	onFilesClick,
	onNoteClick,
	terminalActions,
}: Props) {
	return (
		<div className="shell-chip-bar" role="region" aria-label="Session">
			<div className="shell-chip-bar__identity">
				<span className="shell-chip-bar__title">{sessionTitle}</span>
				<button
					type="button"
					className="shell-chip-bar__rename"
					aria-label="Rename session"
					onClick={onRenameClick}
				>
					✎
				</button>
			</div>

			<div className="shell-chip-bar__meta" aria-label="Worktree and branch">
				<span className="shell-chip-bar__worktree">{worktreeLabel}</span>
				{branchName && (
					<>
						<span className="shell-chip-bar__sep" aria-hidden="true">
							·
						</span>
						<span className="shell-chip-bar__branch">{branchName}</span>
					</>
				)}
			</div>

			<div className="shell-chip-bar__status">
				{isDirty ? (
					<button
						type="button"
						className="shell-chip-bar__dirty-chip"
						aria-label={`${changedFileCount} changed files — open review`}
						onClick={onDirtyClick}
					>
						{changedFileCount} changed
					</button>
				) : (
					<span
						className="shell-chip-bar__clean"
						title="Clean — no changes"
						aria-label="Clean"
					>
						✓ clean
					</span>
				)}
			</div>

			<div className="shell-chip-bar__actions">
				<button
					type="button"
					className="shell-chip-bar__action"
					aria-label="Open Files"
					onClick={onFilesClick}
				>
					<span className="shell-chip-bar__action-icon" aria-hidden="true">
						🗂
					</span>
					Files
				</button>
				<button
					type="button"
					className="shell-chip-bar__action"
					data-indicator={noteNonEmpty ? "true" : "false"}
					aria-label="Open note"
					onClick={onNoteClick}
				>
					<span className="shell-chip-bar__action-icon" aria-hidden="true">
						📝
					</span>
					Note
					{noteNonEmpty && (
						<span className="shell-chip-bar__note-dot" aria-hidden="true" />
					)}
				</button>
				{terminalActions && (
					<>
						<span
							className="shell-chip-bar__action-divider"
							aria-hidden="true"
						/>
						{terminalActions}
					</>
				)}
			</div>
		</div>
	);
}
