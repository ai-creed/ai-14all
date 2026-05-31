import {
	SessionSidebar,
	type SessionSidebarWorkspace,
} from "../../features/workspace/components/SessionSidebar";

type PendingRename = {
	workspaceId: string;
	worktreeId: string;
};

type Props = {
	sidebarWorkspaces: SessionSidebarWorkspace[];
	sidebarCollapsed: boolean;
	setSidebarCollapsed: (next: boolean | ((prev: boolean) => boolean)) => void;
	handleSidebarResizeStart: (e: React.MouseEvent<HTMLDivElement>) => void;
	activeWorkspaceId: string | null;
	pendingRename: PendingRename | null;
	setPendingRename: (next: PendingRename | null) => void;
	openWorkspacePicker: () => void;
	openCreateWorktreeDialog: () => void;
	openRemoveWorktreeDialog: (worktreeId: string) => void;
	activateWorkspace: (workspaceId: string) => Promise<unknown>;
	handleSelectSidebarWorktree: (
		workspaceId: string,
		worktreeId: string,
	) => Promise<void>;
	handleRemoveWorkspace: (workspaceId: string) => Promise<void>;
	dispatch: (
		action:
			| { type: "session/setTitle"; worktreeId: string; title: string }
			| {
					type: "session/clearProcessAgentAttention";
					worktreeId: string;
					processId: string;
					sticky?: boolean;
					clearedAt: number;
			  },
	) => void;
};

/**
 * Left sidebar column: resize handle + SessionSidebar with all its workspace
 * + worktree action callbacks. Owns no state of its own; collapsed/width
 * state lives in App.tsx so other layout pieces can react.
 */
export function SidebarPanel(props: Props): React.ReactElement {
	const {
		sidebarWorkspaces,
		sidebarCollapsed,
		setSidebarCollapsed,
		handleSidebarResizeStart,
		activeWorkspaceId,
		pendingRename,
		setPendingRename,
		openWorkspacePicker,
		openCreateWorktreeDialog,
		openRemoveWorktreeDialog,
		activateWorkspace,
		handleSelectSidebarWorktree,
		handleRemoveWorkspace,
		dispatch,
	} = props;

	return (
		<div className="relative flex min-h-0">
			{!sidebarCollapsed && (
				<div
					className="absolute top-0 -right-2 w-4 h-full cursor-col-resize z-10 before:content-[''] before:absolute before:top-0 before:bottom-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-transparent before:transition-colors hover:before:bg-primary"
					data-testid="sidebar-resize-handle"
					onMouseDown={handleSidebarResizeStart}
				/>
			)}
			<SessionSidebar
				workspaces={sidebarWorkspaces}
				collapsed={sidebarCollapsed}
				onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
				onLoadWorkspace={openWorkspacePicker}
				onOpenWorkspace={(workspaceId) => {
					void activateWorkspace(workspaceId);
				}}
				onSelect={(workspaceId, worktreeId) => {
					void handleSelectSidebarWorktree(workspaceId, worktreeId);
				}}
				onCreateWorktree={(workspaceId) => {
					if (workspaceId !== activeWorkspaceId) return;
					openCreateWorktreeDialog();
				}}
				onRemoveWorktree={(workspaceId, worktreeId) => {
					if (workspaceId !== activeWorkspaceId) return;
					openRemoveWorktreeDialog(worktreeId);
				}}
				onRemoveWorkspace={(workspaceId) => {
					void handleRemoveWorkspace(workspaceId);
				}}
				onRenameSession={(workspaceId, worktreeId, title) => {
					if (workspaceId !== activeWorkspaceId) return;
					dispatch({ type: "session/setTitle", worktreeId, title });
					setPendingRename(null);
				}}
				onClearFailedReason={(workspaceId, worktreeId, processId) => {
					if (workspaceId !== activeWorkspaceId) return;
					dispatch({
						type: "session/clearProcessAgentAttention",
						worktreeId,
						processId,
						sticky: true,
						clearedAt: Date.now(),
					});
				}}
				onRequestExpand={(workspaceId, worktreeId) => {
					if (sidebarCollapsed) setSidebarCollapsed(false);
					if (workspaceId !== activeWorkspaceId) {
						void activateWorkspace(workspaceId);
					}
					setPendingRename({ workspaceId, worktreeId });
				}}
				pendingRename={pendingRename}
			/>
		</div>
	);
}
