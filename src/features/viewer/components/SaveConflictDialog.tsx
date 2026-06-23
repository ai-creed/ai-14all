import { Button } from "@/components/ui/button";
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
				<Button type="button" variant="secondary" size="sm" onClick={onCancel}>
					Cancel
				</Button>
				<Button
					type="button"
					variant="destructive"
					size="sm"
					onClick={onOverwrite}
				>
					Overwrite
				</Button>
				<Button type="button" variant="default" size="sm" onClick={onReload}>
					Reload
				</Button>
			</AppDialog.Footer>
		</AppDialog>
	);
}
