import { AppDialog } from "../../components/AppDialog";
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
		<AppDialog open={open} onOpenChange={onOpenChange}>
			<AppDialog.Title>Remove session</AppDialog.Title>
			<AppDialog.Description>
				{preview
					? `Remove ${preview.label}'s worktree from disk?`
					: "Remove this worktree from disk?"}
			</AppDialog.Description>
			<AppDialog.Body>
				{preview && (
					<div className="shell-app-dialog__preview">
						<div>Name: {preview.label}</div>
						<div>Branch: {preview.branchName}</div>
						<div>
							Path: <code>{preview.path}</code>
						</div>
						<div>Dirty worktree: {preview.isDirty ? "yes" : "no"}</div>
						<div>
							Running app sessions:{" "}
							{runningProcessLabels.length === 0
								? "none"
								: runningProcessLabels.join(", ")}
						</div>
					</div>
				)}
				{preview?.isDirty && (
					<label className="shell-app-dialog__confirm-dirty">
						<input
							type="checkbox"
							checked={confirmedDirty}
							onChange={(e) => onConfirmedDirtyChange(e.target.checked)}
						/>{" "}
						I understand this worktree has uncommitted changes
					</label>
				)}
				{error && <div className="shell-error-banner">{error}</div>}
			</AppDialog.Body>
			<AppDialog.Footer>
				<button
					type="button"
					className="shell-button shell-button--compact"
					onClick={() => onOpenChange(false)}
				>
					Cancel
				</button>
				<button
					type="button"
					className="shell-button shell-button--compact shell-button--danger"
					onClick={onConfirm}
					disabled={!preview || busy || (preview.isDirty && !confirmedDirty)}
				>
					{busy ? "Removing…" : "Remove worktree"}
				</button>
			</AppDialog.Footer>
		</AppDialog>
	);
}
