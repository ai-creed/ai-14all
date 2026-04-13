import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";

type Props = {
	open: boolean;
	relativePath: string | null;
	onOpenChange: (open: boolean) => void;
	onConfirm: () => Promise<void>;
};

export function DiscardChangeDialog({ open, relativePath, onOpenChange, onConfirm }: Props) {
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
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Portal>
				<Dialog.Overlay className="shell-modal-overlay" />
				<Dialog.Content className="shell-modal shell-modal--worktree" aria-describedby={undefined}>
					<Dialog.Title>Discard changes</Dialog.Title>
					<p className="shell-modal__copy">
						Discard changes to <strong>{relativePath}</strong>? This cannot be undone.
					</p>
					{error && <div className="shell-error-banner">{error}</div>}
					<div className="shell-modal__actions">
						<button
							type="button"
							className="shell-button"
							onClick={() => onOpenChange(false)}
							disabled={busy}
						>
							Cancel
						</button>
						<button
							type="button"
							className="shell-button shell-button--danger"
							onClick={() => { void handleConfirm(); }}
							disabled={busy}
						>
							Discard
						</button>
					</div>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
