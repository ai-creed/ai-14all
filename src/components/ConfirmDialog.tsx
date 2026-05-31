import { AppDialog } from "./AppDialog";

type Props = {
	open: boolean;
	title: string;
	description?: React.ReactNode;
	body?: React.ReactNode;
	confirmLabel?: string;
	cancelLabel?: string;
	/** Style the confirm button as destructive (red). */
	danger?: boolean;
	busy?: boolean;
	onConfirm: () => void;
	onCancel: () => void;
};

/**
 * Generic single-step confirmation dialog. Use for short ad-hoc "are you sure?"
 * prompts that don't need their own purpose-built dialog (e.g. unsaved drafts,
 * removing a workspace with active terminals). For confirmations with previews,
 * extra fields, or multi-step state, write a dedicated dialog instead.
 */
export function ConfirmDialog({
	open,
	title,
	description,
	body,
	confirmLabel = "Confirm",
	cancelLabel = "Cancel",
	danger = false,
	busy = false,
	onConfirm,
	onCancel,
}: Props) {
	return (
		<AppDialog
			open={open}
			onOpenChange={(next) => {
				if (!next) onCancel();
			}}
		>
			<AppDialog.Title>{title}</AppDialog.Title>
			{description && <AppDialog.Description>{description}</AppDialog.Description>}
			{body && <AppDialog.Body>{body}</AppDialog.Body>}
			<AppDialog.Footer>
				<button
					type="button"
					className="shell-button shell-button--compact"
					onClick={onCancel}
					disabled={busy}
				>
					{cancelLabel}
				</button>
				<button
					type="button"
					className={
						danger
							? "shell-button shell-button--compact shell-button--danger"
							: "shell-button shell-button--compact shell-button--primary"
					}
					onClick={onConfirm}
					disabled={busy}
				>
					{confirmLabel}
				</button>
			</AppDialog.Footer>
		</AppDialog>
	);
}
