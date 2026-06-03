import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AppDialog } from "../../../components/AppDialog";
import type { CreateWorktreePreview } from "../../../../shared/models/worktree-lifecycle";
import { getCreateWorktreeErrorHint } from "../logic/create-worktree-error-hint";
import { BaseBranchSelect } from "./BaseBranchSelect";

type Props = {
	open: boolean;
	name: string;
	sessionTitle: string;
	preview: CreateWorktreePreview | null;
	loading: boolean;
	error: string | null;
	busy: boolean;
	branches: string[];
	baseBranch: string | null;
	onBaseBranchChange: (branch: string) => void;
	baseLoading: boolean;
	baseWarning: string | null;
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
	branches,
	baseBranch,
	onBaseBranchChange,
	baseLoading,
	baseWarning,
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
				<div className="shell-app-dialog__field">
					<span>Base branch</span>
					<BaseBranchSelect
						branches={branches}
						value={baseBranch}
						onChange={onBaseBranchChange}
						disabled={busy}
					/>
					{baseLoading && (
						<span className="shell-app-dialog__hint" role="status">
							Refreshing branches…
						</span>
					)}
					{baseWarning && (
						<span className="shell-app-dialog__warning" role="status">
							{baseWarning}
						</span>
					)}
				</div>
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
						{preview.note && (
							<div className="shell-app-dialog__note">{preview.note}</div>
						)}
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
				<Button
					type="button"
					variant="secondary"
					size="sm"
					onClick={() => onOpenChange(false)}
					disabled={busy}
				>
					Cancel
				</Button>
				<Button
					type="button"
					variant="default"
					size="sm"
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
				</Button>
			</AppDialog.Footer>
		</AppDialog>
	);
}
