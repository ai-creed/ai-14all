import * as Dialog from "@radix-ui/react-dialog";

type Props = {
	open: boolean;
	onSave: () => void;
	onDiscard: () => void;
	onCancel: () => void;
};

export function ConfirmCloseDialog({ open, onSave, onDiscard, onCancel }: Props) {
	return (
		<Dialog.Root
			open={open}
			onOpenChange={(next) => {
				if (!next) onCancel();
			}}
		>
			<Dialog.Portal>
				<Dialog.Overlay className="shell-modal-overlay" />
				<Dialog.Content className="shell-modal shell-modal--confirm" aria-describedby={undefined}>
					<Dialog.Title className="shell-modal__title">Unsaved changes</Dialog.Title>
					<p className="shell-modal__body">
						Save your changes before closing the editor?
					</p>
					<div className="shell-modal__actions">
						<button type="button" className="shell-btn" onClick={onCancel}>
							Cancel
						</button>
						<button type="button" className="shell-btn shell-btn--danger" onClick={onDiscard}>
							Discard
						</button>
						<button type="button" className="shell-btn shell-btn--primary" onClick={onSave}>
							Save
						</button>
					</div>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
