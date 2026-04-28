import { AppDialog } from "../../components/AppDialog";

type Props = {
	open: boolean;
	onSave: () => void;
	onDiscard: () => void;
	onCancel: () => void;
};

export function ConfirmCloseDialog({
	open,
	onSave,
	onDiscard,
	onCancel,
}: Props) {
	return (
		<AppDialog
			open={open}
			onOpenChange={(next) => {
				if (!next) onCancel();
			}}
		>
			<AppDialog.Title>Unsaved changes</AppDialog.Title>
			<AppDialog.Description>
				Save your changes before closing the editor?
			</AppDialog.Description>
			<AppDialog.Footer>
				<button
					type="button"
					className="shell-button shell-button--compact"
					onClick={onCancel}
				>
					Cancel
				</button>
				<button
					type="button"
					className="shell-button shell-button--compact shell-button--danger"
					onClick={onDiscard}
				>
					Discard
				</button>
				<button
					type="button"
					className="shell-button shell-button--compact shell-button--primary"
					onClick={onSave}
				>
					Save
				</button>
			</AppDialog.Footer>
		</AppDialog>
	);
}
