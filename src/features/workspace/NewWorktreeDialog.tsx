import * as Dialog from "@radix-ui/react-dialog";
import type { CreateWorktreePreview } from "../../../shared/models/worktree-lifecycle";

type Props = {
	open: boolean;
	name: string;
	preview: CreateWorktreePreview | null;
	loading: boolean;
	error: string | null;
	busy: boolean;
	onOpenChange: (open: boolean) => void;
	onNameChange: (name: string) => void;
	onConfirm: () => void;
};

export function NewWorktreeDialog({
	open,
	name,
	preview,
	loading,
	error,
	busy,
	onOpenChange,
	onNameChange,
	onConfirm,
}: Props) {
	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Portal>
				<Dialog.Overlay className="shell-modal-overlay" />
				<Dialog.Content className="shell-modal shell-modal--worktree">
					<Dialog.Title>New worktree</Dialog.Title>
					<p className="shell-modal__copy">
						This will create a new branch and linked worktree.
					</p>
					<label className="shell-modal__field">
						<span className="shell-label">Name</span>
						<input
							autoFocus
							value={name}
							onChange={(event) => onNameChange(event.target.value)}
							className="shell-note-input"
						/>
					</label>
					{preview && (
						<div className="shell-modal__preview">
							<div><span>Name:</span> <strong>{preview.name}</strong></div>
							<div><span>Branch:</span> <strong>{preview.branchName}</strong></div>
							<div><span>Path:</span> <code>{preview.path}</code></div>
							<div><span>Base:</span> <strong>{preview.baseRef}</strong></div>
							<div>
								<span>Latest commit:</span>{" "}
								<strong>{preview.baseCommit.shortSha} {preview.baseCommit.subject}</strong>
							</div>
						</div>
					)}
					{error && <div className="shell-error-banner">{error}</div>}
					<div className="shell-modal__actions">
						<button type="button" className="shell-button" onClick={onConfirm} disabled={!preview || loading || busy}>
							Create worktree
						</button>
					</div>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
