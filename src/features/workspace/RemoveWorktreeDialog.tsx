import * as Dialog from "@radix-ui/react-dialog";
import type { RemoveWorktreePreview } from "../../../shared/models/worktree-lifecycle";

type Props = {
	open: boolean;
	preview: RemoveWorktreePreview | null;
	runningProcessLabels: string[];
	error: string | null;
	busy: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: () => void;
};

export function RemoveWorktreeDialog({
	open,
	preview,
	runningProcessLabels,
	error,
	busy,
	onOpenChange,
	onConfirm,
}: Props) {
	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Portal>
				<Dialog.Overlay className="shell-modal-overlay" />
				<Dialog.Content className="shell-modal shell-modal--worktree">
					<Dialog.Title>Remove worktree</Dialog.Title>
					{preview && (
						<div className="shell-modal__preview">
							<div>Name: {preview.label}</div>
							<div>Branch: {preview.branchName}</div>
							<div>Path: <code>{preview.path}</code></div>
							<div>Dirty worktree: {preview.isDirty ? "yes" : "no"}</div>
							<div>Running app sessions: {runningProcessLabels.length === 0 ? "none" : runningProcessLabels.join(", ")}</div>
						</div>
					)}
					<p className="shell-modal__copy">
						This will remove the linked worktree and force-delete its local branch.
					</p>
					{error && <div className="shell-error-banner">{error}</div>}
					<div className="shell-modal__actions">
						<button type="button" className="shell-button shell-button--danger" onClick={onConfirm} disabled={!preview || busy}>
							Remove worktree
						</button>
					</div>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
