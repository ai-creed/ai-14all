import { AppDialog } from "../../../components/AppDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CreateWorktreePreview } from "../../../../shared/models/worktree-lifecycle";

type Props = {
	open: boolean;
	name: string;
	sessionTitle: string;
	preview: CreateWorktreePreview | null;
	loading: boolean;
	error: string | null;
	busy: boolean;
	onOpenChange: (open: boolean) => void;
	onNameChange: (name: string) => void;
	onSessionTitleChange: (title: string) => void;
	onConfirm: () => void;
};

export function NewWorktreeDialog({
	open,
	name,
	sessionTitle,
	preview,
	loading,
	error,
	busy,
	onOpenChange,
	onNameChange,
	onSessionTitleChange,
	onConfirm,
}: Props) {
	return (
		<AppDialog open={open} onOpenChange={onOpenChange}>
			<AppDialog.Title>New session</AppDialog.Title>
			<AppDialog.Description>
				This will create a new branch and linked worktree.
			</AppDialog.Description>
			<AppDialog.Body>
				<label className="space-y-2">
					<span>Name</span>
					<Input
						autoFocus
						value={name}
						onChange={(event) => onNameChange(event.target.value)}
					/>
				</label>
				<label className="space-y-2">
					<span>Session title (optional)</span>
					<Input
						value={sessionTitle}
						onChange={(event) => onSessionTitleChange(event.target.value)}
						placeholder={preview?.branchName ?? ""}
					/>
				</label>
				{preview && (
					<div className="rounded-md border border-border bg-muted/50 p-3 text-sm space-y-1">
						<div>
							<span>Name:</span> <strong>{preview.name}</strong>
						</div>
						<div>
							<span>Branch:</span> <strong>{preview.branchName}</strong>
						</div>
						<div>
							<span>Path:</span> <code>{preview.path}</code>
						</div>
						<div>
							<span>Base:</span> <strong>{preview.baseRef}</strong>
						</div>
						<div>
							<span>Latest commit:</span>{" "}
							<strong>
								{preview.baseCommit.shortSha} {preview.baseCommit.subject}
							</strong>
						</div>
					</div>
				)}
				{error && <div className="text-sm text-destructive p-2 bg-destructive/10 rounded">{error}</div>}
			</AppDialog.Body>
			<AppDialog.Footer>
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={() => onOpenChange(false)}
					disabled={busy}
				>
					Cancel
				</Button>
				<Button
					type="button"
					size="sm"
					onClick={onConfirm}
					disabled={!preview || loading || busy}
				>
					Create worktree
				</Button>
			</AppDialog.Footer>
		</AppDialog>
	);
}
