import { AppDialog } from "../../../components/AppDialog";
import { Button } from "@/components/ui/button";
import type { RemoveWorktreePreview } from "../../../../shared/models/worktree-lifecycle";

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
					<div className="rounded-md border border-border bg-muted/50 p-3 text-sm space-y-1">
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
					<label className="flex items-center gap-2 mt-2">
						<input
							type="checkbox"
							checked={confirmedDirty}
							onChange={(e) => onConfirmedDirtyChange(e.target.checked)}
						/>{" "}
						I understand this worktree has uncommitted changes
					</label>
				)}
				{error && <div className="text-sm text-destructive p-2 bg-destructive/10 rounded">{error}</div>}
			</AppDialog.Body>
			<AppDialog.Footer>
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={() => onOpenChange(false)}
				>
					Cancel
				</Button>
				<Button
					type="button"
					variant="destructive"
					size="sm"
					onClick={onConfirm}
					disabled={!preview || busy || (preview.isDirty && !confirmedDirty)}
				>
					{busy ? "Removing…" : "Remove worktree"}
				</Button>
			</AppDialog.Footer>
		</AppDialog>
	);
}
