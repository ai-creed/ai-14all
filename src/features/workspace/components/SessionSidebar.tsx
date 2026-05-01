import * as React from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import type { Worktree } from "../../../../shared/models/worktree";
import type { ProcessAttentionState } from "../../../../shared/models/process-session";
import type { WorktreeProcessSummary } from "../logic/sidebar-shell-summary";
import { displayTitle } from "../logic/session-display-title";

export type SessionSidebarWorkspace = {
	workspaceId: string;
	name: string;
	worktrees: Worktree[];
	selectedWorktreeId: string | null;
	attentionByWorktreeId: Record<string, ProcessAttentionState>;
	processesByWorktreeId?: Record<string, WorktreeProcessSummary>;
	attentionContextByWorktreeId?: Record<string, string>;
	titleByWorktreeId?: Record<string, string>;
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
	onRenameSession?: (
		workspaceId: string,
		worktreeId: string,
		title: string,
	) => void;
	onRequestExpand?: (workspaceId: string, worktreeId: string) => void;
	onClearFailedReason?: (
		workspaceId: string,
		worktreeId: string,
		processId: string,
	) => void;
	pendingRename?: { workspaceId: string; worktreeId: string } | null;
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
	onRenameSession,
	onRequestExpand,
	onClearFailedReason,
	pendingRename,
}: Props) {
	const [renaming, setRenaming] = React.useState<{
		workspaceId: string;
		worktreeId: string;
	} | null>(null);
	const [draft, setDraft] = React.useState("");

	React.useEffect(() => {
		if (collapsed || !pendingRename) return;
		const target = workspaces.find(
			(w) => w.workspaceId === pendingRename.workspaceId,
		);
		if (!target || !target.active) return;
		setDraft(target.titleByWorktreeId?.[pendingRename.worktreeId] ?? "");
		setRenaming(pendingRename);
	}, [collapsed, pendingRename, workspaces]);

	function startRename(
		workspaceId: string,
		worktreeId: string,
		currentTitle: string,
	) {
		setDraft(currentTitle);
		setRenaming({ workspaceId, worktreeId });
	}

	function commitRename(workspaceId: string, worktreeId: string) {
		onRenameSession?.(workspaceId, worktreeId, draft.trim());
		setRenaming(null);
	}

	function cancelRename() {
		setRenaming(null);
	}

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
									workspace.active &&
									worktree.id === workspace.selectedWorktreeId;
								const summary = workspace.processesByWorktreeId?.[worktree.id];
								const rawTitle =
									workspace.titleByWorktreeId?.[worktree.id] ?? "";
								const shownTitle = displayTitle(rawTitle, worktree);
								const hasCustomTitle = rawTitle.trim().length > 0;
								const isRenamingThisRow =
									renaming?.workspaceId === workspace.workspaceId &&
									renaming?.worktreeId === worktree.id;

								// Mirrored on the wrapper so CSS can frame the title button + process
								// list as a single card; tests still read the attributes off the button.
								const rowAttentionProps = {
									"data-selected": String(selected),
									"data-attention":
										workspace.attentionByWorktreeId[worktree.id] ?? "idle",
								};

								const rowCommonProps = {
									className: "shell-sidebar__item",
									...rowAttentionProps,
									"aria-label":
										worktree.branchName !== shownTitle
											? `${shownTitle} ${worktree.branchName}`
											: shownTitle,
								};

								const rowContents = isRenamingThisRow ? (
									<input
										autoFocus
										aria-label="Rename session"
										className="shell-sidebar__rename-input"
										value={draft}
										onChange={(e) => setDraft(e.target.value)}
										onKeyDown={(e) => {
											if (e.key === "Enter") {
												e.preventDefault();
												commitRename(workspace.workspaceId, worktree.id);
											} else if (e.key === "Escape") {
												e.preventDefault();
												cancelRename();
											}
										}}
										onBlur={() =>
											commitRename(workspace.workspaceId, worktree.id)
										}
									/>
								) : collapsed ? (
									<span className="shell-sidebar__marker">
										{shownTitle.slice(0, 1).toUpperCase()}
									</span>
								) : (
									<>
										<strong
											onDoubleClick={(e) => {
												if (!workspace.active) return;
												e.stopPropagation();
												startRename(
													workspace.workspaceId,
													worktree.id,
													rawTitle,
												);
											}}
										>
											{shownTitle}
										</strong>
										{hasCustomTitle && (
											<div className="shell-sidebar__worktree-label">
												{worktree.label}
											</div>
										)}
										{worktree.branchName !== worktree.label && (
											<div className="shell-sidebar__branch">
												{worktree.branchName}
											</div>
										)}
									</>
								);

								// Process list rendered outside the row button to avoid nested <button> elements.
								const sessionAttentionContext =
									workspace.attentionContextByWorktreeId?.[worktree.id];
								const processList =
									!isRenamingThisRow && !collapsed && (summary || sessionAttentionContext) ? (
										<div className="shell-sidebar__processes">
											{sessionAttentionContext ? (
												<div className="shell-sidebar__process shell-sidebar__process--session">
													<span className="shell-sidebar__process-context" title={sessionAttentionContext}>
														{sessionAttentionContext}
													</span>
												</div>
											) : null}
											{summary?.rows.map((row) => (
												<div key={row.id} className="shell-sidebar__process">
													<span
														data-testid="process-state-indicator"
														className="shell-sidebar__process-indicator"
														data-state={row.state}
													/>
													<span
														className="shell-sidebar__process-label"
														title={row.label}
													>
														{row.label}
													</span>
													{row.context ? (
														<span
															className="shell-sidebar__process-context"
															title={row.context}
														>
															{row.context}
														</span>
													) : null}
													{row.hasFailedReason && onClearFailedReason && workspace.active ? (
														<button
															type="button"
															className="shell-button shell-button--compact shell-sidebar__process-clear-failed"
															aria-label={`Clear failed for ${row.label}`}
															onClick={(e) => {
																e.stopPropagation();
																onClearFailedReason(
																	workspace.workspaceId,
																	worktree.id,
																	row.id,
																);
															}}
														>
															Clear failed
														</button>
													) : null}
												</div>
											))}
											{summary && summary.overflowCount > 0 && (
												<div className="shell-sidebar__process shell-sidebar__process--overflow">
													{summary.overflowCount} more shell
													{summary.overflowCount === 1 ? "" : "s"}
												</div>
											)}
										</div>
									) : null;

								const item = isRenamingThisRow ? (
									<div role="presentation" {...rowCommonProps}>
										{rowContents}
									</div>
								) : (
									<button
										type="button"
										{...rowCommonProps}
										onKeyDown={(e) => {
											if (e.key === "F2") {
												e.preventDefault();
												if (collapsed || !workspace.active) {
													onRequestExpand?.(workspace.workspaceId, worktree.id);
													return;
												}
												startRename(
													workspace.workspaceId,
													worktree.id,
													rawTitle,
												);
											}
										}}
									>
										{rowContents}
									</button>
								);

								// onClick on the wrapper makes the entire card (title + process list)
								// the click target. Keyboard activation still flows through the inner
								// <button>: pressing Enter/Space fires its native click which bubbles
								// up to this handler. Inline-clickable children (Clear failed) stop
								// propagation to keep their action separate from row selection.
								const handleRowClick = isRenamingThisRow
									? undefined
									: () => onSelect(workspace.workspaceId, worktree.id);

								if (collapsed || !workspace.active) {
									return (
										<div
											key={worktree.id}
											className="shell-sidebar__row"
											{...rowAttentionProps}
											onClick={handleRowClick}
										>
											{item}
											{processList}
										</div>
									);
								}

								return (
									<ContextMenu.Root key={worktree.id}>
										<div
											className="shell-sidebar__row"
											{...rowAttentionProps}
											onClick={handleRowClick}
										>
											<ContextMenu.Trigger asChild>{item}</ContextMenu.Trigger>
											{processList}
										</div>
										<ContextMenu.Portal>
											<ContextMenu.Content className="shell-toolbar-menu">
												<ContextMenu.Item
													className="shell-toolbar-menu__item"
													onSelect={() => {
														if (collapsed || !workspace.active) {
															onRequestExpand?.(
																workspace.workspaceId,
																worktree.id,
															);
															return;
														}
														startRename(
															workspace.workspaceId,
															worktree.id,
															rawTitle,
														);
													}}
												>
													Rename session
												</ContextMenu.Item>
												{!worktree.isMain && (
													<ContextMenu.Item
														className="shell-toolbar-menu__item shell-toolbar-menu__item--danger"
														onSelect={() =>
															onRemoveWorktree(
																workspace.workspaceId,
																worktree.id,
															)
														}
													>
														Remove worktree
													</ContextMenu.Item>
												)}
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
									aria-label="New session"
								>
									{collapsed ? "+" : "+ New session"}
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
