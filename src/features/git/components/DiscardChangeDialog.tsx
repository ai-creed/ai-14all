import { useState } from "react";
import { Button } from "@/components/ui/button";
import { AppDialog } from "../../../components/AppDialog";

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
				{error && <div className="shell-error-banner">{error}</div>}
			</AppDialog.Body>
			<AppDialog.Footer>
				<Button
					type="button"
					variant="secondary"
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
