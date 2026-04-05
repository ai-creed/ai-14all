type Props = {
	worktreePath: string;
	note: string;
	onNoteChange: (note: string) => void;
};

export function ContextPanel({
	worktreePath,
	note,
	onNoteChange,
}: Props) {
	return (
		<aside aria-label="Session context" className="shell-panel shell-context">
			<div className="shell-context__section">
				<div className="shell-label">Worktree path</div>
				<code className="shell-context__path">{worktreePath}</code>
			</div>

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
