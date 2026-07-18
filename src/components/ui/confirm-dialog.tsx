import { useRef, useState, type ReactNode } from "react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogTitle,
} from "@/components/ui/dialog";

type ConfirmDialogProps = {
	open: boolean;
	title: string;
	body: ReactNode;
	confirmLabel: string;
	checkboxLabel: string;
	onConfirm: (dontAskAgain: boolean) => void;
	onCancel: () => void;
};

/**
 * Destructive-action confirmation on the shared Radix dialog primitive
 * (terminal-ux-hardening spec §5.1). The confirm button holds initial focus;
 * Escape and scrim click cancel via Radix's onOpenChange(false). Motion and
 * corners come from the primitive's theme layers — zero-duration is TUI-only,
 * other themes keep the standard 200ms animation (spec §5.1).
 */
export function ConfirmDialog({
	open,
	title,
	body,
	confirmLabel,
	checkboxLabel,
	onConfirm,
	onCancel,
}: ConfirmDialogProps) {
	const [dontAskAgain, setDontAskAgain] = useState(false);
	const confirmRef = useRef<HTMLButtonElement | null>(null);
	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) onCancel();
			}}
		>
			<DialogContent
				hideClose
				className="shell-confirm-dialog"
				data-testid="confirm-dialog"
				onOpenAutoFocus={(e) => {
					e.preventDefault();
					confirmRef.current?.focus();
				}}
			>
				<DialogTitle className="shell-confirm-dialog__title">
					{title}
				</DialogTitle>
				<DialogDescription className="shell-confirm-dialog__body">
					{body}
				</DialogDescription>
				<label className="shell-confirm-dialog__dontask">
					<input
						type="checkbox"
						data-testid="confirm-dialog-dontask"
						checked={dontAskAgain}
						onChange={(e) => setDontAskAgain(e.target.checked)}
					/>
					{checkboxLabel}
				</label>
				<DialogFooter className="shell-confirm-dialog__actions">
					<button
						type="button"
						data-testid="confirm-dialog-cancel"
						onClick={onCancel}
					>
						Cancel
					</button>
					<button
						ref={confirmRef}
						type="button"
						data-testid="confirm-dialog-confirm"
						className="shell-confirm-dialog__confirm"
						onClick={() => onConfirm(dontAskAgain)}
					>
						{confirmLabel}
					</button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
