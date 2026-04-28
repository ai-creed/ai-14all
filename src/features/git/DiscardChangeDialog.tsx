import { useState } from "react";
import { AppDialog } from "../../components/AppDialog";

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
				<button
					type="button"
					className="shell-button shell-button--compact"
					onClick={() => onOpenChange(false)}
					disabled={busy}
				>
					Cancel
				</button>
				<button
					type="button"
					className="shell-button shell-button--compact shell-button--danger"
					onClick={() => {
						void handleConfirm();
					}}
					disabled={busy}
				>
					Discard
				</button>
			</AppDialog.Footer>
		</AppDialog>
	);
}
