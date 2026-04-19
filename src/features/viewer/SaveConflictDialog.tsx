import * as Dialog from "@radix-ui/react-dialog";

type Props = {
	open: boolean;
	onReload: () => void;
	onOverwrite: () => void;
	onCancel: () => void;
};

export function SaveConflictDialog({
	open,
	onReload,
	onOverwrite,
	onCancel,
}: Props) {
	return (
		<Dialog.Root
			open={open}
			onOpenChange={(next) => {
				if (!next) onCancel();
			}}
		>
			<Dialog.Portal>
				<Dialog.Overlay className="shell-modal-overlay" />
				<Dialog.Content
					className="shell-modal shell-modal--confirm"
					aria-describedby={undefined}
				>
					<Dialog.Title className="shell-modal__title">
						File changed on disk
					</Dialog.Title>
					<p className="shell-modal__body">
						The file has been modified since you opened it. Reload to see the
						latest content, overwrite to keep your changes, or cancel to stay.
					</p>
					<div className="shell-modal__actions">
						<button type="button" className="shell-btn" onClick={onCancel}>
							Cancel
						</button>
						<button
							type="button"
							className="shell-btn shell-btn--danger"
							onClick={onOverwrite}
						>
							Overwrite
						</button>
						<button
							type="button"
							className="shell-btn shell-btn--primary"
							onClick={onReload}
						>
							Reload
						</button>
					</div>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
