import * as ContextMenu from "@radix-ui/react-context-menu";
import type { Worktree } from "../../../shared/models/worktree";
import type { ProcessAttentionState } from "../../../shared/models/process-session";

type WorktreeProcessSummary = {
	activeProcesses: { label: string }[];
	inactiveCount: number;
};

export type SessionSidebarWorkspace = {
	workspaceId: string;
	name: string;
	worktrees: Worktree[];
	selectedWorktreeId: string | null;
	attentionByWorktreeId: Record<string, ProcessAttentionState>;
	processesByWorktreeId?: Record<string, WorktreeProcessSummary>;
	active: boolean;
	hydrated: boolean;
};

type Props = {
	workspaces: SessionSidebarWorkspace[];
	collapsed: boolean;
	onToggleCollapsed: () => void;
	onLoadWorkspace: () => void;
	onOpenWorkspace: (workspaceId: string) => void;
	onSelect: (workspaceId: string, worktreeId: string) => void;
	onCreateWorktree: (workspaceId: string) => void;
	onRemoveWorktree: (workspaceId: string, worktreeId: string) => void;
	onRemoveWorkspace: (workspaceId: string) => void;
};

export function SessionSidebar({
	workspaces,
	collapsed,
	onToggleCollapsed,
	onLoadWorkspace,
	onOpenWorkspace,
	onSelect,
	onCreateWorktree,
	onRemoveWorktree,
	onRemoveWorkspace,
}: Props) {
	return (
		<nav
			aria-label="Worktree sessions"
			className="shell-panel shell-sidebar"
			data-collapsed={String(collapsed)}
		>
			<div className="shell-sidebar__header">
				{!collapsed && <div className="shell-label">Sessions</div>}
				<button
					type="button"
					className="shell-button shell-button--icon shell-button--compact shell-button--round"
					aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
					onClick={onToggleCollapsed}
				>
					<span aria-hidden="true">{collapsed ? "▸" : "◂"}</span>
				</button>
			</div>

			<div className="shell-sidebar__list">
				{workspaces.map((workspace) => (
					<section
						key={workspace.workspaceId}
						role="group"
						aria-label={workspace.name}
						className="shell-sidebar__workspace-group"
						data-active-workspace={String(workspace.active)}
					>
						<div className="shell-sidebar__workspace-header">
							{collapsed ? (
								<button
									type="button"
									className="shell-sidebar__workspace-badge"
									title={workspace.name}
									aria-label={workspace.name}
									data-selected={String(workspace.active)}
									onClick={() => onOpenWorkspace(workspace.workspaceId)}
								>
									{workspace.name.slice(0, 1).toUpperCase()}
								</button>
							) : (
								<>
									<button
										type="button"
										className="shell-sidebar__workspace-name"
										data-selected={String(workspace.active)}
										onClick={() => onOpenWorkspace(workspace.workspaceId)}
									>
										{workspace.name}
									</button>
									<button
										type="button"
										className="shell-button shell-button--icon shell-button--compact shell-button--round"
										aria-label={`Remove ${workspace.name}`}
										onClick={() => onRemoveWorkspace(workspace.workspaceId)}
									>
										×
									</button>
								</>
							)}
						</div>

						<div className="shell-sidebar__workspace-items">
							{workspace.worktrees.map((worktree) => {
								const selected =
									workspace.active && worktree.id === workspace.selectedWorktreeId;
								const summary = workspace.processesByWorktreeId?.[worktree.id];
								const item = (
									<button
										type="button"
										className="shell-sidebar__item"
										data-selected={String(selected)}
										data-attention={workspace.attentionByWorktreeId[worktree.id] ?? "idle"}
										aria-label={worktree.branchName !== worktree.label ? `${worktree.label} ${worktree.branchName}` : worktree.label}
										onClick={() => onSelect(workspace.workspaceId, worktree.id)}
									>
										{collapsed ? <span className="shell-sidebar__marker">{worktree.label.slice(0, 1).toUpperCase()}</span> : <>
											<strong>{worktree.label}</strong>
											{worktree.branchName !== worktree.label && (
												<div className="shell-sidebar__branch">{worktree.branchName}</div>
											)}
											{summary && (
												<div className="shell-sidebar__processes">
													{summary.activeProcesses.map((proc, i) => (
														<div key={i} className="shell-sidebar__process">
															<span data-testid="process-running-indicator" className="shell-sidebar__process-indicator" />
															<span className="shell-sidebar__process-label">{proc.label}</span>
														</div>
													))}
													{summary.inactiveCount > 0 && (
														<div className="shell-sidebar__process shell-sidebar__process--inactive">
															{summary.inactiveCount} inactive shell{summary.inactiveCount === 1 ? "" : "s"}
														</div>
													)}
												</div>
											)}
										</>}
									</button>
								);

								if (collapsed || worktree.isMain || !workspace.active) {
									return <div key={worktree.id}>{item}</div>;
								}

								return (
									<ContextMenu.Root key={worktree.id}>
										<ContextMenu.Trigger asChild>
											{item}
										</ContextMenu.Trigger>
										<ContextMenu.Portal>
											<ContextMenu.Content className="shell-toolbar-menu">
												<ContextMenu.Item
													className="shell-toolbar-menu__item shell-toolbar-menu__item--danger"
													onSelect={() => onRemoveWorktree(workspace.workspaceId, worktree.id)}
												>
													Remove worktree
												</ContextMenu.Item>
											</ContextMenu.Content>
										</ContextMenu.Portal>
									</ContextMenu.Root>
								);
							})}

							{workspace.worktrees.length === 0 && !collapsed && (
								<div className="shell-sidebar__workspace-empty">
									{workspace.hydrated
										? "No worktree sessions yet."
										: "Open this workspace to load its worktree sessions."}
								</div>
							)}
						</div>

						{workspace.active && (
							<div className="shell-sidebar__footer">
								<button
									type="button"
									className="shell-button shell-button--compact"
									onClick={() => onCreateWorktree(workspace.workspaceId)}
									aria-label="New worktree"
								>
									{collapsed ? "+" : "+ New worktree"}
								</button>
							</div>
						)}
					</section>
				))}
			</div>
			<div className="shell-sidebar__footer shell-sidebar__footer--global">
				<button
					type="button"
					className="shell-button shell-button--compact"
					onClick={onLoadWorkspace}
					aria-label="Load workspace"
				>
					{collapsed ? "Load" : "Load workspace"}
				</button>
			</div>
		</nav>
	);
}
