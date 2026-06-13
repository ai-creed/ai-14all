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
	/** Render slot for the token-telemetry strip, placed in the bar's mid gap. */
	usage?: React.ReactNode;
	/**
	 * Render slot for the global "Plugins" entry point, placed beside the usage
	 * strip. Lives in the global app chrome (not the worktree sidebar) and is
	 * rendered unconditionally — it is an ai-14all feature, not a peer trace.
	 */
	plugins?: React.ReactNode;
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
	usage,
	plugins,
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

			{usage && <div className="shell-chip-bar__usage">{usage}</div>}

			{plugins && <div className="shell-chip-bar__plugins">{plugins}</div>}

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
			</div>
		</div>
	);
}
