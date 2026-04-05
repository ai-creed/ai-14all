type Props = {
	note: string;
	onNoteChange: (note: string) => void;
};

export function ContextPanel({ note, onNoteChange }: Props) {
	return (
		<aside aria-label="Session note panel" className="shell-session-note">
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
