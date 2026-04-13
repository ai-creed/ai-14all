import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";

type Props = {
	open: boolean;
	behind: number;
	onOpenChange: (open: boolean) => void;
	onConfirm: () => Promise<void>;
};

export function ForcePushDialog({ open, behind, onOpenChange, onConfirm }: Props) {
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
					<Dialog.Title>Force push?</Dialog.Title>
					<p className="shell-modal__copy">
						Remote has {behind} commit{behind === 1 ? "" : "s"} your branch doesn't have.
						Push anyway with --force-with-lease?
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
							Force Push
						</button>
					</div>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
