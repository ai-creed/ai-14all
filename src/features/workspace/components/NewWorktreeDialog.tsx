import { Input } from "@/components/ui/input";
import { AppDialog } from "../../../components/AppDialog";
import type { CreateWorktreePreview } from "../../../../shared/models/worktree-lifecycle";
import { getCreateWorktreeErrorHint } from "../logic/create-worktree-error-hint";

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
	const errorHint = getCreateWorktreeErrorHint(error);
	return (
		<AppDialog open={open} onOpenChange={onOpenChange}>
			<AppDialog.Title>New session</AppDialog.Title>
			<AppDialog.Description>
				This will create a new branch and linked worktree.
			</AppDialog.Description>
			<AppDialog.Body>
				<label className="shell-app-dialog__field">
					<span>Name</span>
					<Input
						autoFocus
						value={name}
						onChange={(event) => onNameChange(event.target.value)}
					/>
				</label>
				<label className="shell-app-dialog__field">
					<span>Session title (optional)</span>
					<Input
						value={sessionTitle}
						onChange={(event) => onSessionTitleChange(event.target.value)}
						placeholder={preview?.branchName ?? ""}
					/>
				</label>
				{preview && (
					<div className="shell-app-dialog__preview">
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
				{errorHint ? (
					<div className="shell-app-dialog__hint" role="status">
						<strong>{errorHint.title}</strong>
						<p>{errorHint.detail}</p>
						{errorHint.command && <code>{errorHint.command}</code>}
					</div>
				) : (
					error && <div className="shell-error-banner">{error}</div>
				)}
			</AppDialog.Body>
			<AppDialog.Footer>
				<button
					type="button"
					className="shell-button shell-button--compact"
					onClick={() => onOpenChange(false)}
					disabled={busy}
				>
					Cancel
				</button>
				<button
					type="button"
					className="shell-button shell-button--compact shell-button--primary"
					onClick={onConfirm}
					disabled={!preview || loading || busy}
				>
					{busy ? (
						<span className="shell-button__busy">
							<span className="shell-button__pulse-dot" aria-hidden="true" />
							Creating session…
						</span>
					) : (
						"Create worktree"
					)}
				</button>
			</AppDialog.Footer>
		</AppDialog>
	);
}
