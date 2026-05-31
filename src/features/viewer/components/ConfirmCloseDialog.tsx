import { AppDialog } from "../../../components/AppDialog";
import { Button } from "@/components/ui/button";

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
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={onCancel}
				>
					Cancel
				</Button>
				<Button
					type="button"
					variant="destructive"
					size="sm"
					onClick={onDiscard}
				>
					Discard
				</Button>
				<Button
					type="button"
					size="sm"
					onClick={onSave}
				>
					Save
				</Button>
			</AppDialog.Footer>
		</AppDialog>
	);
}
