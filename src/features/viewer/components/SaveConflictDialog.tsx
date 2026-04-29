import { AppDialog } from "../../../components/AppDialog";

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
		<AppDialog
			open={open}
			onOpenChange={(next) => {
				if (!next) onCancel();
			}}
		>
			<AppDialog.Title>File changed on disk</AppDialog.Title>
			<AppDialog.Description>
				This file was modified outside the editor. Pick how to resolve.
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
					onClick={onOverwrite}
				>
					Overwrite
				</button>
				<button
					type="button"
					className="shell-button shell-button--compact shell-button--primary"
					onClick={onReload}
				>
					Reload
				</button>
			</AppDialog.Footer>
		</AppDialog>
	);
}
