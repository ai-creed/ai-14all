import * as Dialog from "@radix-ui/react-dialog";
import type { RemoveWorktreePreview } from "../../../shared/models/worktree-lifecycle";

type Props = {
	open: boolean;
	preview: RemoveWorktreePreview | null;
	runningProcessLabels: string[];
	error: string | null;
	busy: boolean;
	confirmedDirty: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: () => void;
	onConfirmedDirtyChange: (v: boolean) => void;
};

export function RemoveWorktreeDialog({
	open,
	preview,
	runningProcessLabels,
	error,
	busy,
	confirmedDirty,
	onOpenChange,
	onConfirm,
	onConfirmedDirtyChange,
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
					{preview?.isDirty && (
						<label className="shell-modal__confirm-dirty">
							<input
								type="checkbox"
								checked={confirmedDirty}
								onChange={(e) => onConfirmedDirtyChange(e.target.checked)}
							/>
							{" "}I understand this worktree has uncommitted changes
						</label>
					)}
					<p className="shell-modal__copy">
						This will remove the linked worktree and force-delete its local branch.
					</p>
					{error && <div className="shell-error-banner">{error}</div>}
					<div className="shell-modal__actions">
						<button type="button" className="shell-button shell-button--danger" onClick={onConfirm} disabled={!preview || busy || (preview.isDirty && !confirmedDirty)}>
							{busy ? "Removing…" : "Remove worktree"}
						</button>
					</div>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
