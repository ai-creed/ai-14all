import * as Dialog from "@radix-ui/react-dialog";

type Props = {
	open: boolean;
	note: string;
	onNoteChange: (note: string) => void;
	onClose: () => void;
};

export function NoteSheet({ open, note, onNoteChange, onClose }: Props) {
	return (
		<Dialog.Root open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
			<Dialog.Portal>
				<Dialog.Overlay className="shell-note-sheet__overlay" />
				<Dialog.Content className="shell-note-sheet">
					<div className="shell-note-sheet__header">
						<Dialog.Title className="shell-note-sheet__title">Session note</Dialog.Title>
						<Dialog.Close asChild>
							<button type="button" className="shell-note-sheet__close" aria-label="Close note sheet">
								✕
							</button>
						</Dialog.Close>
					</div>
					<textarea
						aria-label="Session note"
						className="shell-note-input shell-note-sheet__textarea"
						value={note}
						onChange={(e) => onNoteChange(e.target.value)}
						placeholder="Write a note for this session…"
						// eslint-disable-next-line jsx-a11y/no-autofocus
						autoFocus
					/>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
