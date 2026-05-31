import { useState } from "react";
import type { ProcessSession } from "../../../shared/models/process-session";
import type {
	CreateWorktreePreview,
	RemoveWorktreePreview,
} from "../../../shared/models/worktree-lifecycle";
import type { WorkspaceState } from "../../features/workspace/logic/workspace-state";
import { LoadWorkspaceDialog } from "../../features/workspace/components/LoadWorkspaceDialog";
import { NewWorktreeDialog } from "../../features/workspace/components/NewWorktreeDialog";
import { RemoveWorktreeDialog } from "../../features/workspace/components/RemoveWorktreeDialog";
import { DiscardChangeDialog } from "../../features/git/components/DiscardChangeDialog";
import { AgentInstallModal } from "../../features/review/components/AgentInstallModal";
import type { AgentInstallStatus } from "../../features/review/hooks/use-agent-install-status";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import type { PendingWorkspaceRemoval } from "../hooks/use-workspace-removal";

type Props = {
	// Load workspace
	workspacePickerOpen: boolean;
	setWorkspacePickerOpen: (open: boolean) => void;
	handleLoadPath: (path: string) => Promise<void>;

	// Create worktree
	createDialogOpen: boolean;
	setCreateDialogOpen: (open: boolean) => void;
	createName: string;
	setCreateName: (next: string) => void;
	createSessionTitle: string;
	setCreateSessionTitle: (next: string) => void;
	createPreview: CreateWorktreePreview | null;
	createLoading: boolean;
	createError: string | null;
	setCreateError: (next: string | null) => void;
	createBusy: boolean;
	handleConfirmCreateWorktree: () => Promise<void>;

	// Remove worktree
	removeDialogOpen: boolean;
	setRemoveDialogOpen: (open: boolean) => void;
	removePreview: RemoveWorktreePreview | null;
	removeError: string | null;
	removeBusy: boolean;
	removeTargetId: string | null;
	setRemoveTargetId: (next: string | null) => void;
	confirmedDirtyRemoval: boolean;
	setConfirmedDirtyRemoval: (next: boolean) => void;
	workspaceState: WorkspaceState;
	handleConfirmRemoveWorktree: () => Promise<void>;

	// Discard change
	discardPath: string | null;
	setDiscardPath: (next: string | null) => void;
	handleDiscardChange: () => Promise<void>;

	// Agent install modal
	installModalOpen: boolean;
	setInstallModalOpen: (open: boolean) => void;
	agentInstallStatus: AgentInstallStatus;

	// Remove workspace (when there are live terminals)
	pendingWorkspaceRemoval: PendingWorkspaceRemoval | null;
	confirmWorkspaceRemoval: () => Promise<void>;
	cancelWorkspaceRemoval: () => void;
};

/**
 * Bottom-cluster modal dialogs for workspace + worktree + git lifecycle
 * actions and the agent-install onboarding modal. Owns no state of its own;
 * all open/close + content state lives in App.tsx and is passed in.
 */
export function DialogStack(props: Props): React.ReactElement {
	return (
		<>
			<LoadWorkspaceDialog
				open={props.workspacePickerOpen}
				onOpenChange={props.setWorkspacePickerOpen}
				onLoadPath={(path) => props.handleLoadPath(path)}
			/>
			<NewWorktreeDialog
				open={props.createDialogOpen}
				name={props.createName}
				sessionTitle={props.createSessionTitle}
				preview={props.createPreview}
				loading={props.createLoading}
				error={props.createError}
				busy={props.createBusy}
				onOpenChange={(open) => {
					props.setCreateDialogOpen(open);
					if (!open) {
						props.setCreateName("");
						props.setCreateSessionTitle("");
						props.setCreateError(null);
					}
				}}
				onNameChange={props.setCreateName}
				onSessionTitleChange={props.setCreateSessionTitle}
				onConfirm={() => {
					void props.handleConfirmCreateWorktree();
				}}
			/>
			<RemoveWorktreeDialog
				open={props.removeDialogOpen}
				preview={props.removePreview}
				runningProcessLabels={
					props.removeTargetId
						? (
								props.workspaceState.sessionsByWorktreeId[props.removeTargetId]
									?.processSessionIds ?? []
							)
								.map((id) => props.workspaceState.processSessionsById[id])
								.filter(
									(process): process is ProcessSession =>
										!!process && process.status === "running",
								)
								.map((process) => process.label)
						: []
				}
				error={props.removeError}
				busy={props.removeBusy}
				confirmedDirty={props.confirmedDirtyRemoval}
				onConfirmedDirtyChange={props.setConfirmedDirtyRemoval}
				onOpenChange={(open) => {
					props.setRemoveDialogOpen(open);
					if (!open) {
						props.setRemoveTargetId(null);
						props.setConfirmedDirtyRemoval(false);
					}
				}}
				onConfirm={() => {
					void props.handleConfirmRemoveWorktree();
				}}
			/>
			<DiscardChangeDialog
				open={props.discardPath !== null}
				relativePath={props.discardPath}
				onOpenChange={(open) => {
					if (!open) props.setDiscardPath(null);
				}}
				onConfirm={props.handleDiscardChange}
			/>
			<AgentInstallModal
				open={props.installModalOpen}
				onClose={() => props.setInstallModalOpen(false)}
				status={props.agentInstallStatus}
			/>
			<WorkspaceRemovalConfirm
				pending={props.pendingWorkspaceRemoval}
				onConfirm={props.confirmWorkspaceRemoval}
				onCancel={props.cancelWorkspaceRemoval}
			/>
		</>
	);
}

function WorkspaceRemovalConfirm({
	pending,
	onConfirm,
	onCancel,
}: {
	pending: PendingWorkspaceRemoval | null;
	onConfirm: () => Promise<void>;
	onCancel: () => void;
}) {
	const [busy, setBusy] = useState(false);
	const count = pending?.liveSessionCount ?? 0;
	return (
		<ConfirmDialog
			open={pending !== null}
			title="Remove workspace"
			description={
				pending
					? `"${pending.repositoryName}" has ${count} active terminal${
							count === 1 ? "" : "s"
						}. Remove the workspace and stop all running terminals?`
					: ""
			}
			confirmLabel={busy ? "Removing…" : "Remove workspace"}
			danger
			busy={busy}
			onConfirm={() => {
				setBusy(true);
				void onConfirm().finally(() => setBusy(false));
			}}
			onCancel={onCancel}
		/>
	);
}
