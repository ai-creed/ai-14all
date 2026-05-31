import { useState } from "react";
import { AppDialog } from "../../../components/AppDialog";
import { Button } from "@/components/ui/button";

type Props = {
	open: boolean;
	relativePath: string | null;
	onOpenChange: (open: boolean) => void;
	onConfirm: () => Promise<void>;
};

export function DiscardChangeDialog({
	open,
	relativePath,
	onOpenChange,
	onConfirm,
}: Props) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function handleConfirm() {
		setBusy(true);
		setError(null);
		try {
			await onConfirm();
			onOpenChange(false);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	}

	return (
		<AppDialog open={open} onOpenChange={onOpenChange}>
			<AppDialog.Title>Discard changes</AppDialog.Title>
			<AppDialog.Description>
				Discard changes to <strong>{relativePath}</strong>? This cannot be
				undone.
			</AppDialog.Description>
			<AppDialog.Body>
				{error && <div className="text-sm text-destructive p-2 bg-destructive/10 rounded">{error}</div>}
			</AppDialog.Body>
			<AppDialog.Footer>
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={() => onOpenChange(false)}
					disabled={busy}
				>
					Cancel
				</Button>
				<Button
					type="button"
					variant="destructive"
					size="sm"
					onClick={() => {
						void handleConfirm();
					}}
					disabled={busy}
				>
					Discard
				</Button>
			</AppDialog.Footer>
		</AppDialog>
	);
}
