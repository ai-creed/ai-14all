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
	baseBranches: string[];
	selectedBaseBranch: string | null;
	setSelectedBaseBranch: (branch: string) => void;
	baseBranchLoading: boolean;
	baseBranchWarning: string | null;

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
				branches={props.baseBranches}
				baseBranch={props.selectedBaseBranch}
				onBaseBranchChange={props.setSelectedBaseBranch}
				baseLoading={props.baseBranchLoading}
				baseWarning={props.baseBranchWarning}
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
		</>
	);
}
